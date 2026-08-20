import { X, PanelRightOpen } from "lucide-react";
import { useChatStore } from "../../hooks/useChatStore";
import { AgentMark } from "../shell/AgentMark";
import { CreditIndicator } from "./CreditIndicator";
import { ChatWorkspace } from "./ChatWorkspace";

/**
 * Right-side AI panel — docks alongside page content rather than overlaying it (spec §2.5),
 * modeled on docs/references/notion-ai-chat-3.png. Shows whichever chat App.tsx currently has
 * bound to the panel (created fresh, with page context attached, the first time it's opened).
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
  const { chats } = useChatStore();
  const chat = chatId ? chats.find((c) => c.id === chatId) : undefined;

  if (!open || !chat) return null;

  return (
    <aside className="hidden lg:flex flex-col w-[380px] shrink-0 h-full border-l border-black/[0.06] bg-white">
      <div className="flex items-center gap-2 h-14 px-3 border-b border-black/[0.06] shrink-0">
        <AgentMark size={16} />
        <span className="text-[13px] font-semibold text-[var(--color-text-primary)] truncate flex-1">
          {chat.title || "AI panel"}
        </span>
        <CreditIndicator compact />
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
