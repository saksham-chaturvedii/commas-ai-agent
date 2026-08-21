import { useEffect, useRef, useState } from "react";

/**
 * Mock file-upload pipeline for the "Add evidence" flow (docs/active-context.md — "Evidence
 * File Upload"). No real storage or backend involved — this simulates Selected → Uploading →
 * Processing → Ready with deterministic timers so the demo is reproducible. There were no
 * pre-existing file-type/size limits anywhere in this prototype, so these are new, documented
 * defaults (also shown directly in the UI, per the task).
 */

export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
export const SUPPORTED_EXTENSIONS = ["jpg", "jpeg", "png", "webp", "pdf", "doc", "docx"];
export const SUPPORTED_LABEL = "JPG, PNG, WEBP, PDF, DOC, DOCX";
export const ACCEPT_ATTR = SUPPORTED_EXTENSIONS.map((e) => `.${e}`).join(",");

/** Deterministic failure demo: a filename containing "fail" (case-insensitive) always fails
 * at the upload step, so the error/retry state can be demonstrated reproducibly without real
 * randomness — same convention as the chat pipeline's hidden "all roads lead to" test phrase. */
const DETERMINISTIC_FAIL_TRIGGER = "fail";
const UPLOAD_MS = 550;
const PROCESS_MS = 550;

export type EvidenceFileStatus = "selected" | "uploading" | "processing" | "ready" | "error";

export interface EvidenceFile {
  id: string;
  file: File;
  name: string;
  size: number;
  extension: string;
  status: EvidenceFileStatus;
  errorMessage?: string;
  /** Object URL for image files only — used for the thumbnail/lightbox preview. Revoked on
   * removal/unmount. */
  previewUrl?: string;
}

function extensionOf(name: string): string {
  const m = name.toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : "";
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb < 10 ? 1 : 0)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(mb < 10 ? 1 : 0)} MB`;
}

let idCounter = 0;
function newFileId() {
  idCounter += 1;
  return `evidence-file-${idCounter}`;
}

/**
 * React hook owning the file list + its mock upload/processing state machine. Kept separate
 * from the presentational EvidenceUploadArea component so validation/timing logic is testable
 * and reusable on its own.
 */
export function useEvidenceFiles() {
  const [files, setFiles] = useState<EvidenceFile[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const timersRef = useRef<number[]>([]);
  const filesRef = useRef<EvidenceFile[]>([]);
  filesRef.current = files;

  useEffect(
    () => () => {
      timersRef.current.forEach((t) => window.clearTimeout(t));
      filesRef.current.forEach((f) => f.previewUrl && URL.revokeObjectURL(f.previewUrl));
    },
    [],
  );

  function updateFile(id: string, patch: Partial<EvidenceFile>) {
    setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  }

  function scheduleProcessing(id: string, filename: string) {
    updateFile(id, { status: "uploading" });
    const willFail = filename.toLowerCase().includes(DETERMINISTIC_FAIL_TRIGGER);
    const uploadTimer = window.setTimeout(() => {
      if (willFail) {
        updateFile(id, {
          status: "error",
          errorMessage: "Upload failed — the mock upload service returned an error.",
        });
        return;
      }
      updateFile(id, { status: "processing" });
      const processTimer = window.setTimeout(() => updateFile(id, { status: "ready" }), PROCESS_MS);
      timersRef.current.push(processTimer);
    }, UPLOAD_MS);
    timersRef.current.push(uploadTimer);
  }

  function addFiles(rawFiles: File[]) {
    // Built with plain synchronous JS against filesRef.current, not inside the setFiles
    // updater — React doesn't guarantee an updater function runs before the next line of
    // code executes, so scheduling timers from state mutated inside one is unreliable (it
    // silently scheduled nothing here, leaving files stuck in "selected" forever).
    const duplicateNotices: string[] = [];
    const newEntries: EvidenceFile[] = [];
    const existing = [...filesRef.current];

    for (const file of rawFiles) {
      const isDuplicate = [...existing, ...newEntries].some((f) => f.name === file.name && f.size === file.size);
      if (isDuplicate) {
        duplicateNotices.push(`"${file.name}" is already added.`);
        continue;
      }

      let errorMessage: string | undefined;
      if (file.size === 0) {
        errorMessage = "This file appears to be empty or corrupted.";
      } else {
        const ext = extensionOf(file.name);
        if (!SUPPORTED_EXTENSIONS.includes(ext)) {
          errorMessage = `Unsupported file type "${ext ? `.${ext}` : "unknown"}" — accepted: ${SUPPORTED_LABEL}.`;
        } else if (file.size > MAX_FILE_SIZE_BYTES) {
          errorMessage = `File is ${formatFileSize(file.size)}, which exceeds the 10 MB limit.`;
        }
      }

      const id = newFileId();
      const isImage = file.type.startsWith("image/") && !errorMessage;
      newEntries.push({
        id,
        file,
        name: file.name,
        size: file.size,
        extension: extensionOf(file.name),
        status: errorMessage ? "error" : "selected",
        errorMessage,
        previewUrl: isImage ? URL.createObjectURL(file) : undefined,
      });
    }

    if (newEntries.length > 0) setFiles((prev) => [...prev, ...newEntries]);
    setNotice(duplicateNotices.length > 0 ? duplicateNotices.join(" ") : null);
    newEntries.filter((e) => e.status !== "error").forEach((e) => scheduleProcessing(e.id, e.name));
  }

  function removeFile(id: string) {
    setFiles((prev) => {
      const target = prev.find((f) => f.id === id);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((f) => f.id !== id);
    });
  }

  function retryFile(id: string) {
    const target = files.find((f) => f.id === id);
    if (!target) return;
    updateFile(id, { errorMessage: undefined });
    scheduleProcessing(id, target.name);
  }

  const allReady = files.every((f) => f.status === "ready");

  return { files, notice, addFiles, removeFile, retryFile, allReady };
}
