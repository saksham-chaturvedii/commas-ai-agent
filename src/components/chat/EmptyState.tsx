import { useState } from "react";
import { X } from "lucide-react";
import type { Chat, SuggestedCapability } from "../../lib/types";
import { useChatStore } from "../../hooks/useChatStore";
import { AgentMark } from "../shell/AgentMark";
import { ChatComposer } from "./ChatComposer";
import { SuggestedCapabilities } from "./SuggestedCapabilities";
import { SourceIcon } from "./SourceIcon";
import { ConnectedAppsModal } from "./ConnectedAppsModal";

/**
 * New-chat empty state, Claude-Desktop-inspired (docs/references/claude-desktop.png):
 * centered greeting, composer front and center, suggestion chips, and a dismissible
 * "connect your apps" strip (Notion-AI-inspired, docs/references/notion-ai-chat-2.png).
 */
export function EmptyState({
  chat,
  capabilities,
  greeting = "How can I help you today?",
}: {
  chat: Chat;
  capabilities: SuggestedCapability[];
  greeting?: string;
}) {
  const { sources, sendMessage } = useChatStore();
  const [dismissed, setDismissed] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);

  const notConnected = sources.filter((s) => s.connection === "not_connected");

  return (
    <div className="flex-1 min-h-0 overflow-y-auto flex flex-col items-center justify-center gap-6 px-6 py-10">
      <div className="flex flex-col items-center gap-3">
        <div className="flex items-center justify-center w-12 h-12 rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,0.05),0_4px_14px_rgba(16,24,40,0.08)]">
          <AgentMark size={24} />
        </div>
        <h1 className="text-[19px] font-semibold text-[var(--color-text-primary)]">{greeting}</h1>
      </div>

      <ChatComposer chat={chat} variant="hero" />

      <SuggestedCapabilities capabilities={capabilities} onSelect={(prompt) => sendMessage(chat.id, prompt)} />

      {!dismissed && notConnected.length > 0 && (
        <div className="flex items-center gap-3 max-w-[560px] w-full px-4 py-2.5 rounded-xl border border-[var(--color-border-card)] bg-white">
          <span className="text-[12.5px] text-[var(--color-text-quaternary)] flex-1">
            Get better answers from your apps
          </span>
          <div className="flex items-center gap-1.5">
            {sources.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setManageOpen(true)}
                title={s.name}
                className="flex items-center justify-center w-6 h-6 rounded-md bg-[var(--color-app-bg)] hover:bg-black/[0.06]"
              >
                <SourceIcon sourceId={s.id} size={13} />
              </button>
            ))}
          </div>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => setDismissed(true)}
            className="text-[var(--color-text-quaternary)] hover:text-[var(--color-text-primary)]"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {manageOpen && <ConnectedAppsModal onClose={() => setManageOpen(false)} />}
    </div>
  );
}
