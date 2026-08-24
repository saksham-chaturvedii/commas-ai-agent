import { useEffect, useState } from "react";
import { X, Pencil, Check, ImageIcon, FileText } from "lucide-react";
import { Badge } from "../shell/Badge";
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
 * Right-side detail drawer for one evidence entry — the "case file" view: full title,
 * description, why-it-matters, and every attachment, none of which fit in the accordion row's
 * compact preview. Edit is available only when `editable` (the caller already gates this on
 * "dispute still active" — DisputeDetail's `isResolved`), and only for the two free-text fields
 * (title/record) — attachments and category are structural, not something this drawer edits.
 */
export function EvidenceDetailDrawer({
  item,
  editable,
  onClose,
  onSave,
  onPreviewFile,
  onMarkReviewed,
  onInspectSource,
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
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [title, setTitle] = useState(item.title);
  const [record, setRecord] = useState(item.record);

  // A different entry was clicked while the drawer was open — reset local edit state to match,
  // rather than carrying over stale text or a stuck "editing" mode from the previous item.
  useEffect(() => {
    setIsEditing(false);
    setTitle(item.title);
    setRecord(item.record);
    // Deliberately keyed on item.id only — the live item's title/record are read once, when
    // the drawer switches to a (possibly new) item; re-running this on every store update to
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

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onMouseDown={onClose}>
      <div style={{ background: "rgba(0,0,0,0.15)" }} className="absolute inset-0" />
      <aside
        className="relative main-surface flex flex-col w-[400px] max-w-[92vw] h-full shrink-0 overflow-hidden shadow-[-8px_0_30px_rgba(0,0,0,0.12)]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 h-14 border-b border-black/[0.06] shrink-0">
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
            <div className="flex items-center justify-between mb-1">
              <label className="text-[11px] font-semibold uppercase tracking-wide text-[#9ca3af]">Title</label>
              {item.addedBy === "ai" && (item.verifiedByHuman ? <Badge variant="success">Reviewed</Badge> : <Badge variant="info">AI found</Badge>)}
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
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-[#9ca3af] mb-1">Description</label>
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

          {item.why && (
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wide text-[#9ca3af] mb-1">Why it matters</label>
              <p className="text-[13.5px] leading-[19px] text-[#1a1a1a]">{item.why}</p>
            </div>
          )}

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
            {isEditing ? (
              <>
                <button type="button" className="btn-secondary flex-1" style={{ height: 38 }} onClick={() => setIsEditing(false)}>
                  Cancel
                </button>
                <button type="button" className="btn-dark flex-1" style={{ height: 38 }} onClick={save}>
                  <Check size={14} strokeWidth={2.5} />
                  Save
                </button>
              </>
            ) : (
              <>
                <button type="button" className="btn-secondary flex-1" style={{ height: 38 }} onClick={() => setIsEditing(true)}>
                  <Pencil size={13} strokeWidth={1.75} />
                  Edit
                </button>
                {item.addedBy === "ai" && !item.verifiedByHuman && onMarkReviewed && (
                  <button type="button" className="btn-dark flex-1" style={{ height: 38 }} onClick={onMarkReviewed}>
                    <Check size={14} strokeWidth={2.5} />
                    Mark as reviewed
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </aside>
    </div>
  );
}
