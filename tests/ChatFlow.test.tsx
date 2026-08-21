import { useEffect, useState } from "react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ChatStoreProvider, useChatStore } from "../src/hooks/useChatStore";
import { ChatWorkspace } from "../src/components/chat/ChatWorkspace";
import type { Chat } from "../src/lib/types";

function Harness() {
  const { createChat, chats } = useChatStore();
  const [chatId, setChatId] = useState<string | null>(null);

  useEffect(() => {
    setChatId(createChat());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const chat = chats.find((c: Chat) => c.id === chatId);
  if (!chat) return null;
  return <ChatWorkspace chat={chat} />;
}

function mockFetchOnce(body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => body });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("chat flow (wired to the real agent backend over POST /api/agent/run)", () => {
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

  it("shows the empty state with suggested capabilities for a fresh chat", () => {
    render(
      <ChatStoreProvider>
        <Harness />
      </ChatStoreProvider>,
    );
    expect(screen.getByText("How can I help you today?")).toBeInTheDocument();
    expect(screen.getByText("Summarize my sales")).toBeInTheDocument();
  });

  it("clicking a suggestion calls the agent backend (with empty history on a fresh chat) and renders its real response", async () => {
    const fetchMock = mockFetchOnce({
      steps: [
        { id: "commas-1", sourceId: "commas", classification: "read", label: "Checking transaction history…" },
        { id: "commas-2", sourceId: "commas", classification: "read", label: "Checking customer records…" },
      ],
      answer: "Found 1 transaction totaling $499.00.",
      toolSummary: [
        { sourceId: "commas", label: "Transaction history", ok: true },
        { sourceId: "commas", label: "Customer records", ok: true },
      ],
    });

    render(
      <ChatStoreProvider>
        <Harness />
      </ChatStoreProvider>,
    );

    fireEvent.click(screen.getByText("Summarize my sales"));

    // user message appears immediately, before the network call resolves
    expect(screen.getByText("Summarize my sales this month")).toBeInTheDocument();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/agent/run",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          prompt: "Summarize my sales this month",
          enabledSources: ["commas", "google-calendar", "zoom", "fathom"],
          context: undefined,
          history: [],
        }),
      }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(screen.getByText("Found 1 transaction totaling $499.00.")).toBeInTheDocument();
    expect(screen.getByText(/Checked 2 sources/)).toBeInTheDocument();
  });

  it("sends prior messages as history on a second turn (multi-turn memory)", async () => {
    mockFetchOnce({ steps: [], answer: "First answer.", toolSummary: [] });

    render(
      <ChatStoreProvider>
        <Harness />
      </ChatStoreProvider>,
    );

    fireEvent.click(screen.getByText("Summarize my sales"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(screen.getByText("First answer.")).toBeInTheDocument();

    const secondFetchMock = mockFetchOnce({ steps: [], answer: "Second answer.", toolSummary: [] });
    fireEvent.change(screen.getByPlaceholderText("Ask about your business…"), { target: { value: "And what else?" } });
    fireEvent.keyDown(screen.getByPlaceholderText("Ask about your business…"), { key: "Enter" });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    const secondCallBody = JSON.parse(secondFetchMock.mock.calls[0][1].body);
    expect(secondCallBody.history).toEqual([
      { role: "user", text: "Summarize my sales this month" },
      { role: "assistant", text: "First answer." },
    ]);
  });

  it("renders a clean error state when the agent backend reports a failure", async () => {
    mockFetchOnce({
      steps: [],
      answer: "",
      toolSummary: [],
      error: { code: "server_unavailable", message: "The Commas connection is unavailable right now." },
    });

    render(
      <ChatStoreProvider>
        <Harness />
      </ChatStoreProvider>,
    );

    fireEvent.click(screen.getByText("Analyze my disputes"));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(
      screen.getByText("I ran into a problem: The Commas connection is unavailable right now."),
    ).toBeInTheDocument();
  });

  it("shows a clean error state when the backend is unreachable (network failure)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    render(
      <ChatStoreProvider>
        <Harness />
      </ChatStoreProvider>,
    );

    fireEvent.click(screen.getByText("Look up a customer"));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    // Product-voice copy — must never leak dev instructions like "npm run dev:server"
    // (PRODUCT_READINESS_AUDIT.md P1-4).
    expect(screen.getByText(/temporarily unreachable/)).toBeInTheDocument();
    expect(screen.queryByText(/npm run/)).not.toBeInTheDocument();
  });

  it("renders an approval card for a write action, and only sends it after Approve", async () => {
    mockFetchOnce({
      steps: [],
      answer: "",
      toolSummary: [],
      pendingApproval: {
        toolCallId: "call-1",
        toolName: "commas_mark_dispute_response_ready",
        summary: "Mark the evidence response for Dispute #2481 as ready to submit.",
        input: { dispute_id: "2481" },
      },
    });

    render(
      <ChatStoreProvider>
        <Harness />
      </ChatStoreProvider>,
    );

    fireEvent.change(screen.getByPlaceholderText("Ask about your business…"), { target: { value: "mark the response ready" } });
    fireEvent.keyDown(screen.getByPlaceholderText("Ask about your business…"), { key: "Enter" });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(screen.getByText("Mark the evidence response for Dispute #2481 as ready to submit.")).toBeInTheDocument();

    const approveMock = mockFetchOnce({ steps: [], answer: "Done — marked ready.", toolSummary: [] });
    fireEvent.click(screen.getByText("Approve"));

    expect(approveMock).toHaveBeenCalledWith(
      "/api/agent/approve",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"decision":"approve"'),
      }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(screen.getByText("Done — marked ready.")).toBeInTheDocument();
  });

  it("refuses to start a second run while another chat's run is in flight (P1-6)", async () => {
    // A fetch that never resolves keeps the first chat's run active for the whole test.
    const hangingFetch = vi.fn().mockReturnValue(new Promise(() => {}));
    vi.stubGlobal("fetch", hangingFetch);

    function TwoChatHarness() {
      const { createChat, chats, sendMessage } = useChatStore();
      const [ids, setIds] = useState<string[]>([]);
      useEffect(() => {
        const a = createChat();
        const b = createChat({ kind: "dispute", id: "2481", label: "Dispute #2481" });
        setIds([a, b]);
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, []);
      if (ids.length < 2) return null;
      return (
        <div>
          <button type="button" onClick={() => sendMessage(ids[0], "first run")}>
            send-a
          </button>
          <button type="button" onClick={() => sendMessage(ids[1], "second run")}>
            send-b
          </button>
          <div data-testid="chat-b-messages">{chats.find((c) => c.id === ids[1])?.messages.length ?? -1}</div>
        </div>
      );
    }

    render(
      <ChatStoreProvider>
        <TwoChatHarness />
      </ChatStoreProvider>,
    );
    await act(async () => {});
    fireEvent.click(screen.getByText("send-a"));
    expect(hangingFetch).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText("send-b")); // must be refused, not clobber run A
    expect(hangingFetch).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("chat-b-messages").textContent).toBe("0");
  });

  it("reconciles a chat persisted mid-run back to idle with an interruption notice (P1-8)", () => {
    const interrupted: Chat = {
      id: "chat-interrupted",
      title: "Interrupted chat",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: "running",
      enabledSources: ["commas"],
      messages: [{ id: "m-user", role: "user", text: "Summarize my sales", ts: new Date().toISOString() }],
    };
    localStorage.setItem(
      "commas-ai-agent:v2",
      JSON.stringify({ chats: [interrupted], sources: [], credits: { totalCredits: 300, usedCredits: 0 } }),
    );

    function ReadHarness() {
      const { chats } = useChatStore();
      const chat = chats.find((c) => c.id === "chat-interrupted");
      return (
        <div>
          <div data-testid="status">{chat?.status}</div>
          <div data-testid="last-message">{chat?.messages[chat.messages.length - 1]?.text}</div>
        </div>
      );
    }
    render(
      <ChatStoreProvider>
        <ReadHarness />
      </ChatStoreProvider>,
    );
    expect(screen.getByTestId("status").textContent).toBe("idle");
    expect(screen.getByTestId("last-message").textContent).toContain("interrupted");
  });

  it("persists chats to localStorage and restores them on a fresh provider mount (reload simulation)", async () => {
    mockFetchOnce({ steps: [], answer: "Persisted answer.", toolSummary: [] });

    const { unmount } = render(
      <ChatStoreProvider>
        <Harness />
      </ChatStoreProvider>,
    );
    fireEvent.click(screen.getByText("Summarize my sales"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(screen.getByText("Persisted answer.")).toBeInTheDocument();
    unmount();

    // A fresh provider (simulating a page reload) should hydrate from localStorage, not the
    // seed data — read state directly rather than through Harness (which always creates a
    // new empty chat on mount, which would otherwise mask whether persistence worked).
    function ReadOnlyHarness() {
      const { chats } = useChatStore();
      const persisted = chats.find((c) => c.messages.some((m) => m.text === "Persisted answer."));
      return <div>{persisted ? `found: ${persisted.title}` : "not found"}</div>;
    }
    render(
      <ChatStoreProvider>
        <ReadOnlyHarness />
      </ChatStoreProvider>,
    );
    expect(screen.getByText(/^found:/)).toBeInTheDocument();
  });
});
