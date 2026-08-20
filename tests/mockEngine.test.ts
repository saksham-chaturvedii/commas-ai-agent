import { describe, expect, it } from "vitest";
import { planMockRun } from "../src/lib/mockEngine";

describe("planMockRun", () => {
  it("returns a direct answer with no tool steps for a greeting", () => {
    const plan = planMockRun({ prompt: "hi", enabledSources: ["commas"], context: undefined });
    expect(plan.steps).toHaveLength(0);
    expect(plan.toolSummary).toHaveLength(0);
    expect(plan.answer.length).toBeGreaterThan(0);
  });

  it("runs Commas tool steps for a sales summary question", () => {
    const plan = planMockRun({ prompt: "Give me a summary of my sales this month", enabledSources: ["commas"], context: undefined });
    expect(plan.steps.length).toBeGreaterThan(0);
    expect(plan.steps.every((s) => s.sourceId === "commas")).toBe(true);
    expect(plan.toolSummary).toHaveLength(plan.steps.length);
  });

  it("declines to check Commas data when the Commas source is disabled", () => {
    const plan = planMockRun({ prompt: "sales summary", enabledSources: [], context: undefined });
    expect(plan.steps).toHaveLength(0);
    expect(plan.answer.toLowerCase()).toContain("commas");
  });

  it("only uses connected-app sources that are enabled for a dispute investigation", () => {
    const plan = planMockRun({
      prompt: "Investigate this dispute",
      enabledSources: ["commas", "fathom"],
      context: { kind: "dispute", id: "2481", label: "Dispute #2481" },
    });
    const sourceIds = new Set(plan.steps.map((s) => s.sourceId));
    expect(sourceIds.has("fathom")).toBe(true);
    expect(sourceIds.has("zoom")).toBe(false);
    expect(sourceIds.has("clickfunnels")).toBe(false);
    expect(plan.answer).toContain("turned off");
  });

  it("includes a drafted response only when asked to draft", () => {
    const investigateOnly = planMockRun({
      prompt: "Investigate this dispute",
      enabledSources: ["commas"],
      context: { kind: "dispute", id: "2481", label: "Dispute #2481" },
    });
    const withDraft = planMockRun({
      prompt: "Draft an evidence response for this dispute",
      enabledSources: ["commas"],
      context: { kind: "dispute", id: "2481", label: "Dispute #2481" },
    });
    expect(investigateOnly.answer).not.toContain("Drafted response");
    expect(withDraft.answer).toContain("Drafted response");
  });

  it("falls back honestly for an unrecognized prompt", () => {
    const plan = planMockRun({ prompt: "what's the weather in tokyo", enabledSources: ["commas"], context: undefined });
    expect(plan.steps).toHaveLength(0);
    expect(plan.answer.toLowerCase()).toContain("demo");
  });
});
