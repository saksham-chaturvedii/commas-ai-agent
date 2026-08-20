import { useState } from "react";
import { Check } from "lucide-react";

export function AmountFilterPopover({ onClose }: { onClose: () => void }) {
  const [min, setMin] = useState("");
  const [max, setMax] = useState("");
  return (
    <div className="popover-card" style={{ width: 220 }}>
      <div className="px-3.5 pb-1.5 pt-3 text-[11px] font-semibold uppercase tracking-[0.22px] text-black/40">
        Filter by amount
      </div>
      <div className="px-3.5 pb-3 flex items-center gap-2">
        <input
          type="number"
          placeholder="Min"
          value={min}
          onChange={(e) => setMin(e.target.value)}
          className="w-full text-[13px] px-2.5 py-1.5 rounded-lg"
          style={{ border: "1px solid #d1d5db" }}
        />
        <span className="text-[#9ca3af] text-[13px]">–</span>
        <input
          type="number"
          placeholder="Max"
          value={max}
          onChange={(e) => setMax(e.target.value)}
          className="w-full text-[13px] px-2.5 py-1.5 rounded-lg"
          style={{ border: "1px solid #d1d5db" }}
        />
      </div>
      <div className="flex items-center gap-2 px-3.5 py-3 border-t border-black/[0.06]">
        <button
          type="button"
          className="btn-secondary flex-1"
          style={{ height: 37, letterSpacing: "0.24px" }}
          onClick={() => {
            setMin("");
            setMax("");
          }}
        >
          Clear
        </button>
        <button type="button" className="btn-dark flex-1" onClick={onClose}>
          Apply
          <Check size={16} strokeWidth={2.5} />
        </button>
      </div>
    </div>
  );
}

export function DateFilterPopover({
  label,
  onClose,
}: {
  label: string;
  onClose: () => void;
}) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  return (
    <div className="popover-card" style={{ width: 260 }}>
      <div className="px-3.5 pb-1.5 pt-3 text-[11px] font-semibold uppercase tracking-[0.22px] text-black/40">
        Filter by {label.toLowerCase()}
      </div>
      <div className="px-3.5 pb-3 flex flex-col gap-2">
        <div>
          <label className="block text-[12px] text-[#9ca3af] mb-1">From</label>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="w-full text-[13px] px-2.5 py-1.5 rounded-lg"
            style={{ border: "1px solid #d1d5db" }}
          />
        </div>
        <div>
          <label className="block text-[12px] text-[#9ca3af] mb-1">To</label>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="w-full text-[13px] px-2.5 py-1.5 rounded-lg"
            style={{ border: "1px solid #d1d5db" }}
          />
        </div>
      </div>
      <div className="flex items-center gap-2 px-3.5 py-3 border-t border-black/[0.06]">
        <button
          type="button"
          className="btn-secondary flex-1"
          style={{ height: 37, letterSpacing: "0.24px" }}
          onClick={() => {
            setFrom("");
            setTo("");
          }}
        >
          Clear
        </button>
        <button type="button" className="btn-dark flex-1" onClick={onClose}>
          Apply
          <Check size={16} strokeWidth={2.5} />
        </button>
      </div>
    </div>
  );
}
