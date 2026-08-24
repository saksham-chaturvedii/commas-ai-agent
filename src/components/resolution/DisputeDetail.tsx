import { useState } from "react";
import {
  ArrowLeft,
  CircleHelp,
  DollarSign,
  Calendar,
  CircleDashed,
  ChevronDown,
  FileText,
  Image as ImageIcon,
  Receipt,
  Sparkles,
  Check,
  Trash2,
  X,
} from "lucide-react";
import { Badge } from "../shell/Badge";
import { CardTitle } from "./CardTitle";
import { AddEvidenceModal } from "./AddEvidenceModal";
import { EvidenceDetailDrawer } from "./EvidenceDetailDrawer";
import { evidenceCategories, getDispute, type AIEvidenceItem, type EvidenceFileMeta } from "../../lib/disputeData";
import { formatFileSize } from "../../lib/evidenceUpload";
import { useChatStore } from "../../hooks/useChatStore";
import { sourceIdFromLabel } from "../../lib/mockData";
import { EvidenceInspectorModal, type InspectableEvidence } from "../chat/EvidenceInspectorModal";

/**
 * Dispute Detail page, ported from commas-ai-copilot and evolved: the old prototype's inline
 * "Collect evidence with AI" scripted copilot flow is replaced by "Investigate with AI",
 * which opens the contextual agent panel on the right (the agent panel IS the evolution of
 * that copilot card). The manual evidence checklist, response draft box, and the
 * dispute/customer/transaction detail cards are ported as-is. Parameterized by `disputeId` so
 * all 5 demo cases (docs/active-context.md) share this one page.
 *
 * Resolved disputes (status !== "Needs response") render read-only, per docs/active-context.md
 * — "Resolved Disputes Are Read-Only": no Add/Add another buttons, no editable response, a
 * "Submitted response" record instead. One implementation, conditionally rendered — not two
 * separate page variants.
 */

function AttachmentChip({ file, onPreview }: { file: EvidenceFileMeta; onPreview: (file: EvidenceFileMeta) => void }) {
  const Icon = file.type.startsWith("image/") ? ImageIcon : FileText;
  return (
    <button
      type="button"
      onClick={() => onPreview(file)}
      className="inline-flex items-center gap-1.5 h-7 pl-1.5 pr-2.5 rounded-full border border-[var(--color-border-card)] bg-white hover:bg-[#fafafa] text-[12px] text-[#404040] cursor-pointer transition-colors"
    >
      <Icon size={12} strokeWidth={1.75} className="text-[#9ca3af] shrink-0" />
      <span className="truncate max-w-[180px]">{file.name}</span>
    </button>
  );
}

/** Full-size preview for a clicked attachment — images render directly (including seeded
 * historical evidence's placeholder mock images, see disputeData.ts's mockImageDataUri); other
 * file types show an honest "no preview" card rather than pretending to open a real document. */
