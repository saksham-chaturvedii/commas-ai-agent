import { useEffect, useState } from "react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ChatStoreProvider, useChatStore } from "../src/hooks/useChatStore";
import { ChatWorkspace } from "../src/components/chat/ChatWorkspace";
import { DisputeDetail } from "../src/components/resolution/DisputeDetail";
import type { Chat } from "../src/lib/types";
import type { AIEvidenceItem } from "../src/lib/disputeData";

/**
 * Connects the real multi-step dispute investigation to the UI (docs/
 * AI_ASSISTANT_IMPLEMENTATION_STATUS.md's current phase): dynamic, tool-grounded progress
 * steps that don't fake completion, a structured case report (not prose to parse), and the
 * AI-found vs. human-verified distinction on evidence already in the case. The backend side of
 * this (server/llm/stubClient.ts's structured InvestigationReport, server/agent/registry.ts's
 * resultLabelFor) is covered by tests/server/runtime.test.ts; this file covers the UI that
 * actually renders it.
 */

function mockFetchOnce(body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => body });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function DisputeHarness() {
  const { createChat, chats } = useChatStore();
  const [chatId, setChatId] = useState<string | null>(null);
  useEffect(() => {
    setChatId(createChat({ kind: "dispute", id: "2481", label: "Dispute #2481 — Sarah Johnson" }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const chat = chats.find((c: Chat) => c.id === chatId);
  if (!chat) return null;
  return <ChatWorkspace chat={chat} />;
}

const INVESTIGATION_PLAN = {
  steps: [
    { id: "commas-commas_get_dispute-0", sourceId: "commas", classification: "read", label: "Checking dispute record…", doneLabel: "Reviewed dispute details" },
    {
      id: "fathom-fathom_search_calls-1",
      sourceId: "fathom",
      classification: "read",
      label: "Searching Fathom calls…",
      doneLabel: "Found completed coaching calls",
    },
    { id: "commas-propose_add_evidence-2", sourceId: "commas", classification: "read", label: "Cross-referencing evidence…", doneLabel: "Cross-referenced evidence" },
  ],
  answer: "I investigated dispute #2481 across 1 connected source — here's the case report.",
  toolSummary: [
    { sourceId: "commas", label: "Dispute record", ok: true, resultLabel: "Reviewed dispute details" },
    { sourceId: "fathom", label: "Fathom calls", ok: true, resultLabel: "Found completed coaching calls" },
    { sourceId: "commas", label: "Evidence cross-reference", ok: true, resultLabel: "Cross-referenced evidence" },
  ],
  investigationReport: {
    disputeId: "2481",
    caseSummary: "Dispute #2481 — $499, \"product not received\", opened August 9. Sarah engaged heavily with the product after purchase.",
    evidenceFound: [
      {
        id: "fathom-0",
        category: "Access & activity records",
        title: "Fathom call — 42-minute session",
        record: "Walked Sarah through the portal, first-week goals, and how to book live sessions.",
        why: "Shows direct engagement with the product or service around the time of purchase.",
        sourceType: "activity",
        sourceLabel: "Fathom",
        sourceId: "fathom",
        raw: {
          id: "fathom_call_1",
          title: "Pro Coaching Program — Onboarding call",
          occurredAt: "2026-08-04T15:00:00Z",
          durationMinutes: 42,
          transcriptExcerpt: "...so once you're in the portal, module one is right there...",
          recordingUrl: "mock://fathom/recordings/fathom_call_1",
        },
      },
    ],
    missingInformation: ["GoHighLevel, Gmail — not enabled for this chat. Turn on in the sources menu for a fuller picture."],
    potentialContradictions: [],
    recommendedNextAction: "Add your access/activity records and transaction confirmation to the evidence checklist.",
    caseStrength: { label: "Moderate", explanation: "Engagement points to forgotten-purchase, not non-delivery, but isn't airtight yet." },
  },
};

describe("investigation connected to the UI", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("shows dynamic, real progress steps while running, then a structured case report — never fake/static completion", async () => {
    mockFetchOnce(INVESTIGATION_PLAN);

    render(
      <ChatStoreProvider>
        <DisputeHarness />
      </ChatStoreProvider>,
    );

    fireEvent.change(screen.getByPlaceholderText("Ask about your business…"), { target: { value: "investigate this dispute" } });
    fireEvent.keyDown(screen.getByPlaceholderText("Ask about your business…"), { key: "Enter" });

    // Let the (mocked) backend call resolve — real tool results are in hand, but the
    // client-side reveal timers haven't paced through them yet.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    // The header names the actual dispute, shown as soon as real steps are in hand.
    expect(screen.getByText("Investigating dispute #2481")).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });

    // The case report renders as real structured sections, not prose.
    expect(screen.getByText("Case report — Dispute #2481")).toBeInTheDocument();
    expect(screen.getByText("Moderate")).toBeInTheDocument();
    expect(screen.getByText(/Evidence found/)).toBeInTheDocument();
    expect(screen.getByText("Fathom call — 42-minute session")).toBeInTheDocument();
    expect(screen.getByText("Missing information")).toBeInTheDocument();
    expect(screen.getByText(/GoHighLevel, Gmail/)).toBeInTheDocument();
    expect(screen.getByText("Recommended next action")).toBeInTheDocument();
    // No fabricated contradictions when the investigation found none.
    expect(screen.queryByText("Potential contradictions")).not.toBeInTheDocument();

    // The completed step checklist shows real, result-aware labels — not the generic in-flight
    // gerund, and not a static "done" rephrasing.
    expect(screen.getByText("Reviewed dispute details")).toBeInTheDocument();
    expect(screen.getByText("Found completed coaching calls")).toBeInTheDocument();
    expect(screen.getByText("Cross-referenced evidence")).toBeInTheDocument();
  });

  it("lets the seller inspect an evidence finding's underlying source before deciding anything", async () => {
    mockFetchOnce(INVESTIGATION_PLAN);

    render(
      <ChatStoreProvider>
        <DisputeHarness />
      </ChatStoreProvider>,
    );

    fireEvent.change(screen.getByPlaceholderText("Ask about your business…"), { target: { value: "investigate this dispute" } });
    fireEvent.keyDown(screen.getByPlaceholderText("Ask about your business…"), { key: "Enter" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });

    fireEvent.click(screen.getByText("Inspect"));

    // Real underlying source detail, not just a repeat of the summary already shown.
    expect(screen.getByText("Fathom source view")).toBeInTheDocument();
    expect(screen.getByText(/module one is right there/)).toBeInTheDocument();
  });
});

describe("AI found vs. human verified — evidence already in the case", () => {
  afterEach(() => cleanup());

  const baseItem: Omit<AIEvidenceItem, "id" | "addedBy"> = {
    title: "Fathom call — 42-minute session",
    record: "Walked Sarah through the portal.",
    why: "Shows direct engagement with the product.",
    sourceType: "activity",
    sourceLabel: "Fathom",
    category: "Access & activity records",
    files: [],
    verifiedByHuman: false,
  };

  /** Seeds one evidence item through the real store (addEvidenceItem) and renders DisputeDetail
   * reading that same store state — evidenceItems is a prop in the real app too (App.tsx passes
   * evidenceByDispute[disputeId]), so this mirrors how a "Mark as verified" click would actually
   * flow through to a re-render, rather than a static array the click can't affect. */
  function EvidenceHarness({ item }: { item: AIEvidenceItem }) {
    const { evidenceByDispute, addEvidenceItem } = useChatStore();
    useEffect(() => {
      addEvidenceItem("2481", item);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return (
      <DisputeDetail
        disputeId="2481"
        evidenceItems={evidenceByDispute["2481"] ?? []}
        onAddEvidence={vi.fn()}
        onBack={vi.fn()}
        onInvestigate={vi.fn()}
      />
    );
  }

  it("labels AI-found evidence distinctly from human-verified, and never marks it verified without an explicit click", () => {
    const aiItem: AIEvidenceItem = { ...baseItem, id: "ai-evidence-1", addedBy: "ai" };
    render(
      <ChatStoreProvider>
        <EvidenceHarness item={aiItem} />
      </ChatStoreProvider>,
    );

    expect(screen.getByText("AI found")).toBeInTheDocument();
    expect(screen.queryByText("Human verified")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Mark as verified"));

    expect(screen.getByText("Human verified")).toBeInTheDocument();
    expect(screen.queryByText("AI found")).not.toBeInTheDocument();
  });

  it("never shows an AI-found/human-verified badge on evidence the seller added manually themselves", () => {
    const sellerItem: AIEvidenceItem = { ...baseItem, id: "seller-1", addedBy: "seller" };
    render(
      <ChatStoreProvider>
        <EvidenceHarness item={sellerItem} />
      </ChatStoreProvider>,
    );

    expect(screen.queryByText("AI found")).not.toBeInTheDocument();
    expect(screen.queryByText("Human verified")).not.toBeInTheDocument();
    expect(screen.queryByText("Mark as verified")).not.toBeInTheDocument();
  });
});
