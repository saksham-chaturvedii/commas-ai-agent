import { Check, X } from "lucide-react";
import type { PendingApproval } from "../../lib/types";
import { useChatStore } from "../../hooks/useChatStore";

/**
 * Write-action confirmation — renders inline in the transcript (not a modal) so it reads as
 * part of the conversation, matching the existing Commas card language (content-card,
 * btn-dark/btn-secondary from index.css) rather than inventing a new pattern. Nothing the
 * agent proposes here ever executes without this being approved (PROTOTYPE_SPEC.md §4.6).
 */
export function ApprovalCard({ approval }: { approval: PendingApproval }) {
  const { approveWrite, declineWrite } = useChatStore();

  return (
    <div className="content-card max-w-[480px]" style={{ padding: 16, gap: 10 }}>
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-agent-accent)] mb-1">
          Confirm action
        </div>
        <p className="text-[13.5px] leading-[19px] text-[var(--color-text-primary)]">{approval.summary}</p>
      </div>
      <div className="flex items-center gap-2">
        <button type="button" className="btn-secondary flex-1" style={{ height: 36 }} onClick={declineWrite}>
          <X size={14} strokeWidth={2} />
          Decline
        </button>
        <button type="button" className="btn-dark flex-1" style={{ height: 36 }} onClick={approveWrite}>
          <Check size={14} strokeWidth={2.5} />
          Approve
        </button>
      </div>
    </div>
  );
}
