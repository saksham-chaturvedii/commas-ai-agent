import { useEffect, useState } from "react";
import { X, Pencil, Check, Trash2, ImageIcon, FileText, TriangleAlert } from "lucide-react";
import { Badge } from "../shell/Badge";
import { SourceReferenceList } from "../chat/SourceReferenceList";
import { EvidenceUploadArea } from "./EvidenceUploadArea";
import { formatFileSize, useEvidenceFiles } from "../../lib/evidenceUpload";
import { deriveEvidenceSourceRefs } from "../../lib/mockData";
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

/** One already-saved attachment, shown in edit mode with a remove action — distinct from
 * `DrawerAttachmentChip` (the read-only, click-to-preview view) since editing needs a delete
 * affordance instead of a preview click. */
function ExistingFileRow({ file, onRemove }: { file: EvidenceFileMeta; onRemove: () => void }) {
  const isImage = file.type.startsWith("image/");
  return (
    <div className="flex items-center gap-2.5 px-3 py-2 rounded-lg border border-[var(--color-border-card)]">
      {isImage ? (
        <img src={file.mockUrl} alt="" className="w-8 h-8 rounded-md object-cover shrink-0 border border-[var(--color-border-card)]" />
      ) : (
        <div className="flex items-center justify-center w-8 h-8 rounded-md bg-[var(--color-app-bg)] text-[#9ca3af] shrink-0">
          <FileText size={15} strokeWidth={1.75} />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-medium text-[var(--color-text-primary)] truncate">{file.name}</div>
        <div className="text-[11px] text-[#9ca3af] mt-0.5">
          {file.type || "file"} · {formatFileSize(file.size)}
        </div>
      </div>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${file.name}`}
        className="flex items-center justify-center w-6 h-6 rounded-md text-[#9ca3af] hover:bg-black/[0.04] hover:text-[var(--color-text-primary)] shrink-0"
      >
        <X size={14} strokeWidth={1.75} />
      </button>
    </div>
  );
}

/**
 * Evidence Detail — a centered modal showing one evidence entry's full case-file detail: title,
 * category, source references, the record itself, and every attachment. Edit is available only
 * when `editable` (the caller gates this on "dispute still active" — DisputeDetail's
 * `isResolved`); editing covers title, record, AND the full attachment set — adding, removing, or
 * replacing files — through the same upload pipeline the "Add evidence" flow already uses.
 *
 * There is no separate "confirm proof" step: for a `proofRequired` item, editing it (attaching a
 * file and saving) IS confirming it — Save is simply disabled with an inline explanation until at
 * least one file is present, whether that's an existing attachment or one added this session.
 *
 * Once an item has been added, it's active case evidence immediately — there is no review/
 * approval state on top of that (no "Mark as reviewed," no "AI found" badge once it's in the
 * case). The only actions here are Edit and Delete.
 */
export function EvidenceDetailDrawer({
  item,
  editable,
  startInEditMode = false,
  onClose,
  onSave,
  onPreviewFile,
  onRemove,
}: {
  item: AIEvidenceItem;
  editable: boolean;
  /** Opens straight into edit mode — used by the accordion row's "Edit" menu action, and
   * always true for a `proofRequired` item with nothing to view yet. */
  startInEditMode?: boolean;
  onClose: () => void;
  onSave: (patch: { title: string; record: string; files: EvidenceFileMeta[] }) => void;
  onPreviewFile: (file: EvidenceFileMeta) => void;
  /** Permanently removes this evidence entry. Always offered while `editable` — "Added" is
   * never a locked state before the dispute response is submitted. */
  onRemove: () => void;
}) {
  const needsProofNow = Boolean(item.proofRequired) && !item.proofConfirmed;
  const [isEditing, setIsEditing] = useState(startInEditMode || needsProofNow);
  const [title, setTitle] = useState(item.title);
  const [record, setRecord] = useState(item.record);
  const [keptFiles, setKeptFiles] = useState<EvidenceFileMeta[]>(item.files);
  const { files: newFiles, notice, addFiles, removeFile, retryFile, allReady } = useEvidenceFiles();

  const readyNewFiles = newFiles.filter((f) => f.status === "ready");
  const totalFilesIfSaved = keptFiles.length + readyNewFiles.length;
  const stillNeedsProof = Boolean(item.proofRequired) && totalFilesIfSaved === 0;
  const canSave = allReady && !stillNeedsProof;

  // A different entry was clicked while the modal was open — reset local edit state to match,
  // rather than carrying over stale text/files or a stuck "editing" mode from the previous item.
  useEffect(() => {
    setIsEditing(startInEditMode || needsProofNow);
    setTitle(item.title);
    setRecord(item.record);
    setKeptFiles(item.files);
    // Deliberately keyed on item.id only — the live item's fields are read once, when the modal
    // switches to a (possibly new) item; re-running this on every store update to the same item
    // would clobber in-progress local edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const cancelEdit = () => {
    setTitle(item.title);
    setRecord(item.record);
    setKeptFiles(item.files);
    setIsEditing(false);
  };

  const save = () => {
    if (!canSave) return;
    const finalFiles: EvidenceFileMeta[] = [
      ...keptFiles,
      ...readyNewFiles.map((f) => ({
        name: f.name,
        type: f.file.type || f.extension,
        size: f.size,
        mockUrl: f.previewUrl ?? `mock://evidence/${f.id}`,
      })),
    ];
    onSave({ title: title.trim() || item.title, record: record.trim(), files: finalFiles });
    setIsEditing(false);
  };

  const handleRemove = () => {
    const confirmMessage =
      item.files.length > 1
        ? `Remove "${item.title}"? This permanently deletes this evidence entry and its ${item.files.length} attached files.`
        : `Remove "${item.title}"? This permanently deletes this evidence entry.`;
    if (window.confirm(confirmMessage)) onRemove();
  };

  const sources = deriveEvidenceSourceRefs(item);

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
              {stillNeedsProof && <Badge variant="warning">Proof required</Badge>}
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
            <div className="text-[12px] text-[#9ca3af] mt-1.5 flex items-center gap-2 flex-wrap">
              <span>{item.category}</span>
              <SourceReferenceList sources={sources} title={item.title} category={item.category} record={item.record} />
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

          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-[#9ca3af] mb-1.5">
              Attachments{!isEditing && item.files.length > 0 ? ` (${item.files.length})` : ""}
            </label>

            {isEditing ? (
              <div className="flex flex-col gap-2.5">
                {stillNeedsProof && (
                  <div className="flex items-start gap-1.5 rounded-lg bg-[#fff8f0] border border-[#f6ba94] px-3 py-2.5">
                    <TriangleAlert size={14} strokeWidth={2} className="text-[#cb6301] mt-0.5 shrink-0" />
                    <p className="text-[12.5px] leading-[17px] text-[#8a4a02]">
                      Supporting proof is required for evidence from external sources. Attach a screenshot or file before saving.
                    </p>
                  </div>
                )}
                {keptFiles.length > 0 && (
                  <div className="flex flex-col gap-1.5">
                    {keptFiles.map((f, i) => (
                      <ExistingFileRow
                        key={`${f.name}-${i}`}
                        file={f}
                        onRemove={() => setKeptFiles((prev) => prev.filter((_, idx) => idx !== i))}
                      />
                    ))}
                  </div>
                )}
                <EvidenceUploadArea files={newFiles} notice={notice} onFilesAdded={addFiles} onRemove={removeFile} onRetry={retryFile} />
              </div>
            ) : item.files.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {item.files.map((f, i) => (
                  <DrawerAttachmentChip key={`${item.id}-${i}`} file={f} onPreview={onPreviewFile} />
                ))}
              </div>
            ) : (
              <p className="text-[12.5px] text-[#9ca3af]">No files attached.</p>
            )}
          </div>
        </div>

        {editable && (
          <div className="flex items-center gap-2 px-5 py-4 border-t border-[#ebebeb] shrink-0">
            <button
              type="button"
              onClick={handleRemove}
              aria-label="Delete evidence"
              title="Delete evidence"
              className="flex items-center justify-center w-9 h-9 rounded-lg text-[#9ca3af] hover:bg-[#fdecee] hover:text-[var(--color-danger-text)] cursor-pointer shrink-0"
            >
              <Trash2 size={15} strokeWidth={1.75} />
            </button>
            <div className="flex-1" />
            {isEditing ? (
              <>
                <button type="button" className="btn-secondary" style={{ height: 38 }} onClick={cancelEdit}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn-dark"
                  style={{ height: 38, opacity: canSave ? 1 : 0.4, cursor: canSave ? "pointer" : "not-allowed" }}
                  disabled={!canSave}
                  onClick={save}
                >
                  <Check size={14} strokeWidth={2.5} />
                  Save
                </button>
              </>
            ) : (
              <button type="button" className="btn-secondary" style={{ height: 38 }} onClick={() => setIsEditing(true)}>
                <Pencil size={13} strokeWidth={1.75} />
                Edit
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
