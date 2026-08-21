import { useState } from "react";
import { Zap } from "lucide-react";
import { useChatStore } from "../../hooks/useChatStore";
import { LOW_CREDIT_THRESHOLD } from "../../lib/mockData";
import { AddCreditsModal } from "./AddCreditsModal";

/** AI credit balance pill. Flashes on change; shows a low-balance state at <= 50 remaining and
 * an exhausted state at 0. Clickable at all times — opens the Add More Credits modal
 * (docs/active-context.md — "Chat Credit System"). */
export function CreditIndicator({ compact = false }: { compact?: boolean }) {
  const { credits } = useChatStore();
  const [modalOpen, setModalOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const remaining = Math.max(0, credits.totalCredits - credits.usedCredits);
  const exhausted = remaining <= 0;
  const low = !exhausted && remaining <= LOW_CREDIT_THRESHOLD;

  const handlePurchased = (amount: number) => {
    setToast(`${amount} credits added`);
    window.setTimeout(() => setToast(null), 2500);
  };

  return (
    <div className="relative flex items-center gap-2">
      <button
        type="button"
        onClick={() => setModalOpen(true)}
        key={remaining}
        className={
          "credits-flash inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full text-[12px] font-semibold cursor-pointer transition-colors " +
          (exhausted
            ? "bg-[var(--color-danger-bg)] text-[var(--color-danger-text)]"
            : low
              ? "bg-[var(--color-warning-bg)] text-[var(--color-warning-text)]"
              : "bg-[var(--color-agent-accent-bg)] text-[var(--color-agent-accent)] hover:opacity-80")
        }
        title={`${remaining} of ${credits.totalCredits} AI credits remaining — click to add more`}
      >
        <Zap size={13} strokeWidth={2} />
        {remaining}
        {!compact && <span className="font-normal opacity-70">/ {credits.totalCredits} credits</span>}
      </button>

      {toast && (
        <span className="text-[12px] font-medium text-[var(--color-success-text)] whitespace-nowrap">{toast}</span>
      )}

      {modalOpen && <AddCreditsModal onClose={() => setModalOpen(false)} onPurchased={handlePurchased} />}
    </div>
  );
}
