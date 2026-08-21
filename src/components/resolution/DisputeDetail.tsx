import { useState } from "react";
import {
  ArrowLeft,
  CircleHelp,
  DollarSign,
  Calendar,
  CircleDashed,
  FileText,
  Receipt,
  Sparkles,
  Check,
} from "lucide-react";
import { Badge } from "../shell/Badge";
import { CardTitle } from "./CardTitle";
import { AddEvidenceModal } from "./AddEvidenceModal";
import { evidenceCategories, getDispute } from "../../lib/disputeData";

/**
 * Dispute Detail page, ported from commas-ai-copilot and evolved: the old prototype's inline
 * "Collect evidence with AI" scripted copilot flow is replaced by "Investigate with AI",
 * which opens the contextual agent panel on the right (the agent panel IS the evolution of
 * that copilot card). The manual evidence checklist, response draft box, and the
 * dispute/customer/transaction detail cards are ported as-is. Parameterized by `disputeId` so
 * all 5 demo cases (docs/active-context.md) share this one page.
 */

function DetailRow({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof CircleHelp;
  label: string;
  value: string;
}) {
  return (
    <div className="detail-row">
      <Icon size={16} strokeWidth={1.75} className="text-[#9ca3af] mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-[12px] leading-[16px] text-[#9ca3af]">{label}</div>
        <div className="text-[14px] leading-[20px] font-medium text-[#1a1a1a] mt-0.5">{value}</div>
      </div>
    </div>
  );
}

