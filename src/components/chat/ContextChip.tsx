import { Gavel } from "lucide-react";
import type { PageContext } from "../../lib/types";

/** Shows what page/record the agent has automatically attached as context (spec §2.5). */
export function ContextChip({ context }: { context: PageContext }) {
  return (
    <div className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg bg-[var(--color-agent-accent-bg)] border border-[var(--color-agent-accent-border)] text-[12px] font-medium text-[var(--color-agent-accent)]">
      <Gavel size={13} strokeWidth={1.75} />
      {context.label}
    </div>
  );
}
