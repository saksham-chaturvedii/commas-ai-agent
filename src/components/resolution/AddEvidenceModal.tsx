import { useEffect, useRef, useState } from "react";
import { X, ArrowLeft, Paperclip } from "lucide-react";
import type { AIEvidenceItem } from "../../lib/disputeData";
import { useEvidenceFiles, formatFileSize } from "../../lib/evidenceUpload";
import { EvidenceUploadArea } from "./EvidenceUploadArea";

const EVIDENCE_TYPES = [
  { value: "communication", label: "Customer communication", placeholder: "Support email thread" },
  { value: "activity", label: "Access record", placeholder: "Screen recording of course access" },
  { value: "invoice", label: "Invoice", placeholder: "Invoice or receipt copy" },
  { value: "product", label: "Product description", placeholder: "Product listing screenshot" },
  { value: "policy", label: "Refund policy", placeholder: "Refund policy document" },
  { value: "other", label: "Other", placeholder: "Description of evidence" },
] as const;

let manualIdCounter = 0;

/**
 * Add-evidence flow: SELECT TYPE → ENTER METADATA → SELECT FILES → VALIDATE → UPLOAD/PROCESS
 * (EvidenceUploadArea/useEvidenceFiles) → REVIEW → SUBMIT (docs/active-context.md — "Evidence
 * File Upload"). Same modal chrome/width/typography as before this pass — only the body grew a
 * step machine and an attachments section; no new visual language introduced.
 */
