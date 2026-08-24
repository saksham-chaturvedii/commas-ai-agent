import { useEffect, useState } from "react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ChatStoreProvider, useChatStore } from "../src/hooks/useChatStore";
import { ChatWorkspace } from "../src/components/chat/ChatWorkspace";
import type { Chat } from "../src/lib/types";

/**
 * Agent-initiated application actions (docs/AI_ASSISTANT_ARCHITECTURE.md §7) — the full
 * propose → approve → execute → UI-updates flow, exercised the same way ChatFlow.test.tsx's
 * approval-card test does: a real dispute-context chat, a mocked /api/agent/run JSON response
 * (the legacy path is the only one that offers propose-tools this phase), then real clicks on
 * the rendered ProposedActionCard. `evidenceByDispute`/`responseDraftByDispute` are read
 * straight off useChatStore — the exact same state DisputeDetail renders — to prove the
 * Resolution Center's state, not a chat-local copy, is what actually changed.
 */

function DisputeHarness({ disputeId = "2481" }: { disputeId?: string }) {
  const { createChat, chats, evidenceByDispute, responseDraftByDispute } = useChatStore();
  const [chatId, setChatId] = useState<string | null>(null);
  useEffect(() => {
    setChatId(createChat({ kind: "dispute", id: disputeId, label: `Dispute #${disputeId}` }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const chat = chats.find((c: Chat) => c.id === chatId);
  return (
    <div>
      <div data-testid="evidence-count">{(evidenceByDispute[disputeId] ?? []).length}</div>
      <div data-testid="evidence-titles">{(evidenceByDispute[disputeId] ?? []).map((i) => i.title).join(", ")}</div>
      <div data-testid="response-draft">{responseDraftByDispute[disputeId] ?? ""}</div>
      {chat && <ChatWorkspace chat={chat} />}
    </div>
  );
}

function mockFetchOnce(body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => body });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function sendAndAwait(text: string) {
  fireEvent.change(screen.getByPlaceholderText("Ask about your business…"), { target: { value: text } });
  fireEvent.keyDown(screen.getByPlaceholderText("Ask about your business…"), { key: "Enter" });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2000);
  });
}

