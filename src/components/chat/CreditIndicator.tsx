import { Zap } from "lucide-react";
import { useChatStore } from "../../hooks/useChatStore";

/** AI credit balance pill. Flashes on change; shows an exhausted state at 0. */
export function CreditIndicator({ compact = false }: { compact?: boolean }) {
  const { credits, resetDemo } = useChatStore();
  const exhausted = credits.balance <= 0;

  return (
    <div className="flex items-center gap-2">
      <div
        key={credits.balance}
        className={
          "credits-flash inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full text-[12px] font-semibold " +
          (exhausted
            ? "bg-[var(--color-danger-bg)] text-[var(--color-danger-text)]"
            : "bg-[var(--color-agent-accent-bg)] text-[var(--color-agent-accent)]")
        }
        title={`${credits.balance} of ${credits.startingBalance} AI credits remaining`}
      >
        <Zap size={13} strokeWidth={2} />
        {credits.balance}
        {!compact && <span className="font-normal opacity-70">/ {credits.startingBalance} credits</span>}
      </div>
      {exhausted && (
        <button type="button" onClick={resetDemo} className="text-[12px] font-medium text-[var(--color-primary)] hover:underline">
          Reset demo
        </button>
      )}
    </div>
  );
}
