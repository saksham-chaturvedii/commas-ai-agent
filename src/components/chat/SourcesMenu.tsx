import { useEffect, useRef, useState } from "react";
import { SlidersHorizontal, Link2 } from "lucide-react";
import type { Chat } from "../../lib/types";
import { useChatStore } from "../../hooks/useChatStore";
import { SourceIcon } from "./SourceIcon";
import { ConnectedAppsModal } from "./ConnectedAppsModal";

/**
 * Composer controls menu — per-chat source scoping, modeled on Notion AI's controls menu
 * (docs/references/notion-mcp-2.png). "My sources" toggles which connected sources this chat
 * may use; "Manage connected apps" opens the workspace-level connection gallery.
 */
export function SourcesMenu({ chat }: { chat: Chat }) {
  const { sources, toggleChatSource } = useChatStore();
  const [open, setOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const enabledCount = chat.enabledSources.length;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Sources"
        className={
          "flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-[12px] font-medium transition-colors " +
          (open ? "bg-black/[0.05] text-[var(--color-text-primary)]" : "text-[var(--color-text-quaternary)] hover:bg-black/[0.04]")
        }
      >
        <SlidersHorizontal size={15} strokeWidth={1.75} />
        Sources
        <span className="text-[11px] font-semibold text-[var(--color-agent-accent)]">{enabledCount}</span>
      </button>

      {open && (
        <div className="popover-card bottom-full mb-2 left-0 w-72 p-1.5">
          <div className="px-2.5 pt-2 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-quaternary)]">
            My sources
          </div>
          <ul className="flex flex-col">
            {sources.map((source) => {
              const enabled = chat.enabledSources.includes(source.id);
              const connected = source.connection === "connected";
              return (
                <li key={source.id}>
                  <button
                    type="button"
                    disabled={!connected}
                    onClick={() => toggleChatSource(chat.id, source.id)}
                    className="flex items-center gap-2.5 w-full px-2.5 py-2 rounded-lg text-left hover:bg-black/[0.03] disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <SourceIcon sourceId={source.id} size={16} />
                    <span className="flex-1 text-[13px] font-medium">{source.name}</span>
                    {!connected && <span className="text-[11px] text-[var(--color-text-quaternary)]">Not connected</span>}
                    {connected && <div className="checkbox-box" data-checked={enabled} />}
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="h-px bg-black/[0.06] my-1.5" />
          <button
            type="button"
            onClick={() => {
              setManageOpen(true);
              setOpen(false);
            }}
            className="flex items-center gap-2.5 w-full px-2.5 py-2 rounded-lg text-left text-[13px] font-medium hover:bg-black/[0.03]"
          >
            <Link2 size={16} strokeWidth={1.75} className="text-[var(--color-text-quaternary)]" />
            Manage connected apps
          </button>
        </div>
      )}

      {manageOpen && <ConnectedAppsModal onClose={() => setManageOpen(false)} />}
    </div>
  );
}
