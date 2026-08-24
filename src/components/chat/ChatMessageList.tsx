import { useEffect, useRef } from "react";
import type { Chat } from "../../lib/types";
import { useChatStore } from "../../hooks/useChatStore";
import { ChatMessageBubble } from "./ChatMessageBubble";
import { ProgressBlock } from "./ProgressBlock";
import { ApprovalCard } from "./ApprovalCard";

export function ChatMessageList({ chat }: { chat: Chat }) {
  const { runChatId, runPhase, runSteps, visibleStepIds, pendingApproval } = useChatStore();
  const isRunningHere = runChatId === chat.id && runPhase === "running";
  const isAwaitingApprovalHere = pendingApproval?.chatId === chat.id && runPhase === "awaiting_approval";
  const bottomRef = useRef<HTMLDivElement>(null);

  // The shared agent's streaming path (global/dashboard chats — src/hooks/useChatStore.tsx)
  // appends a growing assistant message directly to `chat.messages` as text arrives, rather than
  // replaying a plan through ProgressBlock's step timers. Once that message has real content,
  // showing the generic "Thinking…" indicator above it would be a redundant, stale-looking
  // second status line sitting over a real answer that's already visible — so it's suppressed the
  // moment there's something to show instead. Dispute-context chats never set `streaming` on a
  // message, so ProgressBlock's behavior there (and its "Thinking…" fallback) is unchanged.
  const lastMessage = chat.messages[chat.messages.length - 1];
  const isStreamingWithContent = isRunningHere && lastMessage?.streaming === true && lastMessage.text.length > 0;

  useEffect(() => {
    bottomRef.current?.scrollIntoView?.({ behavior: "smooth", block: "end" });
  }, [chat.messages.length, isRunningHere, isAwaitingApprovalHere, visibleStepIds.length]);

  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4">
      <div className="flex flex-col gap-4 max-w-[720px] mx-auto">
        {chat.messages.map((message) => (
          <ChatMessageBubble key={message.id} message={message} chatId={chat.id} />
        ))}
        {isRunningHere && !isStreamingWithContent && (
          <div className="flex justify-start">
            <div className="chat-bubble-agent">
              <ProgressBlock steps={runSteps} visibleStepIds={visibleStepIds} />
            </div>
          </div>
        )}
        {isAwaitingApprovalHere && pendingApproval && (
          <div className="flex justify-start">
            <ApprovalCard approval={pendingApproval} />
          </div>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
