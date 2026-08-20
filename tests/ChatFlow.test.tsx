import { useEffect, useState } from "react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, fireEvent } from "@testing-library/react";
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
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
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

  it("clicking a suggestion calls the agent backend and renders its real response", async () => {
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

    // the request went to the real backend endpoint with the right shape
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/agent/run",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          prompt: "Summarize my sales this month",
          enabledSources: ["commas", "google-calendar", "zoom", "fathom"],
          context: undefined,
        }),
      }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(screen.getByText("Found 1 transaction totaling $499.00.")).toBeInTheDocument();
    expect(screen.getByText(/Checked 2 sources/)).toBeInTheDocument();
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
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    );

    render(
      <ChatStoreProvider>
        <Harness />
      </ChatStoreProvider>,
    );

    fireEvent.click(screen.getByText("Look up a customer"));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(screen.getByText(/Couldn't reach the agent/)).toBeInTheDocument();
  });
});
