import { MessageSquarePlus, Trash2 } from "lucide-react";
import { useChatStore } from "../../hooks/useChatStore";

function groupLabel(iso: string): "Today" | "Yesterday" | "Earlier" {
  const d = new Date(iso);
  const now = new Date();
  const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const diffDays = Math.round((startOfDay(now) - startOfDay(d)) / 86_400_000);
  if (diffDays <= 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return "Earlier";
}

/** Standalone Chat view's left column — New chat + history grouped by recency (spec §2.2, §2.4). */
export function ChatHistoryList({
  activeChatId,
  onSelect,
}: {
  activeChatId: string | null;
  onSelect: (id: string) => void;
}) {
  const { chats, createChat, deleteChat } = useChatStore();

  // An empty chat only stays visible while it's the active one — createChat() already
  // dedupes so there's at most one, but this keeps a stale empty chat from lingering in the
  // list if selection moves elsewhere.
  const standaloneChats = chats
    .filter((c) => !c.context && (c.messages.length > 0 || c.id === activeChatId))
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

  const groups: Record<string, typeof standaloneChats> = { Today: [], Yesterday: [], Earlier: [] };
  for (const chat of standaloneChats) groups[groupLabel(chat.updatedAt)].push(chat);

  const handleNewChat = () => {
    const id = createChat();
    onSelect(id);
  };

  return (
    <div className="flex flex-col h-full w-64 shrink-0 border-r border-black/[0.06] bg-white/60">
      <div className="flex items-center px-3 py-3">
        <button
          type="button"
          onClick={handleNewChat}
          className="flex items-center gap-1.5 h-8 px-3 rounded-lg text-[13px] font-medium text-[var(--color-text-primary)] hover:bg-black/[0.04]"
        >
          <MessageSquarePlus size={15} strokeWidth={1.75} />
          New chat
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-3">
        {(["Today", "Yesterday", "Earlier"] as const).map((label) =>
          groups[label].length > 0 ? (
            <div key={label} className="mb-2">
              <div className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-quaternary)]">
                {label}
              </div>
              {groups[label].map((chat) => (
                <div key={chat.id} className="group relative">
                  <button
                    type="button"
                    onClick={() => onSelect(chat.id)}
                    className={
                      "w-full text-left px-2.5 py-2 rounded-lg text-[13px] truncate pr-7 transition-colors " +
                      (activeChatId === chat.id
                        ? "bg-black/[0.06] text-[var(--color-text-primary)] font-medium"
                        : "text-[var(--color-text-label)] hover:bg-black/[0.03]")
                    }
                  >
                    {chat.title || "New chat"}
                  </button>
                  <button
                    type="button"
                    aria-label="Delete chat"
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteChat(chat.id);
                      if (activeChatId === chat.id) {
                        const remaining = standaloneChats.filter((c) => c.id !== chat.id);
                        if (remaining[0]) onSelect(remaining[0].id);
                      }
                    }}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 hidden group-hover:flex items-center justify-center w-6 h-6 rounded-md text-[var(--color-text-quaternary)] hover:bg-black/[0.06] hover:text-[var(--color-danger-text)]"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          ) : null,
        )}
        {standaloneChats.length === 0 && (
          <p className="px-2.5 py-2 text-[12.5px] text-[var(--color-text-quaternary)]">No chats yet.</p>
        )}
      </div>
    </div>
  );
}
