import { useState } from "react";
import { Check, X, FileText } from "lucide-react";
import type { ProposedAction } from "../../lib/types";
import { getDispute } from "../../lib/disputeData";
import { useChatStore } from "../../hooks/useChatStore";

/**
 * Renders one agent-proposed action (docs/AI_ASSISTANT_ARCHITECTURE.md §7) inline under the
 * assistant message that proposed it — never a modal, matching ApprovalCard's existing pattern
 * so this reads as part of the conversation. Nothing here executes on its own: every path to
 * addEvidenceItem/setResponseDraft goes through an explicit click on the buttons below
 * (useChatStore's resolveProposedAction is the only caller of either).
 *
 * Defense in depth against a resolved dispute ever reaching this card (the backend already
 * refuses to offer these tools once a dispute's status isn't "Needs response" —
 * server/agent/runtime.ts's availableToolsFor): if the dispute this action targets is resolved,
 * the card renders as a plain, non-actionable note instead of approve/decline controls,
 * mirroring DisputeDetail's own "no editing controls on a resolved dispute" rule exactly.
 */
export function ProposedActionCard({ action, chatId, messageId }: { action: ProposedAction; chatId: string; messageId: string }) {
  const { resolveProposedAction } = useChatStore();
  const dispute = getDispute(action.disputeId);
  const isResolved = dispute ? dispute.status !== "Needs response" : false;
  const [selected, setSelected] = useState<Set<number>>(
    () => new Set(action.type === "add_evidence" ? action.items.map((_, i) => i) : []),
  );

  const toggle = (i: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  const approve = () => {
    if (action.type === "add_evidence") {
      resolveProposedAction(chatId, messageId, action.id, "approve", Array.from(selected));
    } else {
      resolveProposedAction(chatId, messageId, action.id, "approve");
    }
  };
  const decline = () => resolveProposedAction(chatId, messageId, action.id, "decline");

  if (isResolved) {
    return (
      <div className="content-card max-w-[480px]" style={{ padding: 16, gap: 6 }}>
        <div className="text-[11px] font-semibold uppercase tracking-wide text-[#9ca3af] mb-1">Proposed action</div>
        <p className="text-[13.5px] leading-[19px] text-[var(--color-text-primary)]">{action.summary}</p>
        <p className="text-[12px] leading-[17px] text-[#9ca3af]">
          Dispute #{action.disputeId} is already resolved — this proposal can't be applied.
        </p>
      </div>
    );
  }

  if (action.status !== "pending") {
    const outcome =
      action.status === "approved"
        ? action.type === "add_evidence"
          ? `Added ${action.approvedCount ?? 0} evidence item${action.approvedCount === 1 ? "" : "s"}.`
          : "Draft applied to the response."
        : "Dismissed.";
    return (
      <div className="content-card max-w-[480px]" style={{ padding: 16, gap: 6 }}>
        <div className="text-[11px] font-semibold uppercase tracking-wide text-[#9ca3af] mb-1">Proposed action</div>
        <p className="text-[13.5px] leading-[19px] text-[var(--color-text-primary)]">{action.summary}</p>
        <div className="flex items-center gap-1.5 text-[12.5px] font-medium text-[var(--color-success-text)]">
          {action.status === "approved" && <Check size={13} strokeWidth={2.5} />}
          {outcome}
        </div>
      </div>
    );
  }

  return (
    <div className="content-card max-w-[480px]" style={{ padding: 16, gap: 10 }}>
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-agent-accent)] mb-1">
          {action.type === "add_evidence" ? "Recommended evidence" : "Proposed draft"}
        </div>
        <p className="text-[13.5px] leading-[19px] text-[var(--color-text-primary)]">{action.summary}</p>
      </div>

      {action.type === "add_evidence" && (
        <ul className="flex flex-col gap-2">
          {action.items.map((item, i) => (
            <li key={i} className="flex items-start gap-2.5 py-2 px-2.5 rounded-lg bg-[#fafafa] border border-[#ebebeb]">
              <input
                type="checkbox"
                checked={selected.has(i)}
                onChange={() => toggle(i)}
                className="mt-1 shrink-0"
                aria-label={`Include ${item.title}`}
              />
              <div className="min-w-0">
                <div className="text-[12.5px] font-medium text-[#1a1a1a]">{item.title}</div>
                <div className="text-[11px] text-[#9ca3af] mt-0.5">{item.category} · {item.sourceLabel}</div>
                <div className="text-[12px] leading-[17px] text-[#6b7280] mt-1">{item.why}</div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {action.type === "draft_response" && (
        <div className="rounded-lg bg-[#fafafa] border border-[#ebebeb] p-3 flex items-start gap-2.5">
          <FileText size={14} strokeWidth={1.75} className="text-[#9ca3af] mt-0.5 shrink-0" />
          <p className="text-[12.5px] leading-[18px] text-[#1a1a1a] whitespace-pre-wrap">{action.draftText}</p>
        </div>
      )}

      <div className="flex items-center gap-2">
        <button type="button" className="btn-secondary flex-1" style={{ height: 36 }} onClick={decline}>
          <X size={14} strokeWidth={2} />
          Dismiss
        </button>
        <button
          type="button"
          className="btn-dark flex-1"
          style={{ height: 36 }}
          onClick={approve}
          disabled={action.type === "add_evidence" && selected.size === 0}
        >
          <Check size={14} strokeWidth={2.5} />
          {action.type === "add_evidence" ? `Add selected${selected.size > 0 ? ` (${selected.size})` : ""}` : "Use this draft"}
        </button>
      </div>
    </div>
  );
}