export function AddEvidenceModal({
  category,
  onClose,
  onAdd,
}: {
  /** The evidence checklist category (row) this modal was opened from — stamped onto the
   * created item so the Resolution Center can group/display it without a redesign. */
  category: string;
  onClose: () => void;
  onAdd: (item: AIEvidenceItem) => void;
}) {
  const [step, setStep] = useState<"form" | "review">("form");
  const [type, setType] = useState<(typeof EVIDENCE_TYPES)[number]["value"]>("communication");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const { files, notice, addFiles, removeFile, retryFile, allReady } = useEvidenceFiles();
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const typeMeta = EVIDENCE_TYPES.find((t) => t.value === type)!;
  const canContinue = title.trim().length > 0 && allReady;
  const readyFiles = files.filter((f) => f.status === "ready");

  const handleSubmit = () => {
    manualIdCounter += 1;
    const item: AIEvidenceItem = {
      id: `manual-${manualIdCounter}`,
      title: title.trim(),
      record: description.trim() || `${typeMeta.label} added manually by the seller.`,
      why: "Added by the seller to support the response — review the entered details before relying on it.",
      sourceType: "manual",
      sourceLabel: `Added by you → ${typeMeta.label}`,
      addedBy: "seller",
      category,
      files: readyFiles.map((f) => ({
        name: f.name,
        type: f.file.type || f.extension,
        size: f.size,
        mockUrl: f.previewUrl ?? `mock://evidence/${f.id}/${encodeURIComponent(f.name)}`,
      })),
    };
    onAdd(item);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.3)" }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={cardRef}
        className="bg-white w-[480px] max-w-[92vw] max-h-[88vh] flex flex-col"
        style={{ borderRadius: 16, boxShadow: "0 0 25px rgba(0,0,0,0.15)" }}
      >
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-[#ebebeb] shrink-0">
          <h2 className="text-[16px] leading-[22px] font-semibold tracking-[-0.2px] text-[#1a1a1a]">
            {step === "form" ? "Add evidence" : "Review evidence"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex items-center justify-center w-7 h-7 rounded-full text-[#9ca3af] hover:bg-[#fafafa] cursor-pointer"
          >
            <X size={16} strokeWidth={1.75} />
          </button>
        </div>

        {step === "form" ? (
          <div className="px-5 py-4 flex flex-col gap-4 overflow-y-auto">
            <div>
              <label className="block text-[13px] text-[#404040] mb-1.5 pl-1">Evidence type</label>
              <div className="flex flex-wrap gap-2">
                {EVIDENCE_TYPES.map((t) => (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => setType(t.value)}
                    className="inline-flex items-center h-8 px-3 rounded-full text-[13px] font-medium cursor-pointer transition-colors"
                    style={
                      type === t.value
                        ? { background: "#1a1a1a", color: "#fff" }
                        : { background: "#fafafa", color: "#404040", border: "1px solid #ebebeb" }
                    }
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-[13px] text-[#404040] mb-1.5 pl-1">Title</label>
              <div className="textarea-shell" style={{ borderRadius: 12 }}>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={typeMeta.placeholder}
                  className="w-full"
                  style={{
                    padding: "10px 14px",
                    border: "none",
                    outline: "none",
                    background: "transparent",
                    fontFamily: "var(--font-body)",
                    fontSize: 14,
                    color: "#1a1a1a",
                    borderRadius: "10.5px",
                  }}
                />
              </div>
            </div>

            <div>
              <label className="block text-[13px] text-[#404040] mb-1.5 pl-1">
                Details <span className="text-[#9ca3af] font-normal">(optional)</span>
              </label>
              <div className="textarea-shell">
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Describe what this evidence shows..."
                  style={{ minHeight: 72 }}
                />
              </div>
            </div>

            <EvidenceUploadArea files={files} notice={notice} onFilesAdded={addFiles} onRemove={removeFile} onRetry={retryFile} />
          </div>
        ) : (
          <div className="px-5 py-4 flex flex-col gap-4 overflow-y-auto">
            <div className="content-card" style={{ padding: 16, gap: 12 }}>
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-[#9ca3af]">Evidence type</div>
                <div className="text-[14px] font-medium text-[#1a1a1a] mt-0.5">{typeMeta.label}</div>
              </div>
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-[#9ca3af]">Title</div>
                <div className="text-[14px] font-medium text-[#1a1a1a] mt-0.5">{title.trim()}</div>
              </div>
              {description.trim() && (
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-[#9ca3af]">Details</div>
                  <div className="text-[13.5px] leading-[19px] text-[#404040] mt-0.5">{description.trim()}</div>
                </div>
              )}
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-[#9ca3af] mb-1">
                  Attachments {readyFiles.length > 0 && `(${readyFiles.length})`}
                </div>
                {readyFiles.length === 0 ? (
                  <div className="text-[13px] text-[#9ca3af]">No files attached.</div>
                ) : (
                  <ul className="flex flex-col gap-1">
                    {readyFiles.map((f) => (
                      <li key={f.id} className="flex items-center gap-1.5 text-[13px] text-[#1a1a1a]">
                        <Paperclip size={13} strokeWidth={1.75} className="text-[#9ca3af] shrink-0" />
                        <span className="truncate">{f.name}</span>
                        <span className="text-[#9ca3af] shrink-0">· {formatFileSize(f.size)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
            <p className="text-[12px] text-[#9ca3af] px-1">
              This evidence will be added to the dispute and available for the seller's response.
            </p>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 px-5 pt-2 pb-5 shrink-0">
          {step === "form" ? (
            <>
              <button type="button" className="btn-secondary" style={{ height: 40 }} onClick={onClose}>
                Cancel
              </button>
              <button
                type="button"
                className="btn-dark"
                style={canContinue ? { height: 40 } : { height: 40, opacity: 0.4, cursor: "not-allowed" }}
                disabled={!canContinue}
                onClick={() => canContinue && setStep("review")}
              >
                Add evidence
              </button>
            </>
          ) : (
            <>
              <button type="button" className="btn-secondary" style={{ height: 40 }} onClick={onClose}>
                Cancel
              </button>
              <button
                type="button"
                className="btn-secondary inline-flex items-center gap-1.5"
                style={{ height: 40 }}
                onClick={() => setStep("form")}
              >
                <ArrowLeft size={14} strokeWidth={2} /> Back
              </button>
              <button type="button" className="btn-dark" style={{ height: 40 }} onClick={handleSubmit}>
                Submit evidence
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
