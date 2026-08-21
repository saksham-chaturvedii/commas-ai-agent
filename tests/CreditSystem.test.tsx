import { useEffect, useState } from "react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ChatStoreProvider, useChatStore } from "../src/hooks/useChatStore";
import { ChatWorkspace } from "../src/components/chat/ChatWorkspace";
import { CreditIndicator } from "../src/components/chat/CreditIndicator";
import type { Chat } from "../src/lib/types";

/**
 * Prototype chat-credit system (docs/active-context.md — "Chat Credit System"): total/used/
 * remaining model, 1 credit per sent message, low/exhausted UI states, and the mock purchase
 * flow. Covers the 6 scenarios (A–F) the task asked to verify.
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

function mockFetchOnce(body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => body });
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

  it("A. normal usage: 300/300 -> send message -> 299/300, charged once per message, not per step/write", async () => {
    mockFetchOnce({ steps: [], answer: "Answer.", toolSummary: [] });
    render(
      <ChatStoreProvider>
        <Harness />
      </ChatStoreProvider>,
    );
    expect(screen.getByTestId("credits-readout").textContent).toBe("300/300");

    fireEvent.click(screen.getByText("Summarize my sales"));
    // charged synchronously, before the network response even resolves
    expect(screen.getByTestId("credits-readout").textContent).toBe("299/300");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(screen.getByText("Answer.")).toBeInTheDocument();
    expect(screen.getByTestId("credits-readout").textContent).toBe("299/300"); // completion doesn't charge again
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

  it("C. last credit: send -> 0/300 -> composer disabled -> purchase CTA appears", async () => {
    mockFetchOnce({ steps: [], answer: "Last answer.", toolSummary: [] });
    render(
      <ChatStoreProvider>
        <Harness />
      </ChatStoreProvider>,
    );
    fireEvent.click(screen.getByText("dev-set-1"));
    expect(screen.getByTestId("credits-readout").textContent).toBe("1/300");

    fireEvent.click(screen.getByText("Summarize my sales"));
    expect(screen.getByTestId("credits-readout").textContent).toBe("0/300");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(screen.getByPlaceholderText("You're out of AI credits")).toBeDisabled();
    expect(screen.getByText("Buy Credits")).toBeInTheDocument();
  });

  it("D. exhausted: attempting to send never reaches the agent (no fetch call), balance never goes negative", async () => {
    const fetchMock = mockFetchOnce({ steps: [], answer: "Should not be called.", toolSummary: [] });
    render(
      <ChatStoreProvider>
        <Harness />
      </ChatStoreProvider>,
    );
    fireEvent.click(screen.getByText("dev-set-1"));
    fireEvent.click(screen.getByText("Summarize my sales")); // spends the last credit
    expect(screen.getByTestId("credits-readout").textContent).toBe("0/300");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    fetchMock.mockClear();

    // Composer is disabled, and typing+Enter (bypassing the disabled click guard) still can't
    // trigger a second send — the textarea itself is disabled, so no keydown reaches it.
    const composer = screen.getByPlaceholderText("You're out of AI credits");
    expect(composer).toBeDisabled();
    fireEvent.keyDown(composer, { key: "Enter" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("credits-readout").textContent).toBe("0/300"); // never negative
  });

  it("E. purchase from zero: 0/300 -> buy +50 -> 50/350 -> composer re-enabled", async () => {
    mockFetchOnce({ steps: [], answer: "Spends last credit.", toolSummary: [] });
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
});
