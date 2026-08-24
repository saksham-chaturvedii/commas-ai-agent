// @vitest-environment node
import { describe, expect, it, beforeAll } from "vitest";
import { CommasAdapter } from "../../server/adapters/commasAdapter.js";
import { createFathomAdapter, createZoomAdapter } from "../../server/adapters/meetingsAdapters.js";
import { GmailAdapter } from "../../server/adapters/gmailAdapter.js";
import { CalendarAdapter } from "../../server/adapters/calendarAdapter.js";
import { CrmAdapter } from "../../server/adapters/crmAdapter.js";
import type { SourceAdapter } from "../../server/adapters/types.js";
import { buildToolRegistry, type RegisteredTool } from "../../server/agent/registry.js";
import { runAgentTurn } from "../../server/agent/runtime.js";
import { buildProposedAction } from "../../server/agent/actions/index.js";
import { StubLlmClient } from "../../server/llm/stubClient.js";
import type { PageContext } from "../../server/types.js";

/**
 * Agent-initiated application actions (docs/AI_ASSISTANT_ARCHITECTURE.md §7): the agent proposes,
 * never executes. These tests exercise the real runAgentTurn loop end to end — real adapters,
 * real mock Commas data, only the "reasoning" is the deterministic stub — plus buildProposedAction
 * directly for its own validation behavior.
 */

