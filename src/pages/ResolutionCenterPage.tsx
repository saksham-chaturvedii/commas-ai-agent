import { Sparkles } from "lucide-react";
import { Badge } from "../components/shell/Badge";
import { DISPUTE_CONTEXT } from "../lib/mockData";

/**
 * Minimal Resolution Center / dispute-detail placeholder — enough to host the flagship
 * contextual-AI entry point (spec §2.11). A full port of commas-ai-copilot's Resolution
 * Center is a later phase (see docs/IMPLEMENTATION_PLAN.md Phase 1) — deliberately not
 * duplicated here to keep this pass scoped to the AI/chat UI foundation.
 */
export function ResolutionCenterPage({ onInvestigate }: { onInvestigate: () => void }) {
  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-6">
      <h1 className="text-[22px] font-semibold text-[var(--color-text-primary)] mb-4">Resolution Center</h1>

      <div className="content-card max-w-2xl">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[15px] font-semibold text-[var(--color-text-primary)]">
                {DISPUTE_CONTEXT.label}
              </span>
              <Badge variant="warning">Needs response</Badge>
            </div>
            <p className="text-[13px] text-[var(--color-text-quaternary)] mt-1">
              $499 · "Product not received" · Due Feb 15, 2026
            </p>
          </div>
          <button type="button" onClick={onInvestigate} className="btn-dark shrink-0">
            <Sparkles size={15} strokeWidth={1.75} />
            Investigate with AI
          </button>
        </div>

        <div className="mt-3 text-[13px] text-[var(--color-text-label)]">
          <p>Customer: Sarah Johnson (sarah.johnson@example.com)</p>
          <p className="mt-1">Product: Pro Coaching Program</p>
          <p className="mt-1">Filed: Feb 8, 2026</p>
        </div>
      </div>
    </div>
  );
}
