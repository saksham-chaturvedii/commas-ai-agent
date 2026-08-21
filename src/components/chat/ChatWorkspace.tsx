import type { Chat } from "../../lib/types";
import {
  SUGGESTED_CAPABILITIES,
  DASHBOARD_SUGGESTED_CAPABILITIES,
  DISPUTE_SUGGESTED_CAPABILITIES,
} from "../../lib/mockData";
import { EmptyState } from "./EmptyState";
import { ChatMessageList } from "./ChatMessageList";
import { ChatComposer } from "./ChatComposer";
import { ContextChip } from "./ContextChip";

/**
 * The conversation surface — shared by the standalone Chat page and the right-side panel.
 * Context drives the experience: dispute context shows a chip + dispute suggestions,
 * dashboard context swaps in dashboard suggestions (no chip — the page itself is the
 * context), no context gets the global set.
 */
export function ChatWorkspace({ chat }: { chat: Chat }) {
  const isEmpty = chat.messages.length === 0;
  const isDispute = chat.context?.kind === "dispute";
  const capabilities = isDispute
    ? DISPUTE_SUGGESTED_CAPABILITIES
    : chat.context?.kind === "dashboard"
      ? DASHBOARD_SUGGESTED_CAPABILITIES
      : SUGGESTED_CAPABILITIES;
  const greeting = isDispute ? "How can I help resolve this dispute?" : "How can I help you today?";

  if (isEmpty) {
    return (
      <div className="flex-1 min-h-0 flex flex-col">
        <EmptyState chat={chat} capabilities={capabilities} greeting={greeting} context={chat.context} />
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <ChatMessageList chat={chat} />
      <div className="px-5 py-3 border-t border-black/[0.06]">
        {isDispute && (
          <div className="max-w-[720px] mx-auto mb-2">
            <ContextChip context={chat.context!} />
          </div>
        )}
        <ChatComposer chat={chat} variant="bar" />
      </div>
    </div>
  );
}
