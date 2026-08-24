import { X, PanelRightOpen, RotateCcw } from "lucide-react";
import { useChatStore } from "../../hooks/useChatStore";
import { AgentMark } from "../shell/AgentMark";
import { CreditIndicator } from "./CreditIndicator";
import { ChatWorkspace } from "./ChatWorkspace";

/**
 * Right-side AI panel — docks alongside page content rather than overlaying it (spec §2.5),
 * modeled on docs/references/notion-ai-chat-3.png. Shows whichever chat App.tsx currently has
 * bound to the panel (created fresh, with page context attached, the first time it's opened).
 *
 * `chats` here is the exact same store the main Chat page's history list reads from — there is
 * no separate dispute-chat store (docs/active-context.md — "Dispute AI Session Identity"). A
 * dispute-context chat is intentionally excluded from the main history list's own display (see
 * ChatHistoryList.tsx's `!c.context` filter) but still lives in and is deleted from the one
 * `chats` array, via the same `deleteChat` the sidebar's trash icon calls.
 */
export function RightPanel({
  open,
  chatId,
  onClose,
  onOpenFullChat,
}: {
  open: boolean;
  chatId: string | null;
  onClose: () => void;
  onOpenFullChat: () => void;
}) {
  const { chats, deleteChat } = useChatStore();
  const chat = chatId ? chats.find((c) => c.id === chatId) : undefined;

  if (!open || !chat) return null;

  const isDispute = chat.context?.kind === "dispute";

  return (
    <aside className="main-surface flex flex-col w-[380px] shrink-0 h-full overflow-hidden max-lg:fixed max-lg:right-0 max-lg:top-0 max-lg:bottom-0 max-lg:z-40 max-lg:rounded-none max-lg:shadow-[-8px_0_30px_rgba(0,0,0,0.12)]">
      <div className="flex items-center gap-2 h-14 px-3 border-b border-black/[0.06] shrink-0">
        <AgentMark size={16} />
        <span className="text-[13px] font-semibold text-[var(--color-text-primary)] truncate flex-1">
          {chat.title || "AI panel"}
        </span>
        <CreditIndicator compact />
        {isDispute && chat.messages.length > 0 && (
          <button
            type="button"
            aria-label="Clear conversation"
            title="Clear this conversation — permanently deletes this investigation, evidence proposals, and any draft outcomes"
            onClick={() => {
              if (!window.confirm("Clear this conversation? This permanently deletes the investigation and everything in it — there's no way to get it back.")) return;
              deleteChat(chat.id);
              onClose();
            }}
            className="flex items-center justify-center w-8 h-8 rounded-lg text-[var(--color-text-quaternary)] hover:bg-black/[0.04]"
          >
            <RotateCcw size={15} strokeWidth={1.75} />
          </button>
        )}
        <button
          type="button"
          aria-label="Open in full Chat view"
          title="Open in full Chat view"
          onClick={onOpenFullChat}
          className="flex items-center justify-center w-8 h-8 rounded-lg text-[var(--color-text-quaternary)] hover:bg-black/[0.04]"
        >
          <PanelRightOpen size={16} strokeWidth={1.75} />
        </button>
        <button
          type="button"
          aria-label="Close panel"
          onClick={onClose}
          className="flex items-center justify-center w-8 h-8 rounded-lg text-[var(--color-text-quaternary)] hover:bg-black/[0.04]"
        >
          <X size={16} strokeWidth={1.75} />
        </button>
      </div>
      <ChatWorkspace chat={chat} />
    </aside>
  );
}
