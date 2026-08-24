import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { App } from "../src/App";

/**
 * One unified conversation model backs both the global AI chat and dispute-scoped
 * investigations (docs/AI_ASSISTANT_IMPLEMENTATION_STATUS.md's current phase) — a single
 * `chats` array (useChatStore), distinguished by `Chat.type`/`disputeId`, not two separate
 * stores. These tests drive the real top-level `<App />` (Sidebar → Resolution Center → Chat)
 * rather than calling store functions directly, so they exercise the actual reopen/delete/
 * isolation behavior a seller experiences, not just the store's internal API.
 */

function mockFetchOnce(body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => body });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** The frontend only ever renders text accumulated from `delta` frames (see
 * useChatStore.tsx's `appendStreamDelta`) — a response with no delta frames leaves the message
 * empty and it gets pruned entirely (`finalizeStreamedMessage`), so this always emits at least
 * one delta before the closing `done` frame, mirroring the real shared-agent stream shape. */
function mockStreamFetchOnce(answerText: string) {
  const body = sseFrame("delta", { text: answerText }) + sseFrame("done", { text: answerText });
  const fetchMock = vi
    .fn()
    .mockResolvedValue(new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const COMPOSER_PLACEHOLDER = "Ask about your business…";

function sendViaComposer(text: string) {
  fireEvent.change(screen.getByPlaceholderText(COMPOSER_PLACEHOLDER), { target: { value: text } });
  fireEvent.keyDown(screen.getByPlaceholderText(COMPOSER_PLACEHOLDER), { key: "Enter" });
}

describe("unified conversation model", () => {
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

  describe("global chat: create, continue, reopen, delete", () => {
    it("creates a new global chat, sends and receives a message, and it's still there after switching away and back", async () => {
      render(<App />);
      fireEvent.click(screen.getByLabelText("Chat"));

      fireEvent.click(screen.getByText("New chat"));
      mockStreamFetchOnce("Reply to message A.");
      sendViaComposer("message A");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });
      expect(screen.getByText("Reply to message A.")).toBeInTheDocument();

      // Continue the SAME chat with a second message — not a new one.
      mockStreamFetchOnce("Second reply.");
      sendViaComposer("follow up");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });
      expect(screen.getByText("Reply to message A.")).toBeInTheDocument();
      expect(screen.getByText("Second reply.")).toBeInTheDocument();

      // Navigate away (Dashboard) and back — the conversation survives (create/continue, not
      // recreated fresh every time the Chat view mounts).
      fireEvent.click(screen.getByLabelText("Home"));
      fireEvent.click(screen.getByLabelText("Chat"));
      expect(screen.getByRole("button", { name: /message A/ })).toBeInTheDocument();
    });

    it("reopening a different chat from history restores its own messages, not the one just left", async () => {
      render(<App />);
      fireEvent.click(screen.getByLabelText("Chat"));

      fireEvent.click(screen.getByText("New chat"));
      mockStreamFetchOnce("Reply to A.");
      sendViaComposer("message A");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });

      fireEvent.click(screen.getByText("New chat"));
      mockStreamFetchOnce("Reply to B.");
      sendViaComposer("message B");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });
      expect(screen.getByText("Reply to B.")).toBeInTheDocument();
      expect(screen.queryByText("Reply to A.")).not.toBeInTheDocument();

      // Reopen A via the history list.
      fireEvent.click(screen.getByRole("button", { name: /message A/ }));
      expect(screen.getByText("Reply to A.")).toBeInTheDocument();
      // B's own reply is nowhere in the document — only its history-list row (still legitimately
      // listed) survives, not its conversation content.
      expect(screen.queryByText("Reply to B.")).not.toBeInTheDocument();
    });

    it("deleting a global chat removes it from history, never resurrects it, and doesn't touch Resolution Center", async () => {
      render(<App />);
      fireEvent.click(screen.getByLabelText("Chat"));

      fireEvent.click(screen.getByText("New chat"));
      mockStreamFetchOnce("Reply to be deleted.");
      sendViaComposer("delete me");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });
      expect(screen.getByText("Reply to be deleted.")).toBeInTheDocument();

      const row = screen.getByRole("button", { name: /delete me/ }).closest<HTMLElement>("div.group")!;
      fireEvent.click(within(row).getByLabelText("Delete chat"));

      // Gone from global history immediately.
      expect(screen.queryByRole("button", { name: /delete me/ })).not.toBeInTheDocument();
      expect(screen.queryByText("Reply to be deleted.")).not.toBeInTheDocument();

      // Doesn't show up inside Resolution Center in any form.
      fireEvent.click(screen.getByLabelText("Resolution Center"));
      expect(screen.queryByText("delete me")).not.toBeInTheDocument();
      expect(screen.queryByText("Reply to be deleted.")).not.toBeInTheDocument();

      // Never resurrected by navigating back to Chat.
      fireEvent.click(screen.getByLabelText("Chat"));
      expect(screen.queryByRole("button", { name: /delete me/ })).not.toBeInTheDocument();
      expect(screen.queryByText("Reply to be deleted.")).not.toBeInTheDocument();
    });
  });

  describe("dispute chat: create/open, starter actions, reopen, context isolation", () => {
    it("opening a dispute with no existing investigation shows dispute-specific starter actions, not global chat history", async () => {
      render(<App />);
      fireEvent.click(screen.getByLabelText("Resolution Center"));
      fireEvent.click(screen.getByText("Sarah Johnson"));
      fireEvent.click(screen.getByText("Investigate with AI"));

      // Dispute-specific starter actions from the unified conversation model's "no existing
      // investigation" empty state.
      expect(screen.getByText("Investigate this dispute")).toBeInTheDocument();
      expect(screen.getByText("Find relevant evidence")).toBeInTheDocument();
      expect(screen.getByText("Check connected apps")).toBeInTheDocument();
      expect(screen.getByText("Analyze customer history")).toBeInTheDocument();
      expect(screen.getByText("Draft a response")).toBeInTheDocument();

      // Never the unrelated global chat's seeded history bleeding into a fresh dispute panel.
      expect(screen.queryByText("Which discount codes have been used the most?")).not.toBeInTheDocument();
      expect(screen.queryByText(/LAUNCH20/)).not.toBeInTheDocument();
    });

    it("reopening an existing dispute investigation restores its conversation instead of the starter actions", async () => {
      render(<App />);
      fireEvent.click(screen.getByLabelText("Resolution Center"));
      fireEvent.click(screen.getByText("Sarah Johnson"));
      fireEvent.click(screen.getByText("Investigate with AI"));

      mockFetchOnce({ steps: [], answer: "Sarah's investigation summary.", toolSummary: [] });
      fireEvent.click(screen.getByText("Investigate this dispute"));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
      expect(screen.getByText("Sarah's investigation summary.")).toBeInTheDocument();

      // Close the panel, navigate away, come back, reopen the SAME dispute.
      fireEvent.click(screen.getByLabelText("Close panel"));
      fireEvent.click(screen.getByLabelText("Home"));
      fireEvent.click(screen.getByLabelText("Resolution Center"));
      fireEvent.click(screen.getByText("Sarah Johnson"));
      fireEvent.click(screen.getByText("Investigate with AI"));

      // The restored conversation, not a fresh starter-action empty state.
      expect(screen.getByText("Sarah's investigation summary.")).toBeInTheDocument();
      expect(screen.queryByText("Analyze customer history")).not.toBeInTheDocument();
    });

    it("a different dispute's investigation is fully isolated — its own starter actions, never another dispute's messages", async () => {
      render(<App />);
      fireEvent.click(screen.getByLabelText("Resolution Center"));
      fireEvent.click(screen.getByText("Sarah Johnson"));
      fireEvent.click(screen.getByText("Investigate with AI"));

      mockFetchOnce({ steps: [], answer: "Sarah's investigation summary.", toolSummary: [] });
      fireEvent.click(screen.getByText("Investigate this dispute"));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
      fireEvent.click(screen.getByLabelText("Close panel"));

      // Open a different dispute.
      fireEvent.click(screen.getByLabelText("Resolution Center"));
      fireEvent.click(screen.getByText("Marcus Webb"));
      fireEvent.click(screen.getByText("Investigate with AI"));

      // Marcus's panel starts fresh (its own starter actions) — never Sarah's conversation.
      expect(screen.getByText("Analyze customer history")).toBeInTheDocument();
      expect(screen.queryByText("Sarah's investigation summary.")).not.toBeInTheDocument();

      mockFetchOnce({ steps: [], answer: "Marcus's investigation summary.", toolSummary: [] });
      fireEvent.click(screen.getByText("Investigate this dispute"));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
      expect(screen.getByText("Marcus's investigation summary.")).toBeInTheDocument();

      // Going back to Sarah's dispute still shows only Sarah's conversation.
      fireEvent.click(screen.getByLabelText("Close panel"));
      fireEvent.click(screen.getByLabelText("Resolution Center"));
      fireEvent.click(screen.getByText("Sarah Johnson"));
      fireEvent.click(screen.getByText("Investigate with AI"));
      expect(screen.getByText("Sarah's investigation summary.")).toBeInTheDocument();
      expect(screen.queryByText("Marcus's investigation summary.")).not.toBeInTheDocument();
    });

    it("audit P1-7: a dispute investigation with real messages stays reachable from the global Chat page's history list", async () => {
      render(<App />);
      fireEvent.click(screen.getByLabelText("Resolution Center"));
      fireEvent.click(screen.getByText("Sarah Johnson"));
      fireEvent.click(screen.getByText("Investigate with AI"));

      mockFetchOnce({ steps: [], answer: "Sarah's investigation summary.", toolSummary: [] });
      fireEvent.click(screen.getByText("Investigate this dispute"));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
      fireEvent.click(screen.getByLabelText("Close panel"));

      // Navigate away entirely (not "open in full chat view") and the investigation is still
      // reachable from the Chat page's own history list — it's a real conversation that
      // happened, not just visible while it's the active row.
      fireEvent.click(screen.getByLabelText("Chat"));
      const historyRow = screen.getByRole("button", { name: /Dispute #2481/ });
      expect(historyRow).toBeInTheDocument();

      fireEvent.click(historyRow);
      expect(screen.getByText("Sarah's investigation summary.")).toBeInTheDocument();
    });
  });
});
