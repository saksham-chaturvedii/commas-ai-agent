import { Check } from "lucide-react";
import { useState } from "react";

const REASONS = [
  "Fraudulent",
  "Product not received",
  "Product unacceptable",
  "Duplicate",
  "Subscription canceled",
  "Unrecognized",
  "Credit not processed",
  "General",
];

export function ReasonPopover({ onClose }: { onClose: () => void }) {
  const [checked, setChecked] = useState<Set<string>>(new Set());

  const toggle = (reason: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(reason)) {
        next.delete(reason);
      } else {
        next.add(reason);
      }
      return next;
    });
  };

  return (
    <div className="popover-card">
      <div className="px-3.5 pb-1.5 pt-3 text-[11px] font-semibold uppercase tracking-[0.22px] text-black/40">
        Filter by reason
      </div>
      <div className="max-h-[260px] overflow-y-auto px-1.5 pb-1.5">
        {REASONS.map((reason) => (
          <label
            key={reason}
            className="group flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg cursor-pointer hover:bg-black/[0.03]"
          >
            <span className="checkbox-box" data-checked={checked.has(reason)}>
              {checked.has(reason) && <Check size={11} strokeWidth={3} color="#fff" />}
            </span>
            <input
              type="checkbox"
              className="sr-only"
              checked={checked.has(reason)}
              onChange={() => toggle(reason)}
            />
            <span className="text-sm font-semibold text-[#404040]">{reason}</span>
          </label>
        ))}
      </div>
      <div className="flex items-center gap-2 px-3.5 py-3 border-t border-black/[0.06]">
        <button
          type="button"
          className="btn-secondary flex-1"
          style={{ height: 37, letterSpacing: "0.24px" }}
          onClick={() => setChecked(new Set())}
        >
          Clear
        </button>
        <button
          type="button"
          className="btn-dark flex-1"
          onClick={onClose}
        >
          Apply
          <Check size={16} strokeWidth={2.5} />
        </button>
      </div>
    </div>
  );
}
