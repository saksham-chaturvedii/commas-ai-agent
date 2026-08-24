// @vitest-environment node
import { describe, expect, it, beforeAll } from "vitest";
import { CommasAdapter } from "../../server/adapters/commasAdapter.js";
import { createFathomAdapter, createZoomAdapter } from "../../server/adapters/meetingsAdapters.js";
import { GmailAdapter } from "../../server/adapters/gmailAdapter.js";
import { CalendarAdapter } from "../../server/adapters/calendarAdapter.js";
import { CrmAdapter } from "../../server/adapters/crmAdapter.js";
import type { SourceAdapter } from "../../server/adapters/types.js";
import { buildToolRegistry, type RegisteredTool } from "../../server/agent/registry.js";
import { runAgentTurn, resumeAfterApproval } from "../../server/agent/runtime.js";
import { StubLlmClient } from "../../server/llm/stubClient.js";
import type { PageContext } from "../../server/types.js";

/**
 * End-to-end tests of the real request/response loop (docs/ARCHITECTURE.md §15):
 * Agent → LLM → source adapter → source → tool result → LLM → final answer, across all six
 * sources. Only the "LLM" is a deterministic stub (no ANTHROPIC_API_KEY in this environment);
 * every adapter, the mock servers behind them, and the runtime loop are real production code.
 */