describe("agent-proposed actions: propose -> approve -> execute -> UI updates", () => {
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

  it("approving an add_evidence proposal (all items kept checked) adds every item to the Resolution Center's own evidence state", async () => {
    mockFetchOnce({
      steps: [],
      answer: "### Situation summary\nDispute #2481 — investigated.",
      toolSummary: [],
      proposedActions: [
        {
          id: "action-1",
          type: "add_evidence",
          disputeId: "2481",
          summary: "I found 2 strong evidence items.",
          status: "pending",
          items: [
            { category: "Customer communications", title: "Gmail thread", record: "record A", sourceType: "communication", sourceLabel: "Gmail" },
            { category: "Access & activity records", title: "Fathom call", record: "record B", sourceType: "activity", sourceLabel: "Fathom" },
          ],
        },
      ],
    });

    render(
      <ChatStoreProvider>
        <DisputeHarness />
      </ChatStoreProvider>,
    );
    await sendAndAwait("recommend evidence for me");

    expect(screen.getByTestId("evidence-count").textContent).toBe("0");
    expect(screen.getByText("I found 2 strong evidence items.")).toBeInTheDocument();
    expect(screen.getByText("Gmail thread")).toBeInTheDocument();
    expect(screen.getByText("Fathom call")).toBeInTheDocument();

    fireEvent.click(screen.getByText(/Add selected/));

    expect(screen.getByTestId("evidence-count").textContent).toBe("2");
    expect(screen.getByTestId("evidence-titles").textContent).toBe("Gmail thread, Fathom call");
    expect(screen.getByText("Added 2 evidence items.")).toBeInTheDocument();
  });

  it("unchecking one item before approving only adds the items still checked", async () => {
    mockFetchOnce({
      steps: [],
      answer: "### Situation summary\nDispute #2481 — investigated.",
      toolSummary: [],
      proposedActions: [
        {
          id: "action-1",
          type: "add_evidence",
          disputeId: "2481",
          summary: "I found 2 strong evidence items.",
          status: "pending",
          items: [
            { category: "Customer communications", title: "Gmail thread", record: "record A", sourceType: "communication", sourceLabel: "Gmail" },
            { category: "Access & activity records", title: "Fathom call", record: "record B", sourceType: "activity", sourceLabel: "Fathom" },
          ],
        },
      ],
    });

    render(
      <ChatStoreProvider>
        <DisputeHarness />
      </ChatStoreProvider>,
    );
    await sendAndAwait("recommend evidence for me");

    fireEvent.click(screen.getByLabelText("Include Fathom call"));
    fireEvent.click(screen.getByText(/Add selected/));

    expect(screen.getByTestId("evidence-count").textContent).toBe("1");
    expect(screen.getByTestId("evidence-titles").textContent).toBe("Gmail thread");
    expect(screen.getByText("Added 1 evidence item.")).toBeInTheDocument();
  });

  it("declining a proposal adds nothing and shows a quiet dismissed state", async () => {
    mockFetchOnce({
      steps: [],
      answer: "### Situation summary\nDispute #2481 — investigated.",
      toolSummary: [],
      proposedActions: [
        {
          id: "action-1",
          type: "add_evidence",
          disputeId: "2481",
          summary: "I found 1 strong evidence item.",
          status: "pending",
          items: [{ category: "Customer communications", title: "Gmail thread", record: "record A", sourceType: "communication", sourceLabel: "Gmail" }],
        },
      ],
    });

    render(
      <ChatStoreProvider>
        <DisputeHarness />
      </ChatStoreProvider>,
    );
    await sendAndAwait("recommend evidence for me");

    fireEvent.click(screen.getByText("Dismiss"));

    expect(screen.getByTestId("evidence-count").textContent).toBe("0");
    expect(screen.getByText("Dismissed.")).toBeInTheDocument();
  });

  it("approving a draft_response proposal sets the Resolution Center's own response draft state", async () => {
    mockFetchOnce({
      steps: [],
      answer: "I've put together a draft based on the evidence — review it below.",
      toolSummary: [],
      proposedActions: [
        {
          id: "action-1",
          type: "draft_response",
          disputeId: "2481",
          summary: "I can draft a response based on the evidence.",
          status: "pending",
          draftText: "Dear customer, our records show you actively used the product.",
        },
      ],
    });

    render(
      <ChatStoreProvider>
        <DisputeHarness />
      </ChatStoreProvider>,
    );
    await sendAndAwait("draft a response for me");

    expect(screen.getByTestId("response-draft").textContent).toBe("");
    fireEvent.click(screen.getByText("Use this draft"));

    expect(screen.getByTestId("response-draft").textContent).toBe("Dear customer, our records show you actively used the product.");
    expect(screen.getByText("Draft applied to the response.")).toBeInTheDocument();
  });

  it("a proposal that somehow targets an already-resolved dispute renders as non-actionable, never lets the seller approve it", async () => {
    mockFetchOnce({
      steps: [],
      answer: "Here's a draft.",
      toolSummary: [],
      proposedActions: [
        {
          id: "action-1",
          type: "draft_response",
          disputeId: "2390", // Priya Nair — resolved ("Won") in the seed data
          summary: "I can draft a response.",
          status: "pending",
          draftText: "Stale draft text.",
        },
      ],
    });

    render(
      <ChatStoreProvider>
        <DisputeHarness disputeId="2390" />
      </ChatStoreProvider>,
    );
    await sendAndAwait("draft a response for me");

    expect(screen.getByText(/already resolved/)).toBeInTheDocument();
    expect(screen.queryByText("Use this draft")).not.toBeInTheDocument();
    expect(screen.getByTestId("response-draft").textContent).toBe("");
  });
});
