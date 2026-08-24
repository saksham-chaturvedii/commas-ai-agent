import { useEffect, useState } from "react";
import { X, Pencil, Check, Trash2, ImageIcon, FileText, TriangleAlert } from "lucide-react";
import { Badge } from "../shell/Badge";
import { EvidenceUploadArea } from "./EvidenceUploadArea";
import { useEvidenceFiles } from "../../lib/evidenceUpload";
import type { AIEvidenceItem, EvidenceFileMeta } from "../../lib/disputeData";

function DrawerAttachmentChip({ file, onPreview }: { file: EvidenceFileMeta; onPreview: (file: EvidenceFileMeta) => void }) {
  const Icon = file.type.startsWith("image/") ? ImageIcon : FileText;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onPreview(file);
      }}
      className="inline-flex items-center gap-1.5 h-8 pl-2 pr-3 rounded-lg border border-[var(--color-border-card)] bg-white hover:bg-[#fafafa] text-[12.5px] text-[#404040] cursor-pointer transition-colors"
    >
      <Icon size={13} strokeWidth={1.75} className="text-[#9ca3af] shrink-0" />
      <span className="truncate max-w-[220px]">{file.name}</span>
    </button>
  );
}

/**
 * Evidence Detail — a centered modal (not a side drawer; see the module-level comment history
 * for why: a translucent right-side panel let background content bleed through distractingly)
 * showing one evidence entry's full case-file detail: title, category/source, the record
 * itself, and every attachment. Edit is available only when `editable` (the caller gates this on
 * "dispute still active" — DisputeDetail's `isResolved`), and only for the two free-text fields
 * (title/record) — attachments and category are structural, not something this modal edits
 * directly (attachments are replaced wholesale via the proof-upload flow below, never patched).
 *
 * Third-party-sourced evidence (`proofRequired`) that hasn't been confirmed yet shows an upload
 * flow instead of a plain attachments list — the seller must attach real proof and explicitly
 * confirm before it counts as fully added (native Commas evidence and seller-manual entries never
 * carry `proofRequired`, so they skip straight to the normal attachments view).
 */
