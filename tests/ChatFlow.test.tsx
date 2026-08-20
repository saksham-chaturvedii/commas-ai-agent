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

describe("chat flow (mocked engine, no real agent)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
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

  it("clicking a suggestion runs the mock engine and renders progress then an answer", async () => {
    render(
      <ChatStoreProvider>
        <Harness />
      </ChatStoreProvider>,
    );

    fireEvent.click(screen.getByText("Summarize my sales"));

    // user message appears immediately
    expect(screen.getByText("Summarize my sales this month")).toBeInTheDocument();

    // progress steps play out over time
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(screen.getByText(/This month you've done/)).toBeInTheDocument();
    expect(screen.getByText(/Checked 2 sources/)).toBeInTheDocument();
  });
});
