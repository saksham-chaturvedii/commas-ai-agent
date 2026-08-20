import type { Chat } from "../../lib/types";
import { SUGGESTED_CAPABILITIES, DISPUTE_SUGGESTED_CAPABILITIES } from "../../lib/mockData";
import { EmptyState } from "./EmptyState";
import { ChatMessageList } from "./ChatMessageList";
import { ChatComposer } from "./ChatComposer";
import { ContextChip } from "./ContextChip";

/**
 * The conversation surface — shared by the standalone Chat page and the right-side panel.
 * Renders the empty state for a fresh chat, otherwise the message list with a bottom composer.
 */
export function ChatWorkspace({ chat }: { chat: Chat }) {
  const isEmpty = chat.messages.length === 0;
  const capabilities = chat.context ? DISPUTE_SUGGESTED_CAPABILITIES : SUGGESTED_CAPABILITIES;
  const greeting = chat.context ? `Investigating ${chat.context.label}` : "How can I help you today?";

  if (isEmpty) {
    return (
      <div className="flex-1 min-h-0 flex flex-col">
        {chat.context && (
          <div className="px-5 pt-4">
            <ContextChip context={chat.context} />
          </div>
        )}
        <EmptyState chat={chat} capabilities={capabilities} greeting={greeting} />
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <ChatMessageList chat={chat} />
      <div className="px-5 py-3 border-t border-black/[0.06]">
        {chat.context && (
          <div className="max-w-[720px] mx-auto mb-2">
            <ContextChip context={chat.context} />
          </div>
        )}
        <ChatComposer chat={chat} variant="bar" />
      </div>
    </div>
  );
}
