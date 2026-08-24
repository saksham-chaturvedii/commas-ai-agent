import type { ChatMessage } from "../../lib/types";
import { renderLiteMarkdown } from "../../lib/liteMarkdown";
import { ToolSummary } from "./ToolSummary";
import { ProposedActionCard } from "./ProposedActionCard";
import { InvestigationReportCard } from "./InvestigationReportCard";

export function ChatMessageBubble({ message, chatId }: { message: ChatMessage; chatId: string }) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="chat-bubble-user max-w-[80%]">{message.text}</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 items-start">
      <div className="chat-bubble-agent max-w-[85%]">
        {renderLiteMarkdown(message.text)}
        {message.toolSummary && <ToolSummary items={message.toolSummary} defaultOpen={Boolean(message.investigationReport)} />}
      </div>
      {message.investigationReport && <InvestigationReportCard report={message.investigationReport} />}
      {message.proposedActions?.map((action) => (
        <ProposedActionCard key={action.id} action={action} chatId={chatId} messageId={message.id} />
      ))}
    </div>
  );
}
