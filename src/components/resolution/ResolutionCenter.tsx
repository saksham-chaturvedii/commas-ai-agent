import { useEffect, useRef, useState } from "react";
import {
  CircleAlert,
  CircleX,
  CircleCheck,
  CircleHelp,
  CircleDashed,
  DollarSign,
  Calendar,
  Search,
  ExternalLink,
  Inbox,
} from "lucide-react";
import { FilterPill } from "./FilterPill";
import { ReasonPopover } from "./ReasonPopover";
import { AmountFilterPopover, DateFilterPopover } from "./SimpleFilterPopover";
import { PinwheelIcon } from "./PinwheelIcon";
import { Badge } from "../shell/Badge";
import { DISPUTES, type DisputeStatus } from "../../lib/disputeData";

/**
 * Resolution Center list page, ported from commas-ai-copilot (tabs, filter pills, popovers,
 * dispute table). Renders all 5 demo dispute cases (docs/active-context.md — "Resolution
 * Center Demo-Readiness"), filtered per tab by each case's `status`, so switching tabs and
 * clicking between rows feels like a real product rather than a single static row.
 */

const STATUS_VARIANT: Record<DisputeStatus, "warning" | "success"> = {
  "Needs response": "warning",
  Won: "success",
};

const TABS = [
  { key: "needs-response", label: "Needs response", icon: CircleAlert, empty: "No disputes need a response" },
  { key: "in-review", label: "In review", icon: PinwheelIcon, empty: "No disputes in review" },
  { key: "all", label: "All disputes", icon: null, empty: "" },
  { key: "lost", label: "Lost", icon: CircleX, empty: "No lost disputes" },
  { key: "won", label: "Won", icon: CircleCheck, empty: "No won disputes" },
] as const;

const COL = {
  customer: "flex-[2]",
  reason: "flex-[2]",
  amount: "flex-1",
  date: "flex-1",
  due: "flex-1",
  status: "w-[140px] shrink-0",
};

type PopoverKey = "reason" | "amount" | "dispute-date" | "evidence-due" | null;