export function EvidenceDetailDrawer({
  item,
  editable,
  onClose,
  onSave,
  onPreviewFile,
  onMarkReviewed,
  onInspectSource,
  onConfirmProof,
  onRemove,
}: {
  item: AIEvidenceItem;
  editable: boolean;
  onClose: () => void;
  onSave: (patch: { title: string; record: string }) => void;
  onPreviewFile: (file: EvidenceFileMeta) => void;
  /** Only offered for AI-found, not-yet-reviewed items — mirrors the accordion row's own gate. */
  onMarkReviewed?: () => void;
  /** Opens the existing source-record inspector (Fathom call, Gmail thread, ...) — only offered
   * for AI-found items, same as the accordion row's "Inspect" link did before this change. */
  onInspectSource?: () => void;
  /** Attaches the confirmed proof files and marks this item fully added — only rendered (and
   * only ever called) while `item.proofRequired && !item.proofConfirmed`. */
  onConfirmProof: (files: EvidenceFileMeta[]) => void;
  /** Permanently removes this evidence entry. Always offered while `editable` — "Added" is
   * never a locked state before the dispute response is submitted. */
  onRemove: () => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [title, setTitle] = useState(item.title);
  const [record, setRecord] = useState(item.record);
  const { files, notice, addFiles, removeFile, retryFile, allReady } = useEvidenceFiles();

  const needsProof = Boolean(item.proofRequired) && !item.proofConfirmed;
  const readyProofFiles = files.filter((f) => f.status === "ready");
  const canConfirmProof = readyProofFiles.length > 0 && allReady;

  // A different entry was clicked while the modal was open — reset local edit state to match,
  // rather than carrying over stale text or a stuck "editing" mode from the previous item.
  useEffect(() => {
    setIsEditing(false);
    setTitle(item.title);
    setRecord(item.record);
    // Deliberately keyed on item.id only — the live item's title/record are read once, when
    // the modal switches to a (possibly new) item; re-running this on every store update to
    // the same item would clobber in-progress local edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const save = () => {
    onSave({ title: title.trim() || item.title, record: record.trim() });
    setIsEditing(false);
  };

  const confirmProof = () => {
    if (!canConfirmProof) return;
    onConfirmProof(
      readyProofFiles.map((f) => ({
        name: f.name,
        type: f.file.type || f.extension,
        size: f.size,
        mockUrl: f.previewUrl ?? `mock://evidence/${f.id}`,
      })),
    );
  };

  const handleRemove = () => {
    const confirmMessage =
      item.files.length > 1
        ? `Remove "${item.title}"? This permanently deletes this evidence entry and its ${item.files.length} attached files.`
        : `Remove "${item.title}"? This permanently deletes this evidence entry.`;
    if (window.confirm(confirmMessage)) onRemove();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6"
      style={{ background: "rgba(0,0,0,0.55)" }}
      onMouseDown={onClose}
    >
      <div
        className="bg-white w-[500px] max-w-[92vw] max-h-[88vh] flex flex-col"
        style={{ borderRadius: 16, boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-[#ebebeb] shrink-0">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-[#9ca3af]">Evidence detail</div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex items-center justify-center w-7 h-7 rounded-full text-[#9ca3af] hover:bg-[#fafafa] cursor-pointer"
          >
            <X size={16} strokeWidth={1.75} />
          </button>
        </div>

        <div className="px-5 py-4 flex flex-col gap-4 overflow-y-auto flex-1">
          <div>
            <div className="flex items-center justify-between mb-1 gap-2">
              <label className="text-[11px] font-semibold uppercase tracking-wide text-[#9ca3af]">Title</label>
              <div className="flex items-center gap-1.5 shrink-0">
                {item.addedBy === "ai" && (item.verifiedByHuman ? <Badge variant="success">Reviewed</Badge> : <Badge variant="info">AI found</Badge>)}
                {needsProof && <Badge variant="warning">Proof required</Badge>}
              </div>
            </div>
            {isEditing ? (
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full"
                style={{
                  padding: "8px 10px",
                  border: "1px solid var(--color-border-control)",
                  borderRadius: 10,
                  fontFamily: "var(--font-body)",
                  fontSize: 15,
                  fontWeight: 600,
                  color: "#1a1a1a",
                }}
              />
            ) : (
              <div className="text-[16px] leading-[22px] font-semibold text-[#1a1a1a]">{item.title}</div>
            )}
            <div className="text-[12px] text-[#9ca3af] mt-1">
              {item.category} · {item.sourceLabel}
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-[#9ca3af] mb-1">Record</label>
            {isEditing ? (
              <textarea
                value={record}
                onChange={(e) => setRecord(e.target.value)}
                rows={4}
                className="w-full"
                style={{
                  padding: "8px 10px",
                  border: "1px solid var(--color-border-control)",
                  borderRadius: 10,
                  fontFamily: "var(--font-body)",
                  fontSize: 13.5,
                  color: "#1a1a1a",
                  resize: "vertical",
                }}
              />
            ) : (
              <p className="text-[13.5px] leading-[19px] text-[#1a1a1a] whitespace-pre-wrap">
                {item.record || "No description recorded."}
              </p>
            )}
          </div>

          {needsProof ? (
            <div>
              <div className="flex items-center gap-1.5 mb-1.5">
                <TriangleAlert size={13} strokeWidth={2} className="text-[#cb6301]" />
                <label className="text-[11px] font-semibold uppercase tracking-wide text-[#cb6301]">Supporting proof required</label>
              </div>
              <p className="text-[12.5px] leading-[18px] text-[#6b7280] mb-2">
                This was found in {item.sourceLabel}, an external app — attach a screenshot or file from it before this counts as
                added to the case.
              </p>
              {editable ? (
                <>
                  <EvidenceUploadArea files={files} notice={notice} onFilesAdded={addFiles} onRemove={removeFile} onRetry={retryFile} />
                  <button
                    type="button"
                    className="btn-dark w-full mt-3"
                    style={{ height: 38, opacity: canConfirmProof ? 1 : 0.4, cursor: canConfirmProof ? "pointer" : "not-allowed" }}
                    disabled={!canConfirmProof}
                    onClick={confirmProof}
                  >
                    <Check size={14} strokeWidth={2.5} />
                    Confirm evidence
                  </button>
                </>
              ) : (
                <p className="text-[12.5px] text-[#9ca3af]">No proof was attached before this dispute was resolved.</p>
              )}
            </div>
          ) : (
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wide text-[#9ca3af] mb-1.5">
                Attachments{item.files.length > 0 ? ` (${item.files.length})` : ""}
              </label>
              {item.files.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {item.files.map((f, i) => (
                    <DrawerAttachmentChip key={`${item.id}-${i}`} file={f} onPreview={onPreviewFile} />
                  ))}
                </div>
              ) : (
                <p className="text-[12.5px] text-[#9ca3af]">No files attached.</p>
              )}
            </div>
          )}

          {item.addedBy === "ai" && onInspectSource && (
            <button
              type="button"
              className="text-[12.5px] font-medium text-[var(--color-agent-accent)] cursor-pointer w-fit"
              onClick={onInspectSource}
            >
              Inspect underlying source
            </button>
          )}
        </div>

        {editable && (
          <div className="flex items-center gap-2 px-5 py-4 border-t border-[#ebebeb] shrink-0">
            <button
              type="button"
              onClick={handleRemove}
              aria-label="Remove evidence"
              title="Remove evidence"
              className="flex items-center justify-center w-9 h-9 rounded-lg text-[#9ca3af] hover:bg-[#fdecee] hover:text-[var(--color-danger-text)] cursor-pointer shrink-0"
            >
              <Trash2 size={15} strokeWidth={1.75} />
            </button>
            <div className="flex-1" />
            {!needsProof &&
              (isEditing ? (
                <>
                  <button type="button" className="btn-secondary" style={{ height: 38 }} onClick={() => setIsEditing(false)}>
                    Cancel
                  </button>
                  <button type="button" className="btn-dark" style={{ height: 38 }} onClick={save}>
                    <Check size={14} strokeWidth={2.5} />
                    Save
                  </button>
                </>
              ) : (
                <>
                  <button type="button" className="btn-secondary" style={{ height: 38 }} onClick={() => setIsEditing(true)}>
                    <Pencil size={13} strokeWidth={1.75} />
                    Edit
                  </button>
                  {item.addedBy === "ai" && !item.verifiedByHuman && onMarkReviewed && (
                    <button type="button" className="btn-dark" style={{ height: 38 }} onClick={onMarkReviewed}>
                      <Check size={14} strokeWidth={2.5} />
                      Mark as reviewed
                    </button>
                  )}
                </>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}
