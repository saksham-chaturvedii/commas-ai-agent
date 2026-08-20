import { Check, Loader2 } from "lucide-react";
import type { ProgressStep } from "../../lib/types";
import { SourceIcon } from "./SourceIcon";

/**
 * Renders the agent's simulated "working" state — safe, tool-level progress lines only,
 * never model reasoning (see docs/PROTOTYPE_SPEC.md §4.11 and ARCHITECTURE.md §9). Steps up
 * to `visibleStepIds.length` are shown as completed; the next one shows as in-progress.
 */
export function ProgressBlock({ steps, visibleStepIds }: { steps: ProgressStep[]; visibleStepIds: string[] }) {
  if (steps.length === 0) {
    return (
      <div className="flex items-center gap-2 text-[13px] text-[var(--color-text-quaternary)]">
        <Loader2 size={14} className="animate-spin" />
        Thinking…
      </div>
    );
  }

  const visibleCount = Math.min(visibleStepIds.length + 1, steps.length);
  const shown = steps.slice(0, visibleCount);

  return (
    <div className="flex flex-col gap-1.5">
      {shown.map((step) => {
        const isDone = visibleStepIds.includes(step.id);
        return (
          <div key={step.id} className="flex items-center gap-2 text-[13px] text-[var(--color-text-quaternary)]">
            {isDone ? (
              <Check size={14} className="text-[var(--color-success-text)] shrink-0" />
            ) : (
              <Loader2 size={14} className="animate-spin shrink-0" />
            )}
            <SourceIcon sourceId={step.sourceId} size={13} />
            <span className={isDone ? "" : "progress-dot"}>{step.label}</span>
          </div>
        );
      })}
    </div>
  );
}