function ManualEvidenceCard({ initialAdded }: { initialAdded: string[] }) {
  const [added, setAdded] = useState<Set<string>>(new Set(initialAdded));
  const [modalFor, setModalFor] = useState<string | null>(null);

  return (
    <div className="content-card" style={{ padding: 24, gap: 0 }}>
      <div className="flex items-baseline justify-between mb-1">
        <CardTitle>Evidence</CardTitle>
        <span className="text-[12px] text-[#9ca3af]">
          {added.size} of {evidenceCategories.length} items added
        </span>
      </div>
      <div className="mt-2">
        {evidenceCategories.map((item) => {
          const isAdded = added.has(item.label);
          return (
            <div
              key={item.label}
              className="flex items-center gap-3 py-3 border-t border-[#ebebeb] first:border-t-0"
            >
              <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-[#fafafa] border border-[#ebebeb] shrink-0">
                <FileText size={15} strokeWidth={1.75} className="text-[#9ca3af]" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[14px] leading-[20px] font-medium text-[#1a1a1a]">{item.label}</div>
                <div className="text-[12px] leading-[16px] text-[#9ca3af] mt-0.5">{item.description}</div>
              </div>
              {isAdded ? <Badge variant="success">Added</Badge> : <Badge variant="neutral">Not added</Badge>}
              <button
                type="button"
                className="btn-toolbar shrink-0"
                style={{ height: 29 }}
                onClick={() => setModalFor(item.label)}
              >
                {isAdded ? "Add another" : "Add"}
              </button>
            </div>
          );
        })}
      </div>

      {modalFor && (
        <AddEvidenceModal
          onClose={() => setModalFor(null)}
          onAdd={() => {
            setAdded((prev) => new Set(prev).add(modalFor));
            setModalFor(null);
          }}
        />
      )}
    </div>
  );
}

export function DisputeDetail({
  disputeId,
  onBack,
  onInvestigate,
}: {
  disputeId: string;
  onBack: () => void;
  onInvestigate: () => void;
}) {
  const [response, setResponse] = useState("");
  const [justSaved, setJustSaved] = useState(false);
  const dispute = getDispute(disputeId);

  const saveDraft = () => {
    setJustSaved(true);
    setTimeout(() => setJustSaved(false), 2000);
  };

  if (!dispute) return null;

  return (
    <div className="main-surface flex flex-col p-0 min-h-[370px] pt-[30px] px-5 pb-5 flex-1 overflow-y-auto">
      {/* back link */}
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1.5 pl-[5px] text-[13px] font-medium text-[#6b7280] hover:text-[#1a1a1a] transition-colors w-fit cursor-pointer"
        style={{ fontFamily: "var(--font-heading)" }}
      >
        <ArrowLeft size={14} strokeWidth={2} />
        Resolution Center
      </button>

      {/* header */}
      <div className="flex items-center gap-2.5 mt-3 pl-[5px]">
        <h1
          className="text-[20px] leading-[26px] font-semibold tracking-[-0.4px] text-[#1a1a1a]"
          style={{ fontFamily: "var(--font-heading)" }}
        >
          Dispute #{dispute.id}
        </h1>
        <Badge variant={dispute.status === "Won" ? "success" : "warning"}>{dispute.status}</Badge>
        <div className="flex-1" />
        <button type="button" className="btn-blue" onClick={onInvestigate}>
          <Sparkles size={16} strokeWidth={1.75} />
          Investigate with AI
        </button>
      </div>
      <div className="pl-[5px] mt-1.5 text-[14px] leading-[20px] text-[#6b7280]">
        {dispute.amount} · {dispute.reason} · Evidence due {dispute.evidenceDueAt}{" "}
        <span className="text-[#d5384b] font-medium">({dispute.evidenceDueLabel})</span>
      </div>

      <div className="mt-5 border-t border-black/[0.06]" />

      {/* two-column layout */}
      <div className="flex gap-5 mt-5 items-start">
        {/* left column */}
        <div className="flex flex-col gap-5 flex-[2] min-w-0">
          <ManualEvidenceCard initialAdded={dispute.initialEvidenceAdded} />

          {/* response card */}
          <div className="content-card" style={{ padding: 24, gap: 0 }}>
            <div className="flex items-center gap-2.5 mb-3">
              <CardTitle>Your response</CardTitle>
            </div>
            <div className="textarea-shell">
              <textarea
                value={response}
                onChange={(e) => setResponse(e.target.value)}
                placeholder="Describe why this dispute should be resolved in your favor... (ask the AI to draft this for you)"
              />
            </div>
            <div className="flex items-center gap-3 mt-4">
              {justSaved && (
                <span className="inline-flex items-center gap-1 text-[12px] leading-[17px] text-[#4e9b11] font-medium">
                  <Check size={13} strokeWidth={2.5} />
                  Draft saved
                </span>
              )}
              <div className="flex-1" />
              <button type="button" className="btn-secondary" style={{ height: 40 }} onClick={saveDraft}>
                Save draft
              </button>
              <button
                type="button"
                disabled
                className="btn-dark"
                style={{ height: 40, opacity: 0.4, cursor: "not-allowed" }}
                title="Submission is simulated in this prototype"
              >
                Submit response
              </button>
            </div>
          </div>
        </div>

        {/* right column */}
        <div className="flex flex-col gap-5 flex-1 min-w-[280px] max-w-[320px]">
          <div className="content-card" style={{ padding: 24, gap: 0 }}>
            <div className="mb-1">
              <CardTitle>Dispute details</CardTitle>
            </div>
            <DetailRow icon={CircleHelp} label="Reason" value={dispute.reason} />
            <DetailRow icon={DollarSign} label="Amount" value={dispute.amount} />
            <DetailRow icon={Calendar} label="Dispute date" value={dispute.openedAt} />
            <DetailRow icon={Calendar} label="Evidence due by" value={dispute.evidenceDueAt} />
            <DetailRow icon={CircleDashed} label="Status" value={dispute.status} />
          </div>

          <div className="content-card" style={{ padding: 24, gap: 0 }}>
            <div className="mb-3">
              <CardTitle>Customer</CardTitle>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center w-9 h-9 rounded-full bg-gradient-to-b from-[#a9cbfb] to-[#6fa0f2] text-white text-[13px] font-semibold shrink-0">
                {dispute.customer.initials}
              </div>
              <div className="min-w-0">
                <div className="text-[14px] leading-[20px] font-medium text-[#1a1a1a] truncate">
                  {dispute.customer.name}
                </div>
                <div className="text-[12px] leading-[16px] text-[#9ca3af] truncate">
                  {dispute.customer.email}
                </div>
              </div>
            </div>
          </div>

          <div className="content-card" style={{ padding: 24, gap: 0 }}>
            <div className="mb-1">
              <CardTitle>Transaction</CardTitle>
            </div>
            <DetailRow icon={Receipt} label="Product" value={dispute.product.name} />
            <DetailRow icon={DollarSign} label="Amount" value={dispute.amount} />
            <DetailRow icon={Calendar} label="Purchased" value={dispute.purchasedAt} />
          </div>
        </div>
      </div>
    </div>
  );
}
