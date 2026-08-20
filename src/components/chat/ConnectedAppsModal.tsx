import { X, Loader2 } from "lucide-react";
import { useChatStore } from "../../hooks/useChatStore";
import { SourceIcon } from "./SourceIcon";

/**
 * Workspace-level "Connected apps" gallery — modeled on Notion's Connections settings
 * (docs/references/notion-mcp.png) and visually harmonized with Commas' own Integrations
 * page (docs/references/commas-integrations.png). Connecting is simulated: a brief
 * "connecting" state, then connected — no real OAuth.
 */
export function ConnectedAppsModal({ onClose }: { onClose: () => void }) {
  const { sources, connectSource, disconnectSource } = useChatStore();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onMouseDown={onClose}>
      <div
        className="main-surface w-full max-w-lg max-h-[85vh] overflow-y-auto p-5"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-1">
          <div>
            <h2 className="text-[16px] font-semibold text-[var(--color-text-primary)]">Connected apps</h2>
            <p className="text-[13px] text-[var(--color-text-quaternary)] mt-0.5">
              Sources the AI agent can use when investigating for you.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex items-center justify-center w-8 h-8 rounded-full hover:bg-black/[0.04] text-[var(--color-text-quaternary)]"
          >
            <X size={18} />
          </button>
        </div>

        <ul className="flex flex-col gap-2 mt-4">
          {sources.map((source) => (
            <li
              key={source.id}
              className="flex items-center gap-3 p-3 rounded-xl border border-[var(--color-border-card)]"
            >
              <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-[var(--color-app-bg)] shrink-0">
                <SourceIcon sourceId={source.id} size={17} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-[14px] font-semibold text-[var(--color-text-primary)]">{source.name}</span>
                  {source.isPrimary && (
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-quaternary)]">
                      Primary
                    </span>
                  )}
                </div>
                <p className="text-[12.5px] text-[var(--color-text-quaternary)] mt-0.5">{source.description}</p>
              </div>
              {source.connection === "connected" && (
                <button
                  type="button"
                  disabled={source.isPrimary}
                  onClick={() => disconnectSource(source.id)}
                  className="btn-secondary h-8 px-3 text-[12.5px] disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Disconnect
                </button>
              )}
              {source.connection === "not_connected" && (
                <button type="button" onClick={() => connectSource(source.id)} className="btn-dark h-8 px-3 text-[12.5px]">
                  Connect
                </button>
              )}
              {source.connection === "connecting" && (
                <span className="inline-flex items-center gap-1.5 h-8 px-3 text-[12.5px] font-medium text-[var(--color-text-quaternary)]">
                  <Loader2 size={13} className="animate-spin" />
                  Connecting…
                </span>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
