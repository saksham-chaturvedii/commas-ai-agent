import { useEffect, useRef } from "react";
import type { Chat } from "../../lib/types";
import { useChatStore } from "../../hooks/useChatStore";
import { ChatMessageBubble } from "./ChatMessageBubble";
import { ProgressBlock } from "./ProgressBlock";

export function ChatMessageList({ chat }: { chat: Chat }) {
  const { runChatId, runPhase, runSteps, visibleStepIds } = useChatStore();
  const isRunningHere = runChatId === chat.id && runPhase === "running";
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView?.({ behavior: "smooth", block: "end" });
  }, [chat.messages.length, isRunningHere, visibleStepIds.length]);

  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4">
      <div className="flex flex-col gap-4 max-w-[720px] mx-auto">
        {chat.messages.map((message) => (
          <ChatMessageBubble key={message.id} message={message} />
        ))}
        {isRunningHere && (
          <div className="flex justify-start">
            <div className="chat-bubble-agent">
              <ProgressBlock steps={runSteps} visibleStepIds={visibleStepIds} />
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
