import { useEffect, useState } from "react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ChatStoreProvider, useChatStore } from "../src/hooks/useChatStore";
import { ChatWorkspace } from "../src/components/chat/ChatWorkspace";
import type { Chat } from "../src/lib/types";
import { DEFAULT_ENABLED_SOURCES } from "../src/lib/mockData";
import { disputesNeedingAttention } from "../src/lib/disputeData";

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

/** SSE frame helper matching server/app.ts's POST /api/agent/stream wire format exactly. */
function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** Mocks a successful shared-agent stream response — global/dashboard chats only
 * (src/hooks/useChatStore.tsx). Splits the answer into a few chunks so the test genuinely
 * exercises incremental delta handling, not just a single-frame response. */
function mockStreamFetchOnce(answerText: string) {
  const words = answerText.split(" ");
  let body = words.map((w, i) => sseFrame("delta", { text: i === 0 ? w : ` ${w}` })).join("");
  body += sseFrame("done", { text: answerText });
  const fetchMock = vi
    .fn()
    .mockResolvedValue(new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** Mocks the shared-agent stream reporting a server-side error via an `event: error` frame —
 * the streaming equivalent of the legacy JSON path's `{error: {code, message}}` shape. */
function mockStreamErrorOnce(message: string) {
  const body = sseFrame("error", { message });
  const fetchMock = vi
    .fn()
    .mockResolvedValue(new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } }));
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

  it("clicking a suggestion in a global (context-less) chat calls the shared agent's streaming endpoint and renders the real incremental response", async () => {
    // Global-mode chats route through POST /api/agent/stream (the shared agent runtime,
    // docs/AI_ASSISTANT_ARCHITECTURE.md) — dispute-context chats keep the /api/agent/run path
    // exercised by the other tests in this file below.
    const fetchMock = mockStreamFetchOnce("Found 1 transaction totaling $499.00.");

    render(
      <ChatStoreProvider>
        <Harness />
      </ChatStoreProvider>,
    );

    fireEvent.click(screen.getByText("Summarize my sales"));

    // user message appears immediately, before the network call resolves
    expect(screen.getByText("Summarize my sales this month")).toBeInTheDocument();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/agent/stream");
    expect(init.method).toBe("POST");
    const requestBody = JSON.parse(init.body);
    expect(requestBody).toEqual({
      sessionId: expect.any(String),
      mode: "global",
      message: "Summarize my sales this month",
      history: [],
      // GLOBAL chat's own context envelope (docs/AI_ASSISTANT_ARCHITECTURE.md §5) — this
      // chat's enabled sources, plus a workspace-level summary computed from the same
      // src/lib/disputeData.ts the Resolution Center list itself renders from (never a
      // separate, hand-duplicated dataset — see tests/server/sharedAgent.test.ts for the
      // context model's own coverage).
      enabledSources: DEFAULT_ENABLED_SOURCES,
      workspace: { disputesNeedingAttention: disputesNeedingAttention() },
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500); // let the stream's microtasks + the 250ms tail-reset settle
    });

    // No client-side reveal timers gate this path — the text is real incremental network
    // output, already fully rendered as soon as the (mocked) stream finishes.
    expect(screen.getByText("Found 1 transaction totaling $499.00.")).toBeInTheDocument();
  });

  it("sends prior messages as history on a second turn (multi-turn memory) — client-resent history, distinct from the shared agent's own server-side session memory tested in tests/server/sharedAgent.test.ts", async () => {
    mockStreamFetchOnce("First answer.");

    render(
      <ChatStoreProvider>
        <Harness />
      </ChatStoreProvider>,
    );

    fireEvent.click(screen.getByText("Summarize my sales"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(screen.getByText("First answer.")).toBeInTheDocument();

    const secondFetchMock = mockStreamFetchOnce("Second answer.");
    fireEvent.change(screen.getByPlaceholderText("Ask about your business…"), { target: { value: "And what else?" } });
    fireEvent.keyDown(screen.getByPlaceholderText("Ask about your business…"), { key: "Enter" });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    const secondCallBody = JSON.parse(secondFetchMock.mock.calls[0][1].body);
    expect(secondCallBody.history).toEqual([
      { role: "user", text: "Summarize my sales this month" },
      { role: "assistant", text: "First answer." },
    ]);
    expect(secondCallBody.mode).toBe("global");
    expect(screen.getByText("Second answer.")).toBeInTheDocument();
  });

  it("renders a clean error state when the shared agent reports a failure (event: error frame)", async () => {
    mockStreamErrorOnce("The Commas connection is unavailable right now.");

    render(
      <ChatStoreProvider>
        <Harness />
      </ChatStoreProvider>,
    );

    fireEvent.click(screen.getByText("Analyze my disputes"));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
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

  it("renders an approval card for a write action, and only sends it after Approve (dispute-context chats keep the full legacy tool/approval path)", async () => {
    // Write actions and approval only exist on the legacy /api/agent/run path, which now serves
    // dispute-context chats exclusively (global chats route to the shared agent's streaming
    // endpoint instead — see the tests above — and don't call tools yet by design). A
    // dispute-context Harness is what actually exercises this in the running app: Resolution
    // Center → Investigate with AI.
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
        <DisputeHarness />
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

  it("deleting a chat mid-stream doesn't let its orphaned completion free up runChatId while a newer run is still active", async () => {
    // Regression: deleteChat frees runChatId synchronously (unlike cancelRun's 300ms hold), so a
    // brand-new run can start on a different chat before the deleted chat's own in-flight
    // request settles. When that orphaned request later resolves, it must not touch the shared
    // run-tracking state at all — otherwise it can free runChatId while the *new* run is still
    // genuinely in progress, which would let a third run start on top of it (defeating the
    // one-run-at-a-time guard, P1-6).
    let releaseA: (() => void) | null = null;
    const aPending = new Promise<Response>((resolve) => {
      releaseA = () =>
        resolve(new Response(sseFrame("done", { text: "Stale A reply." }), { status: 200, headers: { "content-type": "text/event-stream" } }));
    });
    const bPending = new Promise<Response>(() => {}); // never resolves — chat B stays "running" for this whole test
    let callCount = 0;
    const fetchMock = vi.fn().mockImplementation(() => {
      callCount += 1;
      return callCount === 1 ? aPending : bPending;
    });
    vi.stubGlobal("fetch", fetchMock);

    function ThreeChatHarness() {
      const { createChat, deleteChat, sendMessage } = useChatStore();
      const [ids, setIds] = useState<string[]>([]);
      useEffect(() => {
        setIds([createChat(), createChat(), createChat()]);
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, []);
      if (ids.length < 3) return null;
      return (
        <div>
          <button type="button" onClick={() => sendMessage(ids[0], "first")}>
            send-a
          </button>
          <button type="button" onClick={() => deleteChat(ids[0])}>
            delete-a
          </button>
          <button type="button" onClick={() => sendMessage(ids[1], "second")}>
            send-b
          </button>
          <button type="button" onClick={() => sendMessage(ids[2], "third")}>
            send-c
          </button>
        </div>
      );
    }

    render(
      <ChatStoreProvider>
        <ThreeChatHarness />
      </ChatStoreProvider>,
    );
    await act(async () => {});

    fireEvent.click(screen.getByText("send-a"));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText("delete-a"));
    fireEvent.click(screen.getByText("send-b")); // allowed: deleteChat freed runChatId
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      releaseA?.();
      // Long enough for A's orphaned promise to settle and, if the bug is present, for its
      // trailing 250ms setTimeout to fire and clear runChatId.
      await vi.advanceTimersByTimeAsync(500);
    });

    fireEvent.click(screen.getByText("send-c")); // must be refused — B's run is still genuinely active
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reconciles a chat persisted mid-run back to idle with an interruption notice (P1-8)", () => {
    const interrupted: Chat = {
      id: "chat-interrupted",
      title: "Interrupted chat",
      type: "global",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: "running",
      enabledSources: ["commas"],
      messages: [{ id: "m-user", role: "user", text: "Summarize my sales", ts: new Date().toISOString() }],
    };
    localStorage.setItem(
      "commas-ai-agent:v3",
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
    mockStreamFetchOnce("Persisted answer.");

    const { unmount } = render(
      <ChatStoreProvider>
        <Harness />
      </ChatStoreProvider>,
    );
    fireEvent.click(screen.getByText("Summarize my sales"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
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
