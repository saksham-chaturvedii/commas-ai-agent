import { describe, expect, it } from "vitest";
import { buildDisputeContext } from "../src/lib/mockData";
import { disputesNeedingAttention, getDispute } from "../src/lib/disputeData";
import type { AIEvidenceItem } from "../src/lib/disputeData";

/**
 * Unit coverage for the frontend half of the shared agent's context model
 * (docs/AI_ASSISTANT_ARCHITECTURE.md §5): `buildDisputeContext` is what supplies dispute facts
 * to BOTH the legacy runtime (dispute chats, POST /api/agent/run) and the shared agent (via
 * server/agent/context/model.ts's agentContextFromPageContext), so its own isolation properties
 * — one dispute's facts never bleeding into another's — are exactly as load-bearing as the
 * server-side session isolation covered in tests/server/sharedAgent.test.ts.
 */

function evidenceItem(category: string, overrides: Partial<AIEvidenceItem> = {}): AIEvidenceItem {
  return {
    id: `ev-${Math.random()}`,
    title: "Some evidence",
    record: "record",
    why: "why",
    sourceType: "manual",
    sourceLabel: "Manual",
    addedBy: "seller",
    category,
    files: [],
    ...overrides,
  };
}

describe("buildDisputeContext", () => {
  it("returns this dispute's own facts, matching src/lib/disputeData.ts", () => {
    const context = buildDisputeContext("2481");
    expect(context.id).toBe("2481");
    expect(context.dispute?.customerName).toBe("Sarah Johnson");
    expect(context.dispute?.status).toBe("Needs response");
  });

  it("two different disputes never share evidence, even called back-to-back", () => {
    const a = buildDisputeContext("2481", [evidenceItem("Transaction & payment details")]);
    const b = buildDisputeContext("2390", [
      evidenceItem("Customer communications"),
      evidenceItem("Customer communications"),
    ]);

    expect(a.dispute?.evidenceSummary).toEqual([{ category: "Transaction & payment details", count: 1 }]);
    expect(b.dispute?.evidenceSummary).toEqual([{ category: "Customer communications", count: 2 }]);
    // Cross-contamination check: neither summary mentions the other's category at all.
    expect(a.dispute?.evidenceSummary.some((s) => s.category === "Customer communications")).toBe(false);
    expect(b.dispute?.evidenceSummary.some((s) => s.category === "Transaction & payment details")).toBe(false);
  });

  it("omitting evidenceItems (e.g. a dispute with none added yet) yields an empty summary, not a crash", () => {
    const context = buildDisputeContext("2481");
    expect(context.dispute?.evidenceSummary).toEqual([]);
  });

  it("an unknown dispute id degrades to a bare context instead of throwing", () => {
    const context = buildDisputeContext("does-not-exist");
    expect(context.dispute).toBeUndefined();
    expect(context.id).toBe("does-not-exist");
  });
});

describe("disputesNeedingAttention (GLOBAL chat's workspace context)", () => {
  it("includes only disputes with status \"Needs response\", never a resolved one", () => {
    const summary = disputesNeedingAttention();
    const resolved = getDispute("2390"); // Priya Nair — status "Won" in the seed data
    expect(resolved?.status).toBe("Won");
    expect(summary.some((d) => d.disputeId === "2390")).toBe(false);
    expect(summary.length).toBeGreaterThan(0);
    expect(summary.every((d) => d.disputeId !== "2390")).toBe(true);
  });

  it("never includes dispute-specific fields beyond the thin workspace projection (no evidence, no customer email)", () => {
    const summary = disputesNeedingAttention();
    for (const d of summary) {
      expect(Object.keys(d).sort()).toEqual(["amountCents", "customerName", "disputeId", "evidenceDueAt", "reason"].sort());
    }
  });
});
