import { useEffect } from "react";
import { useChatStore } from "../hooks/useChatStore";
import { ChatHistoryList } from "../components/chat/ChatHistoryList";
import { ChatWorkspace } from "../components/chat/ChatWorkspace";
import { CreditIndicator } from "../components/chat/CreditIndicator";

/** Standalone Chat view (spec §2.2): history list + conversation, full app-shell surface. */
export function ChatPage({
  activeChatId,
  onSelectChat,
}: {
  activeChatId: string | null;
  onSelectChat: (id: string) => void;
}) {
  const { chats, createChat } = useChatStore();

  const standaloneChats = chats.filter((c) => !c.context);
  const activeChat = chats.find((c) => c.id === activeChatId) ?? standaloneChats[0];

  useEffect(() => {
    if (!activeChat && standaloneChats.length === 0) {
      onSelectChat(createChat());
    } else if (!activeChatId && activeChat) {
      onSelectChat(activeChat.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeChat, activeChatId, standaloneChats.length]);

  if (!activeChat) return null;

  return (
    <div className="flex-1 min-h-0 flex">
      <ChatHistoryList activeChatId={activeChat.id} onSelect={onSelectChat} />
      <div className="flex-1 min-h-0 flex flex-col">
        <div className="flex items-center justify-end h-12 px-4 border-b border-black/[0.06] shrink-0">
          <CreditIndicator />
        </div>
        <ChatWorkspace chat={activeChat} />
      </div>
    </div>
  );
}
