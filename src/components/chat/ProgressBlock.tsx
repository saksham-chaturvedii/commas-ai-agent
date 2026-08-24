import { Check, Loader2 } from "lucide-react";
import type { ProgressStep } from "../../lib/types";
import { SourceIcon } from "./SourceIcon";

/**
 * Renders the agent's simulated "working" state — safe, tool-level progress lines only,
 * never model reasoning (see docs/PROTOTYPE_SPEC.md §4.11 and ARCHITECTURE.md §9). Steps up
 * to `visibleStepIds.length` are shown as completed; the next one shows as in-progress.
 */
export function ProgressBlock({
  steps,
  visibleStepIds,
  title,
}: {
  steps: ProgressStep[];
  visibleStepIds: string[];
  /** e.g. "Investigating dispute #2481" — shown above the step list once there's at least one
   * step to show, so the seller sees what the agent is doing, not just that something is
   * happening (docs/AI_ASSISTANT_IMPLEMENTATION_STATUS.md's current phase). */
  title?: string;
}) {
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
      {title && (
        <div className="text-[13px] font-semibold text-[var(--color-text-primary)] mb-0.5">{title}</div>
      )}
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
            <span className={isDone ? "" : "progress-dot"}>{isDone ? (step.doneLabel ?? step.label) : step.label}</span>
          </div>
        );
      })}
    </div>
  );
}
