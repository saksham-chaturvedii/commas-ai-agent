import { useRef, useState, type DragEvent } from "react";
import { UploadCloud, FileText, X, Loader2, Check, TriangleAlert, RotateCcw } from "lucide-react";
import {
  ACCEPT_ATTR,
  SUPPORTED_LABEL,
  formatFileSize,
  type EvidenceFile,
} from "../../lib/evidenceUpload";

const STATUS_LABEL: Record<EvidenceFile["status"], string> = {
  selected: "Waiting…",
  uploading: "Uploading…",
  processing: "Processing…",
  ready: "Ready",
  error: "Upload failed",
};

function StatusIndicator({ file, onRetry }: { file: EvidenceFile; onRetry: (id: string) => void }) {
  if (file.status === "ready") {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--color-success-text)]">
        <Check size={12} strokeWidth={2.5} /> Ready
      </span>
    );
  }
  if (file.status === "error") {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[var(--color-danger-text)]">
        <TriangleAlert size={12} strokeWidth={2} /> {STATUS_LABEL.error}
        <button
          type="button"
          onClick={() => onRetry(file.id)}
          className="inline-flex items-center gap-0.5 text-[var(--color-primary)] hover:underline"
        >
          <RotateCcw size={11} strokeWidth={2} /> Retry
        </button>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[#9ca3af]">
      <Loader2 size={12} strokeWidth={2} className="animate-spin" /> {STATUS_LABEL[file.status]}
    </span>
  );
}

function FileRow({
  file,
  onRemove,
  onRetry,
  onPreview,
}: {
  file: EvidenceFile;
  onRemove: (id: string) => void;
  onRetry: (id: string) => void;
  onPreview: (url: string) => void;
}) {
  return (
    <div
      className="flex items-center gap-2.5 px-3 py-2 rounded-lg border"
      style={{ borderColor: file.status === "error" ? "var(--color-danger-border, #f3aeb8)" : "var(--color-border-card)" }}
    >
      {file.previewUrl ? (
        <button
          type="button"
          onClick={() => onPreview(file.previewUrl!)}
          className="w-8 h-8 rounded-md overflow-hidden shrink-0 border border-[var(--color-border-card)]"
          aria-label={`Preview ${file.name}`}
        >
          <img src={file.previewUrl} alt="" className="w-full h-full object-cover" />
        </button>
      ) : (
        <div className="flex items-center justify-center w-8 h-8 rounded-md bg-[var(--color-app-bg)] text-[#9ca3af] shrink-0">
          <FileText size={15} strokeWidth={1.75} />
        </div>
      )}

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[13px] font-medium text-[var(--color-text-primary)] truncate">{file.name}</span>
          <span className="text-[11px] text-[#9ca3af] shrink-0">{formatFileSize(file.size)}</span>
        </div>
        <div className="mt-0.5">
          {file.status === "error" && file.errorMessage ? (
            <span className="text-[11px] text-[var(--color-danger-text)]">
              {file.errorMessage}{" "}
              <button type="button" onClick={() => onRetry(file.id)} className="text-[var(--color-primary)] hover:underline">
                Retry
              </button>
            </span>
          ) : (
            <StatusIndicator file={file} onRetry={onRetry} />
          )}
        </div>
      </div>

      <button
        type="button"
        onClick={() => onRemove(file.id)}
        aria-label={`Remove ${file.name}`}
        className="flex items-center justify-center w-6 h-6 rounded-md text-[#9ca3af] hover:bg-black/[0.04] hover:text-[var(--color-text-primary)] shrink-0"
      >
        <X size={14} strokeWidth={1.75} />
      </button>
    </div>
  );
}

/** Simple full-size image preview overlay — reuses the same dark-scrim modal convention as
 * AddEvidenceModal/ConnectedAppsModal, not a new pattern. */
function ImageLightbox({ url, onClose }: { url: string; onClose: () => void }) {
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
      <img src={url} alt="Evidence preview" className="max-w-full max-h-full rounded-lg" onMouseDown={(e) => e.stopPropagation()} />
    </div>
  );
}

export function EvidenceUploadArea({
  files,
  notice,
  onFilesAdded,
  onRemove,
  onRetry,
}: {
  files: EvidenceFile[];
  notice: string | null;
  onFilesAdded: (files: File[]) => void;
  onRemove: (id: string) => void;
  onRetry: (id: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) onFilesAdded(Array.from(e.dataTransfer.files));
  };

  return (
    <div>
      <label className="block text-[13px] text-[#404040] mb-1.5 pl-1">
        Attachments <span className="text-[#9ca3af] font-normal">(optional)</span>
      </label>

      <div
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => e.key === "Enter" && inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className="flex flex-col items-center justify-center gap-1 py-4 rounded-xl border border-dashed cursor-pointer transition-colors text-center"
        style={{
          borderColor: dragOver ? "var(--color-agent-accent)" : "var(--color-border-control)",
          background: dragOver ? "var(--color-agent-accent-bg)" : "#fafafa",
        }}
      >
        <UploadCloud size={20} strokeWidth={1.5} className="text-[#9ca3af]" />
        <span className="text-[13px] font-medium text-[var(--color-text-primary)]">Upload files</span>
        <span className="text-[12px] text-[#9ca3af]">Drag &amp; drop files here, or browse</span>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT_ATTR}
          className="hidden"
          onChange={(e) => {
            if (e.target.files && e.target.files.length > 0) onFilesAdded(Array.from(e.target.files));
            e.target.value = "";
          }}
        />
      </div>

      {notice && <p className="text-[11.5px] text-[var(--color-danger-text)] mt-1.5">{notice}</p>}

      {files.length > 0 && (
        <div className="flex flex-col gap-1.5 mt-2.5">
          {files.map((f) => (
            <FileRow key={f.id} file={f} onRemove={onRemove} onRetry={onRetry} onPreview={setLightboxUrl} />
          ))}
        </div>
      )}

      <p className="text-[11px] text-[#9ca3af] mt-2">
        Supported: {SUPPORTED_LABEL}
        <br />
        Maximum size: 10 MB per file
      </p>

      {lightboxUrl && <ImageLightbox url={lightboxUrl} onClose={() => setLightboxUrl(null)} />}
    </div>
  );
}
