import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, fireEvent, cleanup } from "@testing-library/react";
import { AddEvidenceModal } from "../src/components/resolution/AddEvidenceModal";
import type { AIEvidenceItem } from "../src/lib/disputeData";

/**
 * Evidence file upload flow (docs/active-context.md — "Evidence File Upload"): validation,
 * the mock Selected->Uploading->Processing->Ready pipeline, and the form->review->submit step
 * machine. Locks in a real bug this feature caught during manual testing: addFiles() originally
 * scheduled upload timers from an array mutated inside the setFiles() updater callback, which
 * React doesn't guarantee runs before the next line executes — files got stuck in "selected"
 * forever. Fixed in src/lib/evidenceUpload.ts by building entries with plain synchronous JS
 * first, then scheduling from that.
 */

function makeFile(name: string, sizeBytes: number, type = "application/pdf"): File {
  const bytes = sizeBytes > 0 ? new Uint8Array(sizeBytes) : new Uint8Array(0);
  return new File([bytes], name, { type });
}

function selectFiles(files: File[]) {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  Object.defineProperty(input, "files", { value: files, configurable: true });
  fireEvent.change(input);
}

describe("Add evidence — file upload", () => {
  beforeEach(() => {
    // jsdom doesn't implement the Object URL APIs the real browser provides for image
    // thumbnails/lightbox previews — stub them so file selection doesn't throw in tests.
    vi.stubGlobal("URL", { ...URL, createObjectURL: vi.fn(() => "blob:mock-preview"), revokeObjectURL: vi.fn() });
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("progresses a valid file through selected -> uploading -> processing -> ready (deterministic timers)", async () => {
    vi.useFakeTimers();
    render(<AddEvidenceModal category="Customer communications" onClose={vi.fn()} onAdd={vi.fn()} />);

    act(() => selectFiles([makeFile("receipt.pdf", 1024)]));
    expect(screen.getByText("receipt.pdf")).toBeInTheDocument();
    expect(screen.getByText(/Uploading|Waiting/)).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1200);
    });
    expect(screen.getByText("Ready")).toBeInTheDocument();
  });

  it("rejects an unsupported file type but keeps it visible with a Retry option, not silently dropped", () => {
    vi.useFakeTimers();
    render(<AddEvidenceModal category="Customer communications" onClose={vi.fn()} onAdd={vi.fn()} />);

    act(() => selectFiles([makeFile("notes.txt", 100, "text/plain")]));
    expect(screen.getByText("notes.txt")).toBeInTheDocument();
    expect(screen.getByText(/Unsupported file type/)).toBeInTheDocument();
    expect(screen.getAllByText("Retry").length).toBeGreaterThan(0);
  });

  it("rejects a file over the 10 MB limit, naming the actual size", () => {
    vi.useFakeTimers();
    render(<AddEvidenceModal category="Customer communications" onClose={vi.fn()} onAdd={vi.fn()} />);

    act(() => selectFiles([makeFile("huge.pdf", 11 * 1024 * 1024)]));
    expect(screen.getByText(/exceeds the 10 MB limit/)).toBeInTheDocument();
  });

  it("rejects an empty (0-byte) file as corrupted", () => {
    vi.useFakeTimers();
    render(<AddEvidenceModal category="Customer communications" onClose={vi.fn()} onAdd={vi.fn()} />);

    act(() => selectFiles([makeFile("blank.pdf", 0)]));
    expect(screen.getByText(/empty or corrupted/)).toBeInTheDocument();
  });

  it("detects a duplicate (same name + size) without adding a second row, and shows a notice", () => {
    vi.useFakeTimers();
    render(<AddEvidenceModal category="Customer communications" onClose={vi.fn()} onAdd={vi.fn()} />);

    act(() => selectFiles([makeFile("a.pdf", 500)]));
    act(() => selectFiles([makeFile("a.pdf", 500)]));
    expect(screen.getAllByText("a.pdf")).toHaveLength(1);
    expect(screen.getByText(/is already added/)).toBeInTheDocument();
  });

  it("removing the only invalid file re-enables the primary button", async () => {
    vi.useFakeTimers();
    render(<AddEvidenceModal category="Customer communications" onClose={vi.fn()} onAdd={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText("Support email thread"), { target: { value: "Support thread" } });
    act(() => selectFiles([makeFile("notes.txt", 100, "text/plain")]));
    expect(screen.getByRole("button", { name: "Add evidence" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Remove notes.txt" }));
    expect(screen.getByRole("button", { name: "Add evidence" })).not.toBeDisabled();
  });

  it("the deterministic failure trigger (\"fail\" in the filename) reaches an error state, and Retry re-runs the pipeline", async () => {
    vi.useFakeTimers();
    render(<AddEvidenceModal category="Customer communications" onClose={vi.fn()} onAdd={vi.fn()} />);

    act(() => selectFiles([makeFile("will-fail.pdf", 500)]));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1200);
    });
    expect(screen.getByText(/Upload failed/)).toBeInTheDocument();

    fireEvent.click(screen.getAllByText("Retry")[0]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1200);
    });
    expect(screen.getByText(/Upload failed/)).toBeInTheDocument(); // deterministically fails again
  });

  it("full flow: form -> review -> submit produces an AIEvidenceItem with category and ready files only", async () => {
    vi.useFakeTimers();
    const onAdd = vi.fn<(item: AIEvidenceItem) => void>();
    const onClose = vi.fn();
    render(<AddEvidenceModal category="Customer communications" onClose={onClose} onAdd={onAdd} />);

    // "Other" is the only evidence type with a free-text title — every other type has a fixed,
    // non-editable title derived from the type itself (audit follow-up: seller feedback).
    fireEvent.click(screen.getByRole("button", { name: "Other" }));
    fireEvent.change(screen.getByPlaceholderText("Description of evidence"), { target: { value: "Support email thread" } });
    fireEvent.change(screen.getByPlaceholderText("Describe what this evidence shows..."), {
      target: { value: "Customer confirmed delivery." },
    });
    act(() => selectFiles([makeFile("email.pdf", 1024), makeFile("photo.png", 2048, "image/png")]));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1200);
    });
    expect(screen.getAllByText("Ready")).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "Add evidence" }));
    expect(screen.getByText("Review evidence")).toBeInTheDocument();
    expect(screen.getByText(/ATTACHMENTS|Attachments/)).toHaveTextContent("2");

    fireEvent.click(screen.getByText("Submit evidence"));
    expect(onAdd).toHaveBeenCalledTimes(1);
    const item = onAdd.mock.calls[0][0];
    expect(item.category).toBe("Customer communications");
    expect(item.title).toBe("Support email thread");
    expect(item.files).toHaveLength(2);
    expect(item.files.map((f) => f.name).sort()).toEqual(["email.pdf", "photo.png"]);
  });

  it("Back returns to the form step with all entered data and files intact", async () => {
    vi.useFakeTimers();
    render(<AddEvidenceModal category="Customer communications" onClose={vi.fn()} onAdd={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Other" }));
    fireEvent.change(screen.getByPlaceholderText("Description of evidence"), { target: { value: "My title" } });
    act(() => selectFiles([makeFile("email.pdf", 1024)]));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1200);
    });
    fireEvent.click(screen.getByRole("button", { name: "Add evidence" }));
    expect(screen.getByText("Review evidence")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Back"));
    expect(screen.queryByText("Review evidence")).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText("Description of evidence")).toHaveValue("My title");
    expect(screen.getByText("email.pdf")).toBeInTheDocument();
  });

  it("every evidence type but 'Other' has a fixed, non-editable title derived from the type", () => {
    render(<AddEvidenceModal category="Customer communications" onClose={vi.fn()} onAdd={vi.fn()} />);

    // Default type (Customer communication) — title is pre-filled and read-only.
    const titleInput = screen.getByPlaceholderText("Support email thread") as HTMLInputElement;
    expect(titleInput).toHaveValue("Customer communication");
    expect(titleInput).toHaveAttribute("readonly");
    fireEvent.change(titleInput, { target: { value: "attempted edit" } });
    expect(titleInput).toHaveValue("Customer communication"); // readOnly ignores the change event

    // Switching type re-fills the fixed title.
    fireEvent.click(screen.getByRole("button", { name: "Invoice" }));
    expect(screen.getByPlaceholderText("Invoice or receipt copy")).toHaveValue("Invoice");

    // Only "Other" allows free text.
    fireEvent.click(screen.getByRole("button", { name: "Other" }));
    const otherInput = screen.getByPlaceholderText("Description of evidence") as HTMLInputElement;
    expect(otherInput).toHaveValue("");
    expect(otherInput).not.toHaveAttribute("readonly");
    fireEvent.change(otherInput, { target: { value: "Custom evidence title" } });
    expect(otherInput).toHaveValue("Custom evidence title");
  });
});