describe("runAgentTurn — the five required validation scenarios", () => {
  let adapters: SourceAdapter[];
  let registry: Map<string, RegisteredTool>;
  const llmClient = new StubLlmClient();

  const ALL_SOURCES = ["commas", "google-calendar", "zoom", "fathom", "gmail", "crm"] as const;

  const DISPUTE_CONTEXT: PageContext = {
    kind: "dispute",
    id: "2481",
    label: "Dispute #2481",
    dispute: {
      customerName: "Sarah Johnson",
      customerEmail: "sarah.johnson@email.com",
      transactionId: "txn_8b3f2a1c9d",
      amountCents: 49900,
      reason: "product_not_received",
      openedAt: "2026-08-09T00:00:00Z",
      evidenceDueAt: "2026-08-23T00:00:00Z",
      evidenceStatus: "not_started",
      status: "Needs response",
      evidenceSummary: [],
    },
  };

  beforeAll(async () => {
    adapters = [
      await CommasAdapter.createMock(),
      await createFathomAdapter(),
      await createZoomAdapter(),
      new GmailAdapter(),
      new CalendarAdapter(),
      new CrmAdapter(),
    ];
    registry = await buildToolRegistry(adapters);
  });

  it("1-4: a user query requiring Commas data triggers a successful tool call, the result is passed back to the agent, and it produces a final answer", async () => {
    const result = await runAgentTurn({
      prompt: "Look up customer sarah.johnson@email.com",
      enabledSources: ["commas"],
      conversationHistory: [],
      llmClient,
      adapters,
      registry,
    });

    expect(result.error).toBeUndefined();
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].sourceId).toBe("commas");
    expect(result.toolSummary).toEqual([{ sourceId: "commas", label: "Customer records", ok: true }]);
    expect(result.answer).toContain("Sarah Johnson");
    expect(result.answer).toContain("sarah.johnson@email.com");
  });

  it("5: a tool failure produces a clean, non-crashing agent response (not an unhandled error)", async () => {
    const result = await runAgentTurn({
      prompt: "Look up transaction txn_doesnotexist",
      enabledSources: ["commas"],
      conversationHistory: [],
      llmClient,
      adapters,
      registry,
    });

    expect(result.error).toBeUndefined();
    expect(result.toolSummary).toEqual([{ sourceId: "commas", label: "Transaction details", ok: false }]);
    expect(result.answer.toLowerCase()).toContain("couldn't complete");
    expect(result.answer).toContain("txn_doesnotexist");
  });

  it("handles an empty tool result gracefully (not an error, not a crash)", async () => {
    const result = await runAgentTurn({
      prompt: "Look up customer nobody-matches-this-search",
      enabledSources: ["commas"],
      conversationHistory: [],
      llmClient,
      adapters,
      registry,
    });
    expect(result.error).toBeUndefined();
    expect(result.toolSummary[0].ok).toBe(true);
    expect(result.answer).toBe("No customers matched that search.");
  });

  it("excludes tools entirely when no sources are enabled, and answers with no tool calls", async () => {
    const result = await runAgentTurn({
      prompt: "Look up customer sarah",
      enabledSources: [],
      conversationHistory: [],
      llmClient,
      adapters,
      registry,
    });
    expect(result.steps).toHaveLength(0);
    expect(result.answer.toLowerCase()).toContain("no sources");
  });

  it("returns a clean top-level error (not a thrown exception) when a source adapter is unavailable", async () => {
    const deadCommas = await CommasAdapter.createMock();
    await deadCommas.close?.();
    const brokenAdapters = [deadCommas, ...adapters.slice(1)];

    const result = await runAgentTurn({
      prompt: "Look up customer sarah",
      enabledSources: ["commas"],
      conversationHistory: [],
      llmClient,
      adapters: brokenAdapters,
      registry,
    });

    expect(result.toolSummary[0].ok).toBe(false);
    expect(result.answer.toLowerCase()).toContain("couldn't complete");
  });

  describe("multi-source dispute investigation (the agent decides which tools it needs)", () => {
    it("chains through every enabled source relevant to the dispute and synthesizes across them", async () => {
      const result = await runAgentTurn({
        prompt: "Help me resolve this dispute",
        enabledSources: [...ALL_SOURCES],
        context: DISPUTE_CONTEXT,
        conversationHistory: [],
        llmClient,
        adapters,
        registry,
      });

      expect(result.error).toBeUndefined();
      const usedSources = new Set(result.steps.map((s) => s.sourceId));
      expect(usedSources).toEqual(new Set(["commas", "crm", "gmail", "fathom", "zoom"]));
      expect(result.answer).toContain("Situation summary");
      expect(result.answer).toContain("What I found");
      expect(result.answer.toLowerCase()).toContain("gohighlevel");
      expect(result.answer.toLowerCase()).toContain("fathom");
    });

    it("only uses sources actually enabled for the chat, and says what it couldn't check", async () => {
      const result = await runAgentTurn({
        prompt: "Help me resolve this dispute",
        enabledSources: ["commas", "fathom"],
        context: DISPUTE_CONTEXT,
        conversationHistory: [],
        llmClient,
        adapters,
        registry,
      });

      const usedSources = new Set(result.steps.map((s) => s.sourceId));
      expect(usedSources).toEqual(new Set(["commas", "fathom"]));
      expect(result.answer).toContain("Missing information");
      expect(result.answer).toContain("GoHighLevel");
      expect(result.answer).toContain("Gmail");
      expect(result.answer).toContain("Zoom");
    });
  });

  describe("write actions pause for approval, never auto-execute", () => {
    it("pauses with pendingApproval instead of running the write tool", async () => {
      const result = await runAgentTurn({
        prompt: "Please mark the response ready",
        enabledSources: ["commas"],
        context: DISPUTE_CONTEXT,
        conversationHistory: [],
        llmClient,
        adapters,
        registry,
      });

      expect(result.error).toBeUndefined();
      expect(result.pendingApproval).toBeDefined();
      expect(result.pendingApproval?.toolName).toBe("commas_mark_dispute_response_ready");
      expect(result.pendingApproval?.summary.toLowerCase()).toContain("dispute #2481");
      // nothing executed yet
      expect(result.toolSummary).toHaveLength(0);
    });

    it("approve: executes the write tool and produces a real confirmation grounded in the result", async () => {
      const pending = await runAgentTurn({
        prompt: "Please mark the response ready",
        enabledSources: ["commas"],
        context: DISPUTE_CONTEXT,
        conversationHistory: [],
        llmClient,
        adapters,
        registry,
      });
      const approval = pending.pendingApproval!;

      const result = await resumeAfterApproval({
        decision: "approve",
        toolCallId: approval.toolCallId,
        toolName: approval.toolName,
        input: approval.input,
        prompt: "Please mark the response ready",
        enabledSources: ["commas"],
        context: DISPUTE_CONTEXT,
        conversationHistory: [],
        llmClient,
        adapters,
        registry,
      });

      expect(result.error).toBeUndefined();
      expect(result.pendingApproval).toBeUndefined();
      expect(result.toolSummary).toEqual([{ sourceId: "commas", label: "Mark response ready", ok: true }]);
      expect(result.steps[0].classification).toBe("write");
      expect(result.answer.toLowerCase()).toContain("marked");
    });

    it("decline: never calls the tool, and the agent acknowledges without executing", async () => {
      const pending = await runAgentTurn({
        prompt: "Please mark the response ready",
        enabledSources: ["commas"],
        context: DISPUTE_CONTEXT,
        conversationHistory: [],
        llmClient,
        adapters,
        registry,
      });
      const approval = pending.pendingApproval!;

      const result = await resumeAfterApproval({
        decision: "decline",
        toolCallId: approval.toolCallId,
        toolName: approval.toolName,
        input: approval.input,
        prompt: "Please mark the response ready",
        enabledSources: ["commas"],
        context: DISPUTE_CONTEXT,
        conversationHistory: [],
        llmClient,
        adapters,
        registry,
      });

      expect(result.toolSummary).toEqual([{ sourceId: "commas", label: "Mark response ready", ok: false }]);
      // the tool never actually ran — verify via a fresh lookup that the dispute's response
      // status wasn't flipped by the declined attempt
      const check = await runAgentTurn({
        prompt: "help me resolve this dispute",
        enabledSources: ["commas"],
        context: DISPUTE_CONTEXT,
        conversationHistory: [],
        llmClient,
        adapters,
        registry,
      });
      expect(check.answer).not.toContain("ready to submit");
    });
  });

  describe("multi-turn conversation memory", () => {
    it("uses conversationHistory to resolve a follow-up question without re-stating the customer", async () => {
      const first = await runAgentTurn({
        prompt: "Look up customer sarah.johnson@email.com",
        enabledSources: ["commas"],
        conversationHistory: [],
        llmClient,
        adapters,
        registry,
      });
      expect(first.answer).toContain("sarah.johnson@email.com");

      const followUp = await runAgentTurn({
        prompt: "What about her transactions?",
        enabledSources: ["commas"],
        conversationHistory: [
          { role: "user", text: "Look up customer sarah.johnson@email.com" },
          { role: "assistant", text: first.answer },
        ],
        llmClient,
        adapters,
        registry,
      });

      expect(followUp.error).toBeUndefined();
      expect(followUp.steps[0]?.sourceId).toBe("commas");
      expect(followUp.answer.toLowerCase()).toContain("transaction");
      expect(followUp.answer).not.toMatch(/no transactions/i);
    });
  });

  describe("answer quality regressions (PRODUCT_READINESS_AUDIT.md P0s)", () => {
    const KIM_CONTEXT: PageContext = {
      kind: "dispute",
      id: "2455",
      label: "Dispute #2455 — David Kim",
      dispute: {
        customerName: "David Kim",
        customerEmail: "david.kim@email.com",
        transactionId: "txn_3f7b90c114",
        amountCents: 24900,
        reason: "product_not_received",
        openedAt: "August 17, 2026",
        evidenceDueAt: "August 31, 2026",
        evidenceStatus: "in_progress",
        status: "Needs response",
        evidenceSummary: [],
      },
    };

    it("P0-3: investigating the uncertain case (#2455) reflects ITS story — uncertainty, not Sarah's engagement narrative", async () => {
      const result = await runAgentTurn({
        prompt: "Investigate this dispute",
        enabledSources: [...ALL_SOURCES],
        context: KIM_CONTEXT,
        conversationHistory: [],
        llmClient,
        adapters,
        registry,
      });
      expect(result.error).toBeUndefined();
      expect(result.answer).not.toContain("engaged with the product after purchase");
      expect(result.answer.toLowerCase()).toContain("wouldn't commit to");
      // empty external results are reported honestly, never as "wasn't checked"
      expect(result.answer).not.toContain("no connected apps were available");
      expect(result.answer.toLowerCase()).toContain("no email threads found");
    });

    it("P0-4: the cross-apps prompt in a GLOBAL chat never gets hijacked into a dispute investigation", async () => {
      const result = await runAgentTurn({
        prompt: "Find information across my connected apps",
        enabledSources: [...ALL_SOURCES],
        conversationHistory: [],
        llmClient,
        adapters,
        registry,
      });
      expect(result.error).toBeUndefined();
      expect(result.steps.map((s) => s.id).join()).not.toContain("commas_get_dispute");
      expect(result.answer).not.toContain("Situation summary");
      expect(result.answer.toLowerCase()).toContain("fathom");
      expect(result.answer.toLowerCase()).toContain("gohighlevel");
    });

    it("P0-2: the global sales summary matches the Dashboard's numbers ($18,420 / 62 transactions)", async () => {
      const result = await runAgentTurn({
        prompt: "Summarize my sales this month",
        enabledSources: ["commas"],
        conversationHistory: [],
        llmClient,
        adapters,
        registry,
      });
      expect(result.error).toBeUndefined();
      expect(result.answer).toContain("$18,420");
      expect(result.answer).toContain("62 transactions");
      expect(result.answer).not.toContain("$2125");
    });

    it("P0-2: 'Analyze my disputes' in a global chat gives the 4-dispute portfolio, not a #2481 deep-dive", async () => {
      const result = await runAgentTurn({
        prompt: "Analyze my disputes",
        enabledSources: [...ALL_SOURCES],
        conversationHistory: [],
        llmClient,
        adapters,
        registry,
      });
      expect(result.error).toBeUndefined();
      expect(result.answer).toContain("4 open disputes");
      expect(result.answer).toContain("#2502");
      expect(result.answer).not.toContain("Situation summary");
    });

    it("P0-6: unmatched prompts never confess to being a preview/demo", async () => {
      const result = await runAgentTurn({
        prompt: "what's the weather like on the moon",
        enabledSources: [...ALL_SOURCES],
        conversationHistory: [],
        llmClient,
        adapters,
        registry,
      });
      expect(result.answer).not.toContain("This preview only knows");
      expect(result.answer.toLowerCase()).not.toContain("demo scenario");
      expect(result.answer).toContain("Summarize my sales");
    });

    it("P0-7: 'Help me respond to a customer' asks WHO, listing recent customers", async () => {
      const result = await runAgentTurn({
        prompt: "Help me respond to a customer",
        enabledSources: ["commas"],
        conversationHistory: [],
        llmClient,
        adapters,
        registry,
      });
      expect(result.answer).toContain("Who do you mean?");
      expect(result.answer).toContain("Sarah Johnson");
      expect(result.answer).toContain("Marcus Webb");
    });

    it("acknowledgments get an in-character reply, not the capability pitch", async () => {
      const result = await runAgentTurn({
        prompt: "thanks!",
        enabledSources: ["commas"],
        conversationHistory: [],
        llmClient,
        adapters,
        registry,
      });
      expect(result.answer).toContain("Anytime");
      expect(result.steps).toHaveLength(0);
    });
  });
});
