import { useState } from "react";
import { describe, expect, it, afterEach } from "vitest";
import { act, render, screen, cleanup } from "@testing-library/react";
import { ChatStoreProvider, useChatStore } from "../src/hooks/useChatStore";
import type { PageContext } from "../src/lib/types";

/**
 * Dispute AI session identity (docs/active-context.md — "Dispute AI Session Identity"):
 * deleting a dispute's chat and reopening "Investigate with AI" must create a fresh, genuinely
 * usable chat — not one whose id is unusable because createChat() returned it before the
 * chat actually existed in state. Locks in a real bug: createChat() originally mutated a
 * `resultId` variable inside the setChats() updater and read it immediately after, which
 * isn't reliable (same class of bug as evidenceUpload.ts's addFiles() — see that file's fix
 * comment). The symptom in the real app: RightPanel bound to an empty-string chatId and
 * rendered nothing at all after "Start new session" -> "Investigate with AI".
 */

const DISPUTE_CONTEXT: PageContext = { kind: "dispute", id: "2481", label: "Dispute #2481 — Sarah Johnson" };

function Harness() {
  const { createChat, deleteChat, chats } = useChatStore();
  const [lastId, setLastId] = useState<string | null>(null);

  return (
    <div>
      <button type="button" onClick={() => setLastId(createChat(DISPUTE_CONTEXT))}>
        open-dispute-panel
      </button>
      <button type="button" onClick={() => lastId && deleteChat(lastId)}>
        start-new-session
      </button>
      <div data-testid="last-id">{lastId ?? ""}</div>
      <div data-testid="resolved-chat">
        {lastId && chats.find((c) => c.id === lastId) ? "found" : "not-found"}
      </div>
      <div data-testid="dispute-chat-count">{chats.filter((c) => c.context?.id === "2481").length}</div>
    </div>
  );
}

describe("dispute AI session identity", () => {
  afterEach(() => cleanup());

  it("createChat's returned id is immediately usable — the chat it points to actually exists", () => {
    render(
      <ChatStoreProvider>
        <Harness />
      </ChatStoreProvider>,
    );

    act(() => screen.getByText("open-dispute-panel").click());

    expect(screen.getByTestId("last-id").textContent).not.toBe("");
    expect(screen.getByTestId("resolved-chat").textContent).toBe("found");
  });

  it("delete then reopen: the new session is a different, real chat — not the stale id, not nothing", () => {
    render(
      <ChatStoreProvider>
        <Harness />
      </ChatStoreProvider>,
    );

    act(() => screen.getByText("open-dispute-panel").click());
    const firstId = screen.getByTestId("last-id").textContent;
    expect(screen.getByTestId("resolved-chat").textContent).toBe("found");

    act(() => screen.getByText("start-new-session").click());
    expect(screen.getByTestId("dispute-chat-count").textContent).toBe("0"); // truly deleted, not just hidden

    act(() => screen.getByText("open-dispute-panel").click());
    const secondId = screen.getByTestId("last-id").textContent;

    expect(secondId).not.toBe("");
    expect(secondId).not.toBe(firstId); // a genuinely new chat, not the deleted one resurrected
    expect(screen.getByTestId("resolved-chat").textContent).toBe("found"); // and it's immediately real, not a dangling id
    expect(screen.getByTestId("dispute-chat-count").textContent).toBe("1");
  });

  it("repeated opens on an untouched empty dispute chat reuse the same id (no pile-up)", () => {
    render(
      <ChatStoreProvider>
        <Harness />
      </ChatStoreProvider>,
    );

    act(() => screen.getByText("open-dispute-panel").click());
    const firstId = screen.getByTestId("last-id").textContent;
    act(() => screen.getByText("open-dispute-panel").click());
    const secondId = screen.getByTestId("last-id").textContent;

    expect(secondId).toBe(firstId);
    expect(screen.getByTestId("dispute-chat-count").textContent).toBe("1");
  });
});
