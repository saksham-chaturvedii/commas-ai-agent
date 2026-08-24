// @vitest-environment node
import { describe, expect, it, beforeAll } from "vitest";
import { CommasAdapter } from "../../server/adapters/commasAdapter.js";
import { CrmAdapter } from "../../server/adapters/crmAdapter.js";
import type { SourceAdapter } from "../../server/adapters/types.js";
import { buildToolRegistry, type RegisteredTool } from "../../server/agent/registry.js";
import { runAgentTurn } from "../../server/agent/runtime.js";
import { StubLlmClient } from "../../server/llm/stubClient.js";
import type { PageContext } from "../../server/types.js";

/**
 * The Resolution Center demo-readiness pass (docs/active-context.md): 5 deterministic
 * demo-script questions answered per dispute case, plus the hidden pipeline-test phrase.
 */
describe("dispute-intent demo questions (deterministic, per-case)", () => {
  let adapters: SourceAdapter[];
  let registry: Map<string, RegisteredTool>;
  const llmClient = new StubLlmClient();

  beforeAll(async () => {
    adapters = [await CommasAdapter.createMock()];
    registry = await buildToolRegistry(adapters);
  });

  const contextFor = (id: string, label: string): PageContext => ({ kind: "dispute", id, label });

  const ask = (prompt: string, id: string, label = `Dispute #${id}`) =>
    runAgentTurn({
      prompt,
      enabledSources: ["commas"],
      context: contextFor(id, label),
      conversationHistory: [],
      llmClient,
      adapters,
      registry,
    });

  it("hidden pipeline-test phrase responds exactly, regardless of context", async () => {
    const result = await ask("all roads lead to", "2481");
    expect(result.answer).toBe("info, my dawg.");
    expect(result.steps).toHaveLength(0); // no tool call — short-circuits before anything else
  });

  it("hidden phrase is case-insensitive and ignores surrounding whitespace, but not a substring match", async () => {
    const exact = await ask("  ALL ROADS LEAD TO  ", "2481");
    expect(exact.answer).toBe("info, my dawg.");

    const notExact = await ask("all roads lead to happiness", "2481");
    expect(notExact.answer).not.toBe("info, my dawg.");
  });

  describe("case #2481 — Sarah Johnson (needs response)", () => {
    it("why: identifies the likely reason", async () => {
      const r = await ask("Why is this dispute open?", "2481");
      expect(r.answer.toLowerCase()).toContain("forgotten-purchase");
    });
    it("evidence: lists what's missing", async () => {
      const r = await ask("What evidence do I need?", "2481");
      expect(r.answer).toContain("Access & activity records");
    });
    it("draft: produces a realistic draft response", async () => {
      const r = await ask("Draft my response", "2481");
      expect(r.answer).toContain("Sarah Johnson");
      expect(r.answer.toLowerCase()).toContain("delivered");
    });
    it("recommend: gives a concrete next step", async () => {
      const r = await ask("What should I do next?", "2481");
      expect(r.answer.toLowerCase()).toContain("evidence checklist");
    });
    it("summarize: produces a short case overview", async () => {
      const r = await ask("Summarize this case", "2481");
      expect(r.answer).toContain("$499");
      expect(r.answer).toContain("Sarah Johnson");
    });
  });

  describe("case #2502 — Marcus Webb (missing evidence)", () => {
    it("evidence: tells the seller exactly what to collect", async () => {
      const r = await ask("What evidence do I need?", "2502");
      expect(r.answer).toContain("Product description & offer details");
      expect(r.answer).toContain("You already have: Transaction & payment details");
    });
    it("draft: honestly declines to overclaim without evidence", async () => {
      const r = await ask("Draft my response", "2502");
      expect(r.answer.toLowerCase()).toContain("don't have enough evidence");
    });
  });

  describe("communications intent (audit P1-9)", () => {
    it("pulls live Gmail threads and answers from the case's authored communications summary", async () => {
      const commAdapters = [...adapters]; // commas only in this suite — gmail not enabled
      const r = await runAgentTurn({
        prompt: "Review customer communications",
        enabledSources: ["commas"],
        context: contextFor("2481", "Dispute #2481 — Sarah Johnson"),
        conversationHistory: [],
        llmClient,
        adapters: commAdapters,
        registry,
      });
      // Gmail isn't enabled for this chat — the reply says so explicitly and still gives the
      // authored per-case summary, never the generic fallback.
      expect(r.answer).toContain("Gmail isn't enabled for this chat");
      expect(r.answer).toContain("Got it, thanks! I'm in now.");
    });

    it("names the absence of correspondence for the missing-evidence case (#2502)", async () => {
      const r = await ask("Check customer communications for this dispute", "2502");
      expect(r.answer.toLowerCase()).toContain("don't see any email threads with marcus");
    });
  });

  describe("history intent — the dispute chat's \"Analyze customer history\" starter action", () => {
    it("declines honestly when GoHighLevel isn't connected for this chat", async () => {
      const r = await ask("Analyze this customer's history", "2481");
      expect(r.answer).toContain("GoHighLevel isn't connected for this chat");
    });

    // Unlike `contextFor` (used everywhere else in this file), these two tests need a full
    // dispute context with `.dispute.customerEmail` populated — the same shape
    // src/lib/mockData.ts's `buildDisputeContext` builds in the real app — since the history
    // intent's live GoHighLevel lookup keys off that email, not just the dispute id.
    const richContext = (id: string, label: string, customerEmail: string, customerName: string): PageContext => ({
      kind: "dispute",
      id,
      label,
      dispute: {
        customerName,
        customerEmail,
        transactionId: "txn_test",
        amountCents: 0,
        reason: "product_not_received",
        openedAt: "2026-08-01",
        evidenceDueAt: "2026-08-15",
        evidenceStatus: "not_started",
        status: "Needs response",
        evidenceSummary: [],
      },
    });

    it("pulls the live GoHighLevel contact and reports real pipeline/account history", async () => {
      const crmAdapters = [...adapters, new CrmAdapter()];
      const crmRegistry = await buildToolRegistry(crmAdapters);
      const r = await runAgentTurn({
        prompt: "Analyze this customer's history",
        enabledSources: ["commas", "crm"],
        context: richContext("2481", "Dispute #2481 — Sarah Johnson", "sarah.johnson@email.com", "Sarah Johnson"),
        conversationHistory: [],
        llmClient,
        adapters: crmAdapters,
        registry: crmRegistry,
      });
      expect(r.answer).toContain("Sarah Johnson");
      expect(r.answer.toLowerCase()).toContain("pipeline stage");
      expect(r.answer).toContain("Pro Coaching Program");
    });

    it("reports honestly when the customer has no GoHighLevel record at all", async () => {
      const crmAdapters = [...adapters, new CrmAdapter()];
      const crmRegistry = await buildToolRegistry(crmAdapters);
      const r = await runAgentTurn({
        prompt: "Analyze this customer's history",
        enabledSources: ["commas", "crm"],
        context: richContext("2417", "Dispute #2417 — Elena Cruz", "elena.cruz@email.com", "Elena Cruz"),
        conversationHistory: [],
        llmClient,
        adapters: crmAdapters,
        registry: crmRegistry,
      });
      expect(r.answer).toContain("No GoHighLevel contact record");
    });
  });

  describe("case #2417 — Elena Cruz (evidence ready)", () => {
    it("evidence: confirms nothing is missing", async () => {
      const r = await ask("What evidence do I need?", "2417");
      expect(r.answer.toLowerCase()).toContain("any gaps");
    });
    it("recommend: tells the seller to act now", async () => {
      const r = await ask("What should I do next?", "2417");
      expect(r.answer.toLowerCase()).toContain("already have everything");
    });
  });

  describe("case #2455 — David Kim (high-risk / uncertain)", () => {
    it("why: explicitly communicates uncertainty rather than a confident answer", async () => {
      const r = await ask("Why is this dispute open?", "2455");
      expect(r.answer.toLowerCase()).toContain("doesn't clearly point one way or the other");
    });
    it("recommend: leads with the uncertainty caveat", async () => {
      const r = await ask("What should I do next?", "2455");
      expect(r.answer.toLowerCase()).toContain("wouldn't commit to");
    });
  });

  describe("case #2390 — Priya Nair (won / resolved)", () => {
    it("summarize: explains what happened and what resolved it", async () => {
      const r = await ask("Summarize this case", "2390");
      expect(r.answer.toLowerCase()).toContain("won on august 9");
      expect(r.answer.toLowerCase()).toContain("18 portal logins");
    });
    it("recommend: says no action is needed", async () => {
      const r = await ask("What should I do next?", "2390");
      expect(r.answer.toLowerCase()).toContain("no action needed");
    });
    it("draft: declines — there's nothing left to submit", async () => {
      const r = await ask("Draft my response", "2390");
      expect(r.answer.toLowerCase()).toContain("already resolved");
    });
  });
});