export function ResolutionCenter({ onOpenDispute }: { onOpenDispute: (id: string) => void }) {
  const [activeTab, setActiveTab] = useState<(typeof TABS)[number]["key"]>("needs-response");
  const [openPopover, setOpenPopover] = useState<PopoverKey>(null);
  const filtersRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!openPopover) return;
    const handleClick = (e: MouseEvent) => {
      if (filtersRef.current && !filtersRef.current.contains(e.target as Node)) {
        setOpenPopover(null);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenPopover(null);
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [openPopover]);

  const toggle = (key: PopoverKey) => () => setOpenPopover((cur) => (cur === key ? null : key));

  const visibleDisputes =
    activeTab === "all"
      ? DISPUTES
      : activeTab === "needs-response"
        ? DISPUTES.filter((d) => d.status === "Needs response")
        : activeTab === "won"
          ? DISPUTES.filter((d) => d.status === "Won")
          : []; // no "in review" / "lost" cases in this prototype's demo set yet

  const showTable = visibleDisputes.length > 0;
  const showStatus = activeTab === "all";
  const activeMeta = TABS.find((t) => t.key === activeTab)!;

  return (
    <div className="main-surface flex flex-col p-0 min-h-[370px] pt-[30px] px-5 pb-5 flex-1 overflow-y-auto">
      <h1
        className="pl-[5px] text-[20px] leading-[26px] font-semibold tracking-[-0.4px] text-[#1a1a1a]"
        style={{ fontFamily: "var(--font-heading)" }}
      >
        Resolution Center
      </h1>

      {/* tabs */}
      <div className="flex items-center mt-[18px] border-b border-black/[0.06]">
        {TABS.map(({ key, label, icon: Icon }) => {
          const active = activeTab === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setActiveTab(key)}
              className="relative flex items-center gap-1 h-[41px] px-2.5 cursor-pointer"
              style={{
                borderBottom: active ? "1.5px solid #000" : "1.5px solid transparent",
                marginBottom: "-1px",
              }}
            >
              {Icon && <Icon size={16} strokeWidth={1.75} className="text-[#1a1a1a]" />}
              <span
                className="text-[13px] leading-[17px] tracking-[-0.13px] font-medium text-[#1a1a1a]"
                style={{ fontFamily: "var(--font-heading)" }}
              >
                {label}
              </span>
            </button>
          );
        })}
      </div>

      {/* filters row */}
      <div className="flex items-center gap-3 mt-5" ref={filtersRef}>
        <div className="relative">
          <FilterPill
            icon={CircleHelp}
            label="Reason"
            active={openPopover === "reason"}
            onClick={toggle("reason")}
          />
          {openPopover === "reason" && <ReasonPopover onClose={() => setOpenPopover(null)} />}
        </div>
        {activeTab === "all" && <FilterPill icon={CircleDashed} label="Status" />}
        <div className="relative">
          <FilterPill
            icon={DollarSign}
            label="Amount"
            active={openPopover === "amount"}
            onClick={toggle("amount")}
          />
          {openPopover === "amount" && <AmountFilterPopover onClose={() => setOpenPopover(null)} />}
        </div>
        <div className="relative">
          <FilterPill
            icon={Calendar}
            label="Dispute date"
            active={openPopover === "dispute-date"}
            onClick={toggle("dispute-date")}
          />
          {openPopover === "dispute-date" && (
            <DateFilterPopover label="Dispute date" onClose={() => setOpenPopover(null)} />
          )}
        </div>
        <div className="relative">
          <FilterPill
            icon={Calendar}
            label="Evidence due by"
            active={openPopover === "evidence-due"}
            onClick={toggle("evidence-due")}
          />
          {openPopover === "evidence-due" && (
            <DateFilterPopover label="Evidence due by" onClose={() => setOpenPopover(null)} />
          )}
        </div>

        <div className="flex-1" />

        <div className="toolbar-search w-[177px]">
          <Search size={16} strokeWidth={1.75} className="text-[#9ca3af] shrink-0" />
          <input type="text" placeholder="Search" />
        </div>
        <button type="button" className="btn-toolbar">
          Export
          <ExternalLink size={15} strokeWidth={1.75} />
        </button>
      </div>

      {showTable ? (
        <div className="content-card mt-5" style={{ padding: 0, gap: 0 }}>
          {/* header row */}
          <div className="flex items-center gap-4 px-6 py-3 bg-[#fafafa] border-b border-[#ebebeb] rounded-t-[15px]">
            <div className={`${COL.customer} text-[13px] font-medium text-[#6b7280]`}>Customer</div>
            <div className={`${COL.reason} text-[13px] font-medium text-[#6b7280]`}>Reason</div>
            <div className={`${COL.amount} text-[13px] font-medium text-[#6b7280]`}>Amount</div>
            <div className={`${COL.date} text-[13px] font-medium text-[#6b7280]`}>Dispute date</div>
            <div className={`${COL.due} text-[13px] font-medium text-[#6b7280]`}>Evidence due by</div>
            {showStatus && (
              <div className={`${COL.status} text-[13px] font-medium text-[#6b7280]`}>Status</div>
            )}
          </div>

          {/* data rows */}
          {visibleDisputes.map((dispute) => (
            <button
              key={dispute.id}
              type="button"
              onClick={() => onOpenDispute(dispute.id)}
              className="w-full flex items-center gap-4 px-6 py-4 text-left cursor-pointer hover:bg-[#fafafa] transition-colors border-t border-[#ebebeb] first:border-t-0"
            >
              <div className={`${COL.customer} flex items-center gap-2.5 min-w-0`}>
                <div className="flex items-center justify-center w-7 h-7 rounded-full bg-gradient-to-b from-[#a9cbfb] to-[#6fa0f2] text-white text-[11px] font-semibold shrink-0">
                  {dispute.customer.initials}
                </div>
                <span className="text-[14px] font-medium text-[#1a1a1a] truncate">
                  {dispute.customer.name}
                </span>
              </div>
              <div className={`${COL.reason} text-[14px] text-[#1a1a1a] truncate`}>{dispute.reason}</div>
              <div className={`${COL.amount} text-[14px] text-[#1a1a1a]`}>{dispute.amount}</div>
              <div className={`${COL.date} text-[14px] text-[#1a1a1a]`}>{dispute.openedAt}</div>
              <div
                className={`${COL.due} text-[14px] font-medium`}
                style={{ color: dispute.status === "Won" ? "#6b7280" : "#d5384b" }}
              >
                {dispute.evidenceDueAt}
              </div>
              {showStatus && (
                <div className={COL.status}>
                  <Badge variant={STATUS_VARIANT[dispute.status]}>{dispute.status}</Badge>
                </div>
              )}
            </button>
          ))}
        </div>
      ) : (
        <div className="content-card items-center justify-center mt-5" style={{ gap: 0 }}>
          <div className="flex items-center justify-center w-10 h-10 rounded-full bg-[#fafafa] text-[#9ca3af]">
            <Inbox size={20} strokeWidth={1.75} />
          </div>
          <div
            className="text-[13px] leading-[19px] font-semibold text-[#1a1a1a]"
            style={{ fontFamily: "var(--font-heading)", marginTop: 12 }}
          >
            {activeMeta.empty}
          </div>
        </div>
      )}
    </div>
  );
}
