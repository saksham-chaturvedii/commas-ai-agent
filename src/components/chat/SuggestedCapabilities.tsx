import type { SuggestedCapability } from "../../lib/types";

/** Suggestion chips, Claude-Desktop-inspired (docs/references/claude-desktop.png).
 * `disabled` mirrors the composer's own gating (out of credits, or another chat's run in
 * flight) — chips call sendMessage directly, so without it they'd look clickable while
 * silently doing nothing (PRODUCT_READINESS_AUDIT.md P1-5). */
export function SuggestedCapabilities({
  capabilities,
  onSelect,
  disabled = false,
}: {
  capabilities: SuggestedCapability[];
  onSelect: (prompt: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap justify-center gap-2 max-w-[560px] mx-auto">
      {capabilities.map((cap) => (
        <button
          key={cap.id}
          type="button"
          className="suggestion-chip disabled:opacity-40 disabled:cursor-not-allowed"
          disabled={disabled}
          onClick={() => onSelect(cap.prompt)}
        >
          {cap.label}
        </button>
      ))}
    </div>
  );
}
