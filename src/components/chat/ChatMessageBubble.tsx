import type { ChatMessage } from "../../lib/types";
import { renderLiteMarkdown } from "../../lib/liteMarkdown";
import { ToolSummary } from "./ToolSummary";

export function ChatMessageBubble({ message }: { message: ChatMessage }) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="chat-bubble-user max-w-[80%]">{message.text}</div>
      </div>
    );
  }

  return (
    <div className="flex justify-start">
      <div className="chat-bubble-agent max-w-[85%]">
        {renderLiteMarkdown(message.text)}
        {message.toolSummary && <ToolSummary items={message.toolSummary} />}
      </div>
    </div>
  );
}
