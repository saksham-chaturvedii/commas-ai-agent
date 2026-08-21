import { useState } from "react";
import { X, Sparkles, Check, RotateCcw } from "lucide-react";
import { useChatStore } from "../../hooks/useChatStore";
import { CREDIT_PACKAGES } from "../../lib/mockData";

const DEMO_TARGETS = [50, 10, 1, 0];

/**
 * Mock "Add more credits" purchase flow, visually inspired by the Lovable usage-credit modal
 * the user referenced, rebuilt with Commas' own visual language (glass/solid card, btn-dark/
 * btn-secondary, agent-accent color) rather than copying Lovable's branding. No real payment —
 * clicking "Buy Credits" only increases the mock totalCredits balance (docs/active-context.md
 * — "Chat Credit System").
 */
export function AddCreditsModal({
  onClose,
  onPurchased,
}: {
  onClose: () => void;
  onPurchased?: (amount: number) => void;
}) {
  const { addCredits, setRemainingCreditsForDemo, resetDemo, credits } = useChatStore();
  const [selected, setSelected] = useState(CREDIT_PACKAGES[0].id);

  const pkg = CREDIT_PACKAGES.find((p) => p.id === selected)!;

  const handleBuy = () => {
    addCredits(pkg.credits);
    onPurchased?.(pkg.credits);
    onClose();
  };

  // Wipes chats/credits/sources back to seed, then reloads so evidence added via "Add
  // evidence" (App.tsx-local state, not covered by resetDemo) resets too — lets the seller
  // restart a demo mid-walkthrough without losing the whole browser tab.
  const handleReset = () => {
    resetDemo();
    window.location.reload();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onMouseDown={onClose}>
      <div
        className="w-full max-w-[420px] rounded-2xl bg-white shadow-[0_0_0_1px_rgba(16,24,40,0.05),0_20px_60px_-15px_rgba(16,24,40,0.35)] p-5"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div className="flex items-center justify-center w-10 h-10 rounded-full bg-[var(--color-agent-accent-bg)] text-[var(--color-agent-accent)]">
            <Sparkles size={18} strokeWidth={1.75} />
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

        <h2 className="text-[19px] font-semibold text-[var(--color-text-primary)] mt-3" style={{ fontFamily: "var(--font-heading)" }}>
          Add more credits
        </h2>
        <p className="text-[13px] text-[var(--color-text-quaternary)] mt-1">
          Purchase additional credits for your workspace.
        </p>

        <div className="mt-4 border border-[var(--color-border-card)] rounded-xl p-4">
          <div className="text-[13.5px] font-semibold text-[var(--color-text-primary)]">Top up credits</div>
          <p className="text-[12px] text-[var(--color-text-quaternary)] mt-0.5 mb-3">Purchase credits on demand.</p>

          <div className="flex flex-col gap-2">
            {CREDIT_PACKAGES.map((p) => {
              const isSelected = p.id === selected;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setSelected(p.id)}
                  className="flex items-center justify-between h-12 px-3.5 rounded-xl border text-left transition-colors"
                  style={{
                    borderColor: isSelected ? "var(--color-text-primary)" : "var(--color-border-control)",
                    borderWidth: isSelected ? 1.5 : 1,
                    background: isSelected ? "#fafafa" : "#ffffff",
                  }}
                >
                  <span className="flex items-center gap-2.5">
                    <span
                      className="flex items-center justify-center w-4 h-4 rounded-full shrink-0"
                      style={{
                        background: isSelected ? "#111111" : "#ffffff",
                        boxShadow: isSelected ? "none" : "inset 0 0 0 1.5px var(--color-border-control)",
                      }}
                    >
                      {isSelected && <Check size={11} strokeWidth={3} className="text-white" />}
                    </span>
                    <span className="text-[14px] font-medium text-[var(--color-text-primary)]">
                      +{p.credits} credits
                    </span>
                  </span>
                  <span className="text-[14px] font-semibold text-[var(--color-text-primary)]">{p.price}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex items-center gap-3 mt-5">
          <button type="button" className="btn-secondary flex-1" style={{ height: 40 }} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn-dark flex-1" style={{ height: 40 }} onClick={handleBuy}>
            Buy Credits
          </button>
        </div>

        {/* Dev/demo-only — jump straight to a low balance to test the UI states without
            sending N real messages. Not a normal production affordance. */}
        <div className="mt-5 pt-4 border-t border-[var(--color-border-card)]">
          <p className="text-[11px] uppercase tracking-wide font-semibold text-[var(--color-text-quaternary)] mb-2">
            Demo tools
          </p>
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[11.5px] text-[var(--color-text-quaternary)] mr-0.5">Set remaining:</span>
            {DEMO_TARGETS.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setRemainingCreditsForDemo(n)}
                className="h-6 px-2 rounded-md text-[11.5px] font-medium text-[var(--color-text-label)] bg-[var(--color-app-bg)] hover:bg-black/[0.06]"
              >
                {n}
              </button>
            ))}
            <span className="text-[11px] text-[var(--color-text-quaternary)] ml-2">
              ({Math.max(0, credits.totalCredits - credits.usedCredits)}/{credits.totalCredits} now)
            </span>
          </div>
          <button
            type="button"
            onClick={handleReset}
            className="mt-2.5 flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[11.5px] font-medium text-[var(--color-text-label)] bg-[var(--color-app-bg)] hover:bg-black/[0.06]"
          >
            <RotateCcw size={12} strokeWidth={2} />
            Reset all demo data
          </button>
        </div>
      </div>
    </div>
  );
}