function AttachmentPreviewOverlay({ file, onClose }: { file: EvidenceFileMeta; onClose: () => void }) {
  const isImage = file.type.startsWith("image/");
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-8"
      style={{ background: "rgba(0,0,0,0.7)" }}
      onMouseDown={onClose}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close preview"
        className="absolute top-5 right-5 flex items-center justify-center w-9 h-9 rounded-full bg-white/10 text-white hover:bg-white/20"
      >
        <X size={18} strokeWidth={1.75} />
      </button>
      {isImage ? (
        <img
          src={file.mockUrl}
          alt={file.name}
          className="max-w-full max-h-full rounded-lg"
          onMouseDown={(e) => e.stopPropagation()}
        />
      ) : (
        <div className="bg-white rounded-xl p-6 w-[320px] text-center" onMouseDown={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-center w-12 h-12 rounded-lg bg-[#fafafa] border border-[#ebebeb] mx-auto mb-3">
            <FileText size={20} strokeWidth={1.75} className="text-[#9ca3af]" />
          </div>
          <div className="text-[14px] font-medium text-[#1a1a1a] truncate">{file.name}</div>
          <div className="text-[12px] text-[#9ca3af] mt-1">{formatFileSize(file.size)}</div>
          <p className="text-[12px] text-[#9ca3af] mt-3">Preview isn't available for this file type in the prototype.</p>
        </div>
      )}
    </div>
  );
}

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

function ManualEvidenceCard({
  disputeId,
  initialAdded,
  evidenceItems,
  onAddEvidence,
  isResolved,
}: {
  disputeId: string;
  initialAdded: string[];
  evidenceItems: AIEvidenceItem[];
  onAddEvidence: (item: AIEvidenceItem) => void;
  /** Resolved disputes show every item's full title/description/attachments but drop all
   * Add/Add-another controls — a historical record, not an editable checklist. */
  isResolved: boolean;
}) {
  const [modalFor, setModalFor] = useState<string | null>(null);
  const [justAdded, setJustAdded] = useState<string | null>(null);
  const [previewFile, setPreviewFile] = useState<EvidenceFileMeta | null>(null);
  const [inspecting, setInspecting] = useState<InspectableEvidence | null>(null);
  // Accordion state: which category rows are expanded — starts empty (every category collapsed)
  // so the checklist reads as a scannable list of categories first, detail only on request.
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  // The drawer holds an id, not a snapshot of the item — so an edit or "mark as reviewed" made
  // while it's open is reflected immediately (the live item is looked up from `evidenceItems`
  // below), instead of the drawer showing stale data until it's reopened.
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const { verifyEvidenceItem, updateEvidenceItem, confirmEvidenceProof, removeEvidenceItem } = useChatStore();

  const itemsByCategory = new Map<string, AIEvidenceItem[]>();
  for (const item of evidenceItems) {
    itemsByCategory.set(item.category, [...(itemsByCategory.get(item.category) ?? []), item]);
  }
  // "Fully added" excludes a third-party item still awaiting proof (proofRequired &&
  // !proofConfirmed) — it has a row in the checklist so the seller can act on it, but neither
  // the category badge nor the "X of N" count treats it as done until proof is confirmed.
  const isFullyAdded = (i: AIEvidenceItem) => !i.proofRequired || i.proofConfirmed;
  const addedCount = evidenceCategories.filter(
    (c) => initialAdded.includes(c.label) || (itemsByCategory.get(c.label) ?? []).some(isFullyAdded),
  ).length;
  const selectedItem = evidenceItems.find((i) => i.id === selectedItemId) ?? null;

  const handleAdd = (item: AIEvidenceItem) => {
    onAddEvidence(item);
    setModalFor(null);
    setJustAdded(`"${item.title}" added${item.files.length > 0 ? ` — ${item.files.length} file${item.files.length === 1 ? "" : "s"}` : ""}.`);
    window.setTimeout(() => setJustAdded(null), 3000);
    setExpandedCategories((prev) => new Set(prev).add(item.category));
  };

  const toggleCategory = (label: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  };

  return (
    <div className="content-card" style={{ padding: 24, gap: 0 }}>
      <div className="flex items-baseline justify-between mb-1">
        <CardTitle>Evidence</CardTitle>
        <span className="text-[12px] text-[#9ca3af]">
          {addedCount} of {evidenceCategories.length} items added
        </span>
      </div>
      {justAdded && (
        <div className="flex items-center gap-1.5 mt-2 text-[12.5px] font-medium text-[var(--color-success-text)]">
          <Check size={13} strokeWidth={2.5} /> Evidence added successfully — {justAdded}
        </div>
      )}
      <div className="mt-2">
        {evidenceCategories.map((item) => {
          const items = itemsByCategory.get(item.label) ?? [];
          const isAdded = initialAdded.includes(item.label) || items.some(isFullyAdded);
          const isExpanded = expandedCategories.has(item.label);
          return (
            <div key={item.label} className="py-3 border-t border-[#ebebeb] first:border-t-0">
              <button
                type="button"
                onClick={() => toggleCategory(item.label)}
                className="w-full flex items-center gap-3 text-left cursor-pointer"
                aria-expanded={isExpanded}
              >
                <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-[#fafafa] border border-[#ebebeb] shrink-0">
                  <FileText size={15} strokeWidth={1.75} className="text-[#9ca3af]" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[14px] leading-[20px] font-medium text-[#1a1a1a]">{item.label}</div>
                  <div className="text-[12px] leading-[16px] text-[#9ca3af] mt-0.5">{item.description}</div>
                </div>
                {isAdded ? <Badge variant="success">Added</Badge> : <Badge variant="neutral">Not added</Badge>}
                {!isResolved && (
                  <span
                    role="button"
                    tabIndex={0}
                    className="btn-toolbar shrink-0"
                    style={{ height: 29 }}
                    onClick={(e) => {
                      e.stopPropagation();
                      setModalFor(item.label);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        e.stopPropagation();
                        setModalFor(item.label);
                      }
                    }}
                  >
                    Add evidence
                  </span>
                )}
                <ChevronDown
                  size={16}
                  strokeWidth={1.75}
                  className="text-[#9ca3af] shrink-0 transition-transform"
                  style={{ transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)" }}
                />
              </button>

              {isExpanded && (
                <div className="mt-2.5 pl-11">
                  {items.length > 0 ? (
                    <ul className="flex flex-col gap-1.5">
                      {items.map((si) => {
                        const needsProof = Boolean(si.proofRequired) && !si.proofConfirmed;
                        return (
                          <li key={si.id}>
                            {/* A real <button> can't contain AttachmentChip's own <button>s
                               * (invalid HTML — the browser silently un-nests them, breaking
                               * clicks), so this row uses role="button" instead, exactly like the
                               * category header above does for the same reason. */}
                            <div
                              role="button"
                              tabIndex={0}
                              onClick={() => setSelectedItemId(si.id)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  setSelectedItemId(si.id);
                                }
                              }}
                              className="w-full text-left py-2 px-2.5 rounded-lg bg-[#fafafa] border border-[#ebebeb] hover:border-[#d9d9d9] cursor-pointer transition-colors"
                            >
                              <div className="flex items-start gap-2">
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <div className="text-[12.5px] font-medium text-[#1a1a1a]">{si.title}</div>
                                    {si.addedBy === "ai" &&
                                      (si.verifiedByHuman ? (
                                        <Badge variant="success">Reviewed</Badge>
                                      ) : (
                                        <Badge variant="info">AI found</Badge>
                                      ))}
                                    {needsProof && <Badge variant="warning">Proof required</Badge>}
                                  </div>
                                  <div className="text-[11.5px] text-[#9ca3af] mt-0.5">
                                    {si.sourceLabel}
                                    {si.files.length > 0 ? ` · ${si.files.length} file${si.files.length === 1 ? "" : "s"}` : ""}
                                  </div>
                                  {si.record && <div className="text-[11.5px] leading-[16px] text-[#6b7280] mt-1 line-clamp-2">{si.record}</div>}
                                  {needsProof && (
                                    <div className="text-[11.5px] font-medium text-[#cb6301] mt-1">Attach proof to add this evidence</div>
                                  )}
                                  {si.files.length > 0 && (
                                    <div className="flex flex-wrap gap-1.5 mt-1.5" onClick={(e) => e.stopPropagation()}>
                                      {si.files.map((f, i) => (
                                        <AttachmentChip key={`${si.id}-${i}`} file={f} onPreview={setPreviewFile} />
                                      ))}
                                    </div>
                                  )}
                                </div>
                                {!isResolved && (
                                  <button
                                    type="button"
                                    aria-label={`Remove ${si.title}`}
                                    title="Remove evidence"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      const confirmMessage =
                                        si.files.length > 1
                                          ? `Remove "${si.title}"? This permanently deletes this evidence entry and its ${si.files.length} attached files.`
                                          : `Remove "${si.title}"? This permanently deletes this evidence entry.`;
                                      if (window.confirm(confirmMessage)) removeEvidenceItem(disputeId, si.id);
                                    }}
                                    className="flex items-center justify-center w-6 h-6 rounded-md text-[#9ca3af] hover:bg-[#fdecee] hover:text-[var(--color-danger-text)] shrink-0"
                                  >
                                    <Trash2 size={13} strokeWidth={1.75} />
                                  </button>
                                )}
                              </div>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <p className="text-[12.5px] text-[#9ca3af] py-1">Nothing added to this category yet.</p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {!isResolved && modalFor && (
        <AddEvidenceModal category={modalFor} onClose={() => setModalFor(null)} onAdd={handleAdd} />
      )}
      {previewFile && <AttachmentPreviewOverlay file={previewFile} onClose={() => setPreviewFile(null)} />}
      {inspecting && <EvidenceInspectorModal evidence={inspecting} onClose={() => setInspecting(null)} />}
      {selectedItem && (
        <EvidenceDetailDrawer
          item={selectedItem}
          editable={!isResolved}
          onClose={() => setSelectedItemId(null)}
          onSave={(patch) => updateEvidenceItem(disputeId, selectedItem.id, patch)}
          onPreviewFile={setPreviewFile}
          onMarkReviewed={
            selectedItem.addedBy === "ai" && !selectedItem.verifiedByHuman && !isResolved
              ? () => verifyEvidenceItem(disputeId, selectedItem.id)
              : undefined
          }
          onInspectSource={
            selectedItem.addedBy === "ai"
              ? () =>
                  setInspecting({
                    title: selectedItem.title,
                    category: selectedItem.category,
                    record: selectedItem.record,
                    sourceLabel: selectedItem.sourceLabel,
                    sourceId: sourceIdFromLabel(selectedItem.sourceLabel),
                  })
              : undefined
          }
          onConfirmProof={(files) => confirmEvidenceProof(disputeId, selectedItem.id, files)}
          onRemove={() => {
            removeEvidenceItem(disputeId, selectedItem.id);
            setSelectedItemId(null);
          }}
        />
      )}
    </div>
  );
}

export function DisputeDetail({
  disputeId,
  evidenceItems,
  onAddEvidence,
  onBack,
  onInvestigate,
}: {
  disputeId: string;
  /** Session-lifetime evidence added via "Add evidence" — owned by App.tsx (AppShell) so it
   * survives DisputeDetail unmounting when the seller navigates back to the list and returns
   * (docs/active-context.md — "Evidence File Upload"). */
  evidenceItems: AIEvidenceItem[];
  onAddEvidence: (item: AIEvidenceItem) => void;
  onBack: () => void;
  onInvestigate: () => void;
}) {
  const [justSaved, setJustSaved] = useState(false);
  const [justSubmitted, setJustSubmitted] = useState(false);
  const { markedReadyDisputeIds, responseDraftByDispute, setResponseDraft } = useChatStore();
  const markedReadyByAI = markedReadyDisputeIds.includes(disputeId);
  // Lifted to useChatStore (docs/AI_ASSISTANT_ARCHITECTURE.md §7) so the chat's
  // `propose_draft_response` approval flow can set it too — the same state this textarea reads,
  // never a separate copy. Still survives navigating back to the RC list and returning, same as
  // before, since it now lives above DisputeDetail's own mount lifecycle instead of local state.
  const response = responseDraftByDispute[disputeId] ?? "";
  const dispute = getDispute(disputeId);
  // "Needs response" is the only non-terminal status this prototype's data models today;
  // written as a negation (rather than === "Won") so a future "Lost" status is read-only too
  // without needing another branch here.
  const isResolved = dispute ? dispute.status !== "Needs response" : false;

  const saveDraft = () => {
    setJustSaved(true);
    setTimeout(() => setJustSaved(false), 2000);
  };

  const canSubmit = evidenceItems.length > 0;
  const submitResponse = () => {
    if (!canSubmit) return;
    setJustSubmitted(true);
    setTimeout(() => setJustSubmitted(false), 2000);
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
        {!isResolved && (
          <button type="button" className="btn-blue" onClick={onInvestigate}>
            <Sparkles size={16} strokeWidth={1.75} />
            Investigate with AI
          </button>
        )}
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
          <ManualEvidenceCard
            disputeId={disputeId}
            initialAdded={dispute.initialEvidenceAdded}
            evidenceItems={evidenceItems}
            onAddEvidence={onAddEvidence}
            isResolved={isResolved}
          />

          {isResolved ? (
            <div className="content-card" style={{ padding: 24, gap: 0 }}>
              <div className="mb-3">
                <CardTitle>Submitted response</CardTitle>
              </div>
              <p className="text-[14px] leading-[21px] text-[#1a1a1a]">
                {dispute.submittedResponse?.text ?? "No response was recorded for this case."}
              </p>
              {dispute.submittedResponse && (
                <div className="flex items-center gap-8 mt-4 pt-4 border-t border-[#ebebeb]">
                  <div>
                    <div className="text-[11px] text-[#9ca3af]">Submitted on</div>
                    <div className="text-[13px] font-medium text-[#1a1a1a] mt-0.5">
                      {dispute.submittedResponse.submittedAt}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-[#9ca3af]">Status</div>
                    <div className="text-[13px] font-medium text-[#1a1a1a] mt-0.5">Submitted</div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="content-card" style={{ padding: 24, gap: 0 }}>
              <div className="flex items-center gap-2.5 mb-3">
                <CardTitle>Your response</CardTitle>
                {markedReadyByAI && <Badge variant="success">Marked ready by AI</Badge>}
              </div>
              <div className="textarea-shell">
                <textarea
                  value={response}
                  onChange={(e) => setResponseDraft(disputeId, e.target.value)}
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
                {justSubmitted && (
                  <span className="inline-flex items-center gap-1 text-[12px] leading-[17px] text-[#4e9b11] font-medium">
                    <Check size={13} strokeWidth={2.5} />
                    Response submitted
                  </span>
                )}
                <div className="flex-1" />
                <button type="button" className="btn-secondary" style={{ height: 40 }} onClick={saveDraft}>
                  Save draft
                </button>
                <button
                  type="button"
                  disabled={!canSubmit}
                  className="btn-dark"
                  style={!canSubmit ? { height: 40, opacity: 0.4, cursor: "not-allowed" } : { height: 40 }}
                  onClick={submitResponse}
                  title={canSubmit ? "Submission is simulated in this prototype" : "Add at least one piece of evidence before submitting"}
                >
                  Submit response
                </button>
              </div>
            </div>
          )}
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
