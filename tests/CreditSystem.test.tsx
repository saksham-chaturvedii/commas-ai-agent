import { useEffect, useState } from "react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { ChatStoreProvider, useChatStore } from "../src/hooks/useChatStore";
import { ChatWorkspace } from "../src/components/chat/ChatWorkspace";
import { CreditIndicator } from "../src/components/chat/CreditIndicator";
import type { Chat } from "../src/lib/types";

/**
 * One unified credit model for the whole workspace (docs/AI_ASSISTANT_IMPLEMENTATION_STATUS.md's
 * current phase): total/used/remaining, low/exhausted UI states, the mock purchase flow, and a
 * demo-configurable per-turn cost (`src/lib/mockData.ts`'s `CREDIT_COSTS`) charged once, AFTER
 * the agent's work finishes successfully — never up front, never on a technical failure, never
 * twice. Global chat and dispute investigations draw from the exact same `credits` state; there
 * is no separate dispute-chat balance. Covers scenarios A–F (the original 6) plus G onward
 * (investigation tiers, unified balance, failed-request non-charging, no double-charge).
 */

function Harness() {
  const { createChat, chats, setRemainingCreditsForDemo, credits } = useChatStore();
  const [chatId, setChatId] = useState<string | null>(null);
  useEffect(() => {
    setChatId(createChat());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const chat = chats.find((c: Chat) => c.id === chatId);
  return (
    <div>
      <div data-testid="credits-readout">
        {credits.totalCredits - credits.usedCredits}/{credits.totalCredits}
      </div>
      <CreditIndicator />
      <button type="button" onClick={() => setRemainingCreditsForDemo(50)}>
        dev-set-50
      </button>
      <button type="button" onClick={() => setRemainingCreditsForDemo(1)}>
        dev-set-1
      </button>
      <button type="button" onClick={() => setRemainingCreditsForDemo(271)}>
        dev-set-271
      </button>
      {chat && <ChatWorkspace chat={chat} />}
    </div>
  );
}

/** Same as `Harness`, but the chat is dispute-scoped (Resolution Center) — routes through the
 * legacy JSON `/api/agent/run` path instead of the streaming one, so investigation-tier pricing
 * (`creditCostForDisputeTurn`) actually applies. Reads from the SAME `credits` state as
 * `Harness` above — there is only ever one balance. */
function DisputeHarness() {
  const { createChat, chats, setRemainingCreditsForDemo, credits } = useChatStore();
  const [chatId, setChatId] = useState<string | null>(null);
  useEffect(() => {
    setChatId(createChat({ kind: "dispute", id: "2481", label: "Dispute #2481 — Sarah Johnson" }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const chat = chats.find((c: Chat) => c.id === chatId);
  return (
    <div>
      <div data-testid="credits-readout">
        {credits.totalCredits - credits.usedCredits}/{credits.totalCredits}
      </div>
      <CreditIndicator />
      <button type="button" onClick={() => setRemainingCreditsForDemo(1)}>
        dev-set-1
      </button>
      {chat && <ChatWorkspace chat={chat} />}
    </div>
  );
}

/** Mocks the shared agent's streaming response — every chat in this file is context-less
 * (global-mode), so `sendMessage` (src/hooks/useChatStore.tsx) always routes through
 * POST /api/agent/stream now, not the legacy JSON /api/agent/run (docs/AI_ASSISTANT_ARCHITECTURE.md). */
function mockStreamFetchOnce(answerText: string) {
  const body = `event: delta\ndata: ${JSON.stringify({ text: answerText })}\n\nevent: done\ndata: ${JSON.stringify({ text: answerText })}\n\n`;
  const fetchMock = vi
    .fn()
    .mockResolvedValue(new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** Mocks a streaming request that fails at the network/transport level (never even reaches the
 * agent's own error-frame path) — the shape `finalizeStreamedMessage`'s `catch` branch handles. */
function mockStreamFetchFailureOnce() {
  const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** Mocks the legacy JSON `/api/agent/run` response used by dispute-context chats. */
function mockFetchOnce(body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => body });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** Mocks a legacy-path network failure — never even reaches the server, so `runAgentTurn`
 * rejects and `sendMessage`'s catch branch builds a synthetic `server_unavailable` plan. */
function mockFetchFailureOnce() {
  const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("chat credit system", () => {
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

  it("A. normal usage: 300/300 -> send message -> still 300/300 while running -> 299/300 only once the agent's work actually succeeds", async () => {
    mockStreamFetchOnce("Answer.");
    render(
      <ChatStoreProvider>
        <Harness />
      </ChatStoreProvider>,
    );
    expect(screen.getByTestId("credits-readout").textContent).toBe("300/300");

    fireEvent.click(screen.getByText("Summarize my sales"));
    // Not charged yet — consumption happens AFTER successful agent work, never up front.
    expect(screen.getByTestId("credits-readout").textContent).toBe("300/300");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(screen.getByText("Answer.")).toBeInTheDocument();
    // Charged exactly once, now that the turn actually succeeded.
    expect(screen.getByTestId("credits-readout").textContent).toBe("299/300");

    // A second successful message charges again, and only once more (not per step/write).
    mockStreamFetchOnce("Second answer.");
    fireEvent.change(screen.getByPlaceholderText("Ask about your business…"), { target: { value: "another question" } });
    fireEvent.keyDown(screen.getByPlaceholderText("Ask about your business…"), { key: "Enter" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(screen.getByTestId("credits-readout").textContent).toBe("298/300");
  });

  it("B. low credits: indicator shows a low-balance style and clicking it opens Add More Credits", () => {
    render(
      <ChatStoreProvider>
        <Harness />
      </ChatStoreProvider>,
    );
    fireEvent.click(screen.getByText("dev-set-50"));
    expect(screen.getByTestId("credits-readout").textContent).toBe("50/300");

    const pill = screen.getByTitle(/AI credits remaining/);
    expect(pill.className).toContain("warning");

    fireEvent.click(pill);
    expect(screen.getByText("Add more credits")).toBeInTheDocument();
  });

  it("C. last credit: send -> still 1/300 while running -> 0/300 once the answer lands -> composer disabled -> purchase CTA appears", async () => {
    mockStreamFetchOnce("Last answer.");
    render(
      <ChatStoreProvider>
        <Harness />
      </ChatStoreProvider>,
    );
    fireEvent.click(screen.getByText("dev-set-1"));
    expect(screen.getByTestId("credits-readout").textContent).toBe("1/300");

    fireEvent.click(screen.getByText("Summarize my sales"));
    // Sending with exactly 1 credit left is allowed to START (the block is on 0, not on
    // "might not have enough for whatever this turn ends up costing") — not charged yet.
    expect(screen.getByTestId("credits-readout").textContent).toBe("1/300");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(screen.getByTestId("credits-readout").textContent).toBe("0/300");
    expect(screen.getByPlaceholderText("You're out of AI credits")).toBeDisabled();
    expect(screen.getByText("Buy Credits")).toBeInTheDocument();
  });

  it("D. exhausted: attempting to send never reaches the agent (no fetch call), balance never goes negative", async () => {
    const fetchMock = mockStreamFetchOnce("Should not be called.");
    render(
      <ChatStoreProvider>
        <Harness />
      </ChatStoreProvider>,
    );
    fireEvent.click(screen.getByText("dev-set-1"));
    fireEvent.click(screen.getByText("Summarize my sales")); // spends the last credit
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(screen.getByTestId("credits-readout").textContent).toBe("0/300");
    fetchMock.mockClear();

    // Composer is disabled, and typing+Enter (bypassing the disabled click guard) still can't
    // trigger a second send — the textarea itself is disabled, so no keydown reaches it.
    const composer = screen.getByPlaceholderText("You're out of AI credits");
    expect(composer).toBeDisabled();
    fireEvent.keyDown(composer, { key: "Enter" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("credits-readout").textContent).toBe("0/300"); // never negative
  });

  it("D2. exhausted applies to dispute chats too — same unified balance, same block, no separate dispute-chat allowance", async () => {
    const fetchMock = mockFetchOnce({ steps: [], answer: "Standard answer.", toolSummary: [{ sourceId: "commas", label: "Dispute record", ok: true }] });
    render(
      <ChatStoreProvider>
        <DisputeHarness />
      </ChatStoreProvider>,
    );
    fireEvent.click(screen.getByText("dev-set-1"));
    // Spend the one remaining credit via the composer directly (dispute chats don't render the
    // global suggestion chips).
    fireEvent.change(screen.getByPlaceholderText("Ask about your business…"), { target: { value: "investigate" } });
    fireEvent.keyDown(screen.getByPlaceholderText("Ask about your business…"), { key: "Enter" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(screen.getByTestId("credits-readout").textContent).toBe("0/300");
    fetchMock.mockClear();

    // Now confirm a second attempt at 0 balance is blocked.
    const composer = screen.getByPlaceholderText("You're out of AI credits");
    expect(composer).toBeDisabled();
    fireEvent.keyDown(composer, { key: "Enter" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("E. purchase from zero: 0/300 -> buy +50 -> 50/350 -> composer re-enabled", async () => {
    mockStreamFetchOnce("Spends last credit.");
    render(
      <ChatStoreProvider>
        <Harness />
      </ChatStoreProvider>,
    );
    fireEvent.click(screen.getByText("dev-set-1"));
    fireEvent.click(screen.getByText("Summarize my sales"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(screen.getByTestId("credits-readout").textContent).toBe("0/300");

    fireEvent.click(screen.getByText("Buy Credits")); // the composer's exhausted-state CTA
    expect(screen.getByText("Add more credits")).toBeInTheDocument();
    // default selection is +50 credits per spec — submit via the modal's own button
    fireEvent.click(screen.getAllByText("Buy Credits")[1]);

    expect(screen.getByTestId("credits-readout").textContent).toBe("50/350");
    expect(screen.getByText("50 credits added")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Ask about your business…")).not.toBeDisabled();
  });

  it("F. purchase while credits remain: 271/300 -> buy +50 -> 321/350 (usedCredits untouched)", () => {
    render(
      <ChatStoreProvider>
        <Harness />
      </ChatStoreProvider>,
    );
    fireEvent.click(screen.getByText("dev-set-271"));
    expect(screen.getByTestId("credits-readout").textContent).toBe("271/300");

    const pill = screen.getByTitle(/AI credits remaining/);
    fireEvent.click(pill);
    expect(screen.getByText("Add more credits")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Buy Credits")); // modal's submit button (only one on screen here)

    expect(screen.getByTestId("credits-readout").textContent).toBe("321/350");
  });

  it("E2. after a top-up from zero, usage continues: the next successful message charges normally", async () => {
    mockStreamFetchOnce("Spends last credit.");
    render(
      <ChatStoreProvider>
        <Harness />
      </ChatStoreProvider>,
    );
    fireEvent.click(screen.getByText("dev-set-1"));
    fireEvent.click(screen.getByText("Summarize my sales"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(screen.getByTestId("credits-readout").textContent).toBe("0/300");

    fireEvent.click(screen.getByText("Buy Credits"));
    fireEvent.click(screen.getAllByText("Buy Credits")[1]);
    expect(screen.getByTestId("credits-readout").textContent).toBe("50/350");

    mockStreamFetchOnce("Post-top-up answer.");
    fireEvent.change(screen.getByPlaceholderText("Ask about your business…"), { target: { value: "another question" } });
    fireEvent.keyDown(screen.getByPlaceholderText("Ask about your business…"), { key: "Enter" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(screen.getByText("Post-top-up answer.")).toBeInTheDocument();
    expect(screen.getByTestId("credits-readout").textContent).toBe("49/350");
  });

  describe("G. investigation credit usage — the demo-configurable tiered model (src/lib/mockData.ts's CREDIT_COSTS)", () => {
    it("a plain single-source dispute answer costs the standard tier (1 credit)", async () => {
      mockFetchOnce({ steps: [], answer: "Standard answer.", toolSummary: [{ sourceId: "commas", label: "Dispute record", ok: true }] });
      render(
        <ChatStoreProvider>
          <DisputeHarness />
        </ChatStoreProvider>,
      );
      expect(screen.getByTestId("credits-readout").textContent).toBe("300/300");
      fireEvent.click(screen.getByText("Investigate this dispute"));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
      expect(screen.getByText("Standard answer.")).toBeInTheDocument();
      expect(screen.getByTestId("credits-readout").textContent).toBe("299/300");
    });

    it("checking 2+ sources without a full investigation report costs the multi-source tier (3 credits)", async () => {
      mockFetchOnce({
        steps: [],
        answer: "Multi-source answer.",
        toolSummary: [
          { sourceId: "commas", label: "Dispute record", ok: true },
          { sourceId: "fathom", label: "Fathom calls", ok: true },
        ],
      });
      render(
        <ChatStoreProvider>
          <DisputeHarness />
        </ChatStoreProvider>,
      );
      fireEvent.click(screen.getByText("Investigate this dispute"));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
      expect(screen.getByText("Multi-source answer.")).toBeInTheDocument();
      expect(screen.getByTestId("credits-readout").textContent).toBe("297/300");
    });

    it("a full structured investigation report costs the advanced tier (5 credits), regardless of source count", async () => {
      mockFetchOnce({
        steps: [],
        answer: "Investigated — see the case report.",
        toolSummary: [{ sourceId: "commas", label: "Dispute record", ok: true }],
        investigationReport: {
          disputeId: "2481",
          caseSummary: "Summary.",
          evidenceFound: [],
          missingInformation: [],
          potentialContradictions: [],
          recommendedNextAction: "Do something.",
          caseStrength: { label: "Moderate", explanation: "Because." },
        },
      });
      render(
        <ChatStoreProvider>
          <DisputeHarness />
        </ChatStoreProvider>,
      );
      fireEvent.click(screen.getByText("Investigate this dispute"));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
      expect(screen.getByText("Case report — Dispute #2481")).toBeInTheDocument();
      expect(screen.getByTestId("credits-readout").textContent).toBe("295/300");
    });
  });

  it("H. one unified balance — a dispute investigation and a global chat message draw from the exact same pool, never separate balances", async () => {
    function Both() {
      return (
        <div>
          <div data-testid="global">
            <Harness />
          </div>
          <div data-testid="dispute">
            <DisputeHarness />
          </div>
        </div>
      );
    }
    mockFetchOnce({
      steps: [],
      answer: "Investigated.",
      toolSummary: [
        { sourceId: "commas", label: "Dispute record", ok: true },
        { sourceId: "fathom", label: "Fathom calls", ok: true },
      ],
    });
    render(
      <ChatStoreProvider>
        <Both />
      </ChatStoreProvider>,
    );
    // Both readouts start from the same 300/300 pool.
    const readouts = screen.getAllByTestId("credits-readout");
    expect(readouts[0].textContent).toBe("300/300");
    expect(readouts[1].textContent).toBe("300/300");

    fireEvent.click(screen.getByText("Investigate this dispute")); // multi-source tier: 3 credits
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    // The investigation's charge is visible from BOTH readouts — one shared balance.
    for (const readout of screen.getAllByTestId("credits-readout")) {
      expect(readout.textContent).toBe("297/300");
    }

    mockStreamFetchOnce("Global reply.");
    const globalPane = within(screen.getByTestId("global"));
    fireEvent.change(globalPane.getByPlaceholderText("Ask about your business…"), { target: { value: "a global question" } });
    fireEvent.keyDown(globalPane.getByPlaceholderText("Ask about your business…"), { key: "Enter" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    for (const readout of screen.getAllByTestId("credits-readout")) {
      expect(readout.textContent).toBe("296/300");
    }
  });

  describe("I. failed technical requests are never charged", () => {
    it("global/streaming: a network failure produces an error message and charges nothing", async () => {
      mockStreamFetchFailureOnce();
      render(
        <ChatStoreProvider>
          <Harness />
        </ChatStoreProvider>,
      );
      fireEvent.click(screen.getByText("Summarize my sales"));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      expect(screen.getByText(/temporarily unreachable/)).toBeInTheDocument();
      expect(screen.getByTestId("credits-readout").textContent).toBe("300/300");
    });

    it("dispute/legacy: a network failure produces an error message and charges nothing", async () => {
      mockFetchFailureOnce();
      render(
        <ChatStoreProvider>
          <DisputeHarness />
        </ChatStoreProvider>,
      );
      fireEvent.click(screen.getByText("Investigate this dispute"));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
      expect(screen.getByText(/temporarily unreachable/)).toBeInTheDocument();
      expect(screen.getByTestId("credits-readout").textContent).toBe("300/300");
    });
  });

  it("J. cancelling mid-stream charges nothing, and a stale response that resolves after cancellation still doesn't charge", async () => {
    let releaseFirst: (() => void) | null = null;
    const firstPending = new Promise<Response>((resolve) => {
      releaseFirst = () =>
        resolve(
          new Response(`event: delta\ndata: ${JSON.stringify({ text: "Stale." })}\n\nevent: done\ndata: ${JSON.stringify({ text: "Stale." })}\n\n`, {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          }),
        );
    });
    const fetchMock = vi.fn().mockReturnValue(firstPending);
    vi.stubGlobal("fetch", fetchMock);

    render(
      <ChatStoreProvider>
        <Harness />
      </ChatStoreProvider>,
    );
    fireEvent.click(screen.getByText("Summarize my sales"));
    expect(screen.getByTestId("credits-readout").textContent).toBe("300/300");

    // Cancel before the (still-pending) response ever arrives.
    fireEvent.click(screen.getByLabelText("Stop"));
    expect(screen.getByTestId("credits-readout").textContent).toBe("300/300");

    // The orphaned request finally resolves — it must not charge retroactively, regardless of
    // whatever stale content it delivers (a separate, pre-existing display concern this credits
    // model doesn't need to solve — the point here is strictly "never charge for it").
    await act(async () => {
      releaseFirst?.();
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(screen.getByTestId("credits-readout").textContent).toBe("300/300");

    // A genuinely new send afterward still charges normally — cancellation didn't leave the
    // charge path permanently stuck off.
    mockStreamFetchOnce("Real answer.");
    fireEvent.change(screen.getByPlaceholderText("Ask about your business…"), { target: { value: "for real this time" } });
    fireEvent.keyDown(screen.getByPlaceholderText("Ask about your business…"), { key: "Enter" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(screen.getByText("Real answer.")).toBeInTheDocument();
    expect(screen.getByTestId("credits-readout").textContent).toBe("299/300");
  });
});
