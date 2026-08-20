import { useState } from "react";
import { ChevronDown, ChevronLeft } from "lucide-react";
import { MiniChart } from "./MiniChart";

const RANGES = ["D", "W", "M", "Y"] as const;

// Mocked, gently-rising 30-day revenue series — coherent with the $18,420 headline figure and
// with Resolution Center's existing dispute-in-progress story (not a flat empty-account chart).
const REVENUE_POINTS = [0.28, 0.32, 0.3, 0.38, 0.42, 0.4, 0.48, 0.5, 0.46, 0.55, 0.6, 0.58, 0.66, 0.72, 0.7, 0.8];

/** Hero Revenue card — heading/date/range toggle/chart, matching production's structure
 * (docs/references/Screenshot 2026-08-21 at 4.27.15 AM.png). */
export function RevenueModule() {
  const [range, setRange] = useState<(typeof RANGES)[number]>("D");

  return (
    <div className="content-card flex-[2] min-w-0" style={{ padding: 24, gap: 4 }}>
      <div className="flex items-center justify-between">
        <span className="text-[15px] font-semibold text-[#1a1a1a]">Revenue</span>
        <div className="segment-control">
          {RANGES.map((r) => (
            <button key={r} type="button" data-active={r === range} onClick={() => setRange(r)}>
              {r}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-baseline gap-1 mt-2">
        <span className="text-[36px] font-semibold text-[#1a1a1a] leading-none">$18,420</span>
      </div>
      <button type="button" className="flex items-center gap-1 text-[13px] text-[#6b7280] mt-1 self-start">
        Aug 20, 2026 <ChevronDown size={14} strokeWidth={2} />
      </button>
      <span className="flex items-center gap-1 text-[12px] text-[#9ca3af] mt-1">
        <ChevronLeft size={12} strokeWidth={2} /> Updated 4:27 AM
      </span>

      <div className="mt-3">
        <MiniChart points={REVENUE_POINTS} height={160} xLabels={["12:00 AM", "12:00 AM"]} />
      </div>
    </div>
  );
}
