// @vitest-environment node
import { describe, expect, it, beforeAll } from "vitest";
import { CommasAdapter } from "../../server/adapters/commasAdapter.js";
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