const ACTIVE_DISPUTE_CONTEXT: PageContext = {
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

const RESOLVED_DISPUTE_CONTEXT: PageContext = {
  kind: "dispute",
  id: "2390",
  label: "Dispute #2390",
  dispute: {
    customerName: "Priya Nair",
    customerEmail: "priya.nair@email.com",
    transactionId: "txn_9d4c22ab77",
    amountCents: 34900,
    reason: "product_not_received",
    openedAt: "2026-08-03T00:00:00Z",
    evidenceDueAt: "2026-08-17T00:00:00Z",
    evidenceStatus: "ready",
    status: "Won",
    evidenceSummary: [],
  },
};

describe("buildProposedAction", () => {
  it("shapes a valid add_evidence call into a pending ProposedAction", () => {
    const action = buildProposedAction("2481", "propose_add_evidence", {
      summary: "I found 1 strong evidence item.",
      items: [
        { category: "Customer communications", title: "Gmail thread", record: "...", why: "...", sourceType: "communication", sourceLabel: "Gmail" },
      ],
    });
    expect(action).toEqual({
      id: expect.any(String),
      type: "add_evidence",
      disputeId: "2481",
      summary: "I found 1 strong evidence item.",
      items: [{ category: "Customer communications", title: "Gmail thread", record: "...", why: "...", sourceType: "communication", sourceLabel: "Gmail" }],
      status: "pending",
    });
  });

  it("shapes a valid draft_response call into a pending ProposedAction", () => {
    const action = buildProposedAction("2481", "propose_draft_response", {
      summary: "I can draft a response.",
      draftText: "Dear customer, ...",
    });
    expect(action).toEqual({
      id: expect.any(String),
      type: "draft_response",
      disputeId: "2481",
      summary: "I can draft a response.",
      draftText: "Dear customer, ...",
      status: "pending",
    });
  });

  it("returns undefined for a malformed add_evidence call — never fabricates a proposal from missing data", () => {
    expect(buildProposedAction("2481", "propose_add_evidence", { summary: "x" })).toBeUndefined(); // no items
    expect(buildProposedAction("2481", "propose_add_evidence", { items: [] })).toBeUndefined(); // no summary
    expect(
      buildProposedAction("2481", "propose_add_evidence", { summary: "x", items: [{ category: "only-this-field" }] }),
    ).toBeUndefined(); // items missing required fields
  });

  it("returns undefined for a malformed draft_response call", () => {
    expect(buildProposedAction("2481", "propose_draft_response", { summary: "x" })).toBeUndefined(); // no draftText
    expect(buildProposedAction("2481", "propose_draft_response", { draftText: "x" })).toBeUndefined(); // no summary
  });

  it("returns undefined for an unrecognized tool name", () => {
    expect(buildProposedAction("2481", "not_a_real_tool", { summary: "x" })).toBeUndefined();
  });
});

describe("propose-tools wired into runAgentTurn (ACTIVE dispute)", () => {
  let adapters: SourceAdapter[];
  let registry: Map<string, RegisteredTool>;
  const llmClient = new StubLlmClient();
  const ALL_SOURCES = ["commas", "google-calendar", "zoom", "fathom", "gmail", "crm"] as const;

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

  it("investigating an active dispute proposes evidence grounded in what was actually found — a real Fathom call included, nothing fabricated", async () => {
    const result = await runAgentTurn({
      prompt: "Help me resolve this dispute",
      enabledSources: [...ALL_SOURCES],
      context: ACTIVE_DISPUTE_CONTEXT,
      conversationHistory: [],
      llmClient,
      adapters,
      registry,
    });

    expect(result.error).toBeUndefined();
    expect(result.proposedActions).toBeDefined();
    const proposal = result.proposedActions!.find((a) => a.type === "add_evidence");
    expect(proposal).toBeDefined();
    if (proposal?.type !== "add_evidence") throw new Error("expected add_evidence");
    expect(proposal.disputeId).toBe("2481");
    expect(proposal.status).toBe("pending");
    expect(proposal.items.length).toBeGreaterThan(0);
    // At least one candidate cites the real Fathom call (42-minute onboarding session, per the
    // dispute's authored mock data) — grounded in an actual tool result, not invented.
    expect(proposal.items.some((i) => i.sourceLabel === "Fathom" && i.record.includes("42-minute"))).toBe(true);
    // The investigation's own final answer still renders normally alongside the proposal.
    expect(result.answer).toContain("Situation summary");
  });

  it("'draft a response' on an active dispute proposes a draft instead of dropping the full text into the chat", async () => {
    const result = await runAgentTurn({
      prompt: "draft a response for me",
      enabledSources: ["commas"],
      context: ACTIVE_DISPUTE_CONTEXT,
      conversationHistory: [],
      llmClient,
      adapters,
      registry,
    });

    expect(result.error).toBeUndefined();
    expect(result.proposedActions).toBeDefined();
    const proposal = result.proposedActions!.find((a) => a.type === "draft_response");
    expect(proposal).toBeDefined();
    if (proposal?.type !== "draft_response") throw new Error("expected draft_response");
    expect(proposal.disputeId).toBe("2481");
    expect(proposal.draftText).toContain("Sarah Johnson");
    // The chat's own final text is short — the real draft lives in the proposal, not repeated.
    expect(result.answer).not.toContain(proposal.draftText);
    expect(result.answer.toLowerCase()).toContain("review it below");
  });
});

describe("propose-tools are never offered on a RESOLVED dispute", () => {
  let adapters: SourceAdapter[];
  let registry: Map<string, RegisteredTool>;
  const llmClient = new StubLlmClient();

  beforeAll(async () => {
    adapters = [await CommasAdapter.createMock()];
    registry = await buildToolRegistry(adapters);
  });

  it("'draft a response' on a resolved dispute returns plain informational text, never a proposal", async () => {
    const result = await runAgentTurn({
      prompt: "draft a response for me",
      enabledSources: ["commas"],
      context: RESOLVED_DISPUTE_CONTEXT,
      conversationHistory: [],
      llmClient,
      adapters,
      registry,
    });

    expect(result.error).toBeUndefined();
    expect(result.proposedActions).toBeUndefined();
    expect(result.answer.toLowerCase()).toContain("already resolved");
  });

  it("investigating a resolved dispute proposes no evidence — there's nothing missing to recommend", async () => {
    const result = await runAgentTurn({
      prompt: "Help me resolve this dispute",
      enabledSources: ["commas"],
      context: RESOLVED_DISPUTE_CONTEXT,
      conversationHistory: [],
      llmClient,
      adapters,
      registry,
    });

    expect(result.error).toBeUndefined();
    expect(result.proposedActions).toBeUndefined();
  });
});

describe("propose-tools are never offered outside dispute context", () => {
  let adapters: SourceAdapter[];
  let registry: Map<string, RegisteredTool>;
  const llmClient = new StubLlmClient();

  beforeAll(async () => {
    adapters = [await CommasAdapter.createMock()];
    registry = await buildToolRegistry(adapters);
  });

  it("a context-less run never gets proposedActions, even asking to draft something", async () => {
    const result = await runAgentTurn({
      prompt: "draft a response for me",
      enabledSources: ["commas"],
      context: undefined,
      conversationHistory: [],
      llmClient,
      adapters,
      registry,
    });
    expect(result.proposedActions).toBeUndefined();
  });
});
