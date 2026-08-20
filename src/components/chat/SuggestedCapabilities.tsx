import type { SuggestedCapability } from "../../lib/types";

/** Suggestion chips, Claude-Desktop-inspired (docs/references/claude-desktop.png). */
export function SuggestedCapabilities({
  capabilities,
  onSelect,
}: {
  capabilities: SuggestedCapability[];
  onSelect: (prompt: string) => void;
}) {
  return (
    <div className="flex flex-wrap justify-center gap-2 max-w-[560px] mx-auto">
      {capabilities.map((cap) => (
        <button key={cap.id} type="button" className="suggestion-chip" onClick={() => onSelect(cap.prompt)}>
          {cap.label}
        </button>
      ))}
    </div>
  );
}
