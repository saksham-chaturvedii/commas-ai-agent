import { Info } from "lucide-react";
import { MiniChart } from "./MiniChart";
import { EmptyIllustration } from "./EmptyIllustration";

/** Populated metric card — heading, value, delta, sparkline. Matches production's Gross
 * revenue / Spend per customer / New customers / Dispute activity / Net revenue cards. */
export function OverviewCard({
  title,
  value,
  subtitle,
  info,
  points,
  xLabels,
}: {
  title: string;
  value: string;
  subtitle: string;
  info?: boolean;
  points: number[];
  xLabels: [string, string];
}) {
  return (
    <div className="content-card" style={{ padding: 20, gap: 4 }}>
      <div className="flex items-center gap-1.5">
        <span className="text-[14px] font-semibold text-[#1a1a1a]">{title}</span>
        {info && <Info size={13} strokeWidth={2} className="text-[#9ca3af]" />}
      </div>
      <span className="text-[22px] font-semibold text-[#1a1a1a] mt-1">{value}</span>
      <span className="text-[12.5px] text-[#8a8f98] mb-1">{subtitle}</span>
      <MiniChart points={points} xLabels={xLabels} />
    </div>
  );
}

/** Empty-state metric card — heading, illustration, caption, optional CTA. Matches production's
 * "Top payment methods" / "Credit score distribution" zero-data treatment (never a blank card). */
export function OverviewEmptyCard({
  title,
  caption,
  cta,
}: {
  title: string;
  caption: string;
  cta?: string;
}) {
  return (
    <div className="content-card items-center justify-center text-center" style={{ padding: 20, gap: 14, minHeight: 220 }}>
      <span className="self-start text-[14px] font-semibold text-[#1a1a1a]">{title}</span>
      <div className="flex-1 flex flex-col items-center justify-center gap-4">
        <EmptyIllustration />
        <p className="text-[13px] leading-[18px] text-[#6b7280] max-w-[220px]">{caption}</p>
        {cta && (
          <button type="button" className="btn-secondary" style={{ height: 34, fontSize: 13 }}>
            {cta} <span aria-hidden>›</span>
          </button>
        )}
      </div>
    </div>
  );
}
