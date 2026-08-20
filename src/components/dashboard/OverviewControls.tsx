import { Calendar, Clock, ArrowLeftRight, Plus, Settings } from "lucide-react";

/** Non-functional mock controls, matching production's Overview toolbar exactly (date range /
 * cadence / compare-to pills on the left, Add + Edit on the right). Visual fidelity only — no
 * real filtering logic, per this phase's scope. */
export function OverviewControls() {
  return (
    <div className="flex items-center justify-between flex-wrap gap-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="overview-pill">
          <Calendar size={14} strokeWidth={1.75} className="text-[#6b7280]" />
          Date range&nbsp;:&nbsp;<span className="text-[var(--color-primary)] font-medium">Fri 14 Aug – Thu 20 Aug</span>
        </span>
        <span className="overview-pill">
          <Clock size={14} strokeWidth={1.75} className="text-[#6b7280]" />
          <span className="text-[var(--color-primary)] font-medium">Daily</span>
        </span>
        <span className="overview-pill">
          <ArrowLeftRight size={14} strokeWidth={1.75} className="text-[#6b7280]" />
          Compare to&nbsp;:&nbsp;<span className="text-[var(--color-primary)] font-medium">Previous Period</span>
        </span>
      </div>
      <div className="flex items-center gap-2">
        <button type="button" className="btn-secondary" style={{ height: 34, fontSize: 13 }}>
          <Plus size={14} strokeWidth={2} /> Add
        </button>
        <button type="button" className="btn-secondary" style={{ height: 34, fontSize: 13 }}>
          <Settings size={14} strokeWidth={1.75} /> Edit
        </button>
      </div>
    </div>
  );
}
