import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import type { AIEvidenceItem } from "../../lib/disputeData";

const EVIDENCE_TYPES = [
  { value: "communication", label: "Customer communication", placeholder: "Support email thread" },
  { value: "activity", label: "Access record", placeholder: "Screen recording of course access" },
  { value: "invoice", label: "Invoice", placeholder: "Invoice or receipt copy" },
  { value: "product", label: "Product description", placeholder: "Product listing screenshot" },
  { value: "policy", label: "Refund policy", placeholder: "Refund policy document" },
  { value: "other", label: "Other", placeholder: "Description of evidence" },
] as const;

let manualIdCounter = 0;

export function AddEvidenceModal({
  onClose,
  onAdd,
}: {
  onClose: () => void;
  onAdd: (item: AIEvidenceItem) => void;
}) {
  const [type, setType] = useState<(typeof EVIDENCE_TYPES)[number]["value"]>("communication");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const typeMeta = EVIDENCE_TYPES.find((t) => t.value === type)!;
  const canAdd = title.trim().length > 0;

  const handleAdd = () => {
    if (!canAdd) return;
    manualIdCounter += 1;
    const item: AIEvidenceItem = {
      id: `manual-${manualIdCounter}`,
      title: title.trim(),
      record: description.trim() || `${typeMeta.label} added manually by the seller.`,
      why: "Added by the seller to support the response — review the entered details before relying on it.",
      sourceType: "manual",
      sourceLabel: `Added by you → ${typeMeta.label}`,
      addedBy: "seller",
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
        className="bg-white w-[480px] max-w-[92vw]"
        style={{ borderRadius: 16, boxShadow: "0 0 25px rgba(0,0,0,0.15)" }}
      >
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-[#ebebeb]">
          <h2 className="text-[16px] leading-[22px] font-semibold tracking-[-0.2px] text-[#1a1a1a]">
            Add evidence
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

        <div className="px-5 py-4 flex flex-col gap-4">
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
                style={{ minHeight: 90 }}
              />
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 pt-2 pb-5">
          <button type="button" className="btn-secondary" style={{ height: 40 }} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-dark"
            style={canAdd ? { height: 40 } : { height: 40, opacity: 0.4, cursor: "not-allowed" }}
            disabled={!canAdd}
            onClick={handleAdd}
          >
            Add evidence
          </button>
        </div>
      </div>
    </div>
  );
}
