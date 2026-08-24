import { useEffect } from "react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ChatStoreProvider, useChatStore } from "../src/hooks/useChatStore";
import { DisputeDetail } from "../src/components/resolution/DisputeDetail";
import type { AIEvidenceItem } from "../src/lib/disputeData";

/**
 * Evidence checklist accordion + Evidence Detail drawer (seller feedback on the flat-list
 * evidence UI: "richer case-file style hierarchy," a right-side detail drawer, edit-when-active/
 * read-only-when-resolved). Drives the real store (ChatStoreProvider) rather than passing a
 * static evidenceItems array, so an edit made through the drawer is verified as a real state
 * change, not just a prop the click can't affect.
 */

function mockLightboxApis() {
  Object.defineProperty(HTMLMediaElement.prototype, "play", { value: vi.fn(), configurable: true });
  if (!URL.createObjectURL) Object.defineProperty(URL, "createObjectURL", { value: vi.fn(() => "blob:mock"), configurable: true });
  if (!URL.revokeObjectURL) Object.defineProperty(URL, "revokeObjectURL", { value: vi.fn(), configurable: true });
}

function Harness({ disputeId, seedItem }: { disputeId: string; seedItem?: AIEvidenceItem }) {
  const { evidenceByDispute, addEvidenceItem } = useChatStore();
  useEffect(() => {
    if (seedItem) addEvidenceItem(disputeId, seedItem);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <DisputeDetail
      disputeId={disputeId}
      evidenceItems={evidenceByDispute[disputeId] ?? []}
      onAddEvidence={(item) => addEvidenceItem(disputeId, item)}
      onBack={vi.fn()}
      onInvestigate={vi.fn()}
    />
  );
}

const aiItem: AIEvidenceItem = {
  id: "acc-test-1",
  title: "Portal access log",
  record: "Two logins recorded after purchase.",
  sourceType: "activity",
  sourceLabel: "Fathom",
  category: "Access & activity records",
  addedBy: "ai",
  files: [
    { name: "log-1.pdf", type: "application/pdf", size: 1000, mockUrl: "mock://log-1.pdf" },
    { name: "log-2.png", type: "image/png", size: 2000, mockUrl: "mock://log-2.png" },
  ],
  verifiedByHuman: false,
};

describe("Evidence checklist accordion", () => {
  beforeEach(() => {
    mockLightboxApis();
    localStorage.clear();
  });
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it("starts every category collapsed, expands on click, and shows entries with metadata and attachment chips", () => {
    render(
      <ChatStoreProvider>
        <Harness disputeId="2481" seedItem={aiItem} />
      </ChatStoreProvider>,
    );

    // Collapsed: the entry's title isn't rendered anywhere yet.
    expect(screen.queryByText("Portal access log")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Access & activity records"));

    expect(screen.getByText("Portal access log")).toBeInTheDocument();
    expect(screen.getByText(/Fathom.*2 files/)).toBeInTheDocument();
    expect(screen.getByText("log-1.pdf")).toBeInTheDocument();
    expect(screen.getByText("log-2.png")).toBeInTheDocument();

    // Collapses back on a second click.
    fireEvent.click(screen.getByText("Access & activity records"));
    expect(screen.queryByText("Portal access log")).not.toBeInTheDocument();
  });

  it("clicking an entry opens the Evidence Detail modal with title, record, and attachments — never a 'Why it matters' section", () => {
    render(
      <ChatStoreProvider>
        <Harness disputeId="2481" seedItem={aiItem} />
      </ChatStoreProvider>,
    );

    fireEvent.click(screen.getByText("Access & activity records"));
    fireEvent.click(screen.getByText("Portal access log"));

    expect(screen.getByText("Evidence detail")).toBeInTheDocument();
    // Shows in both the accordion row's own record preview and the modal's Record section.
    expect(screen.getAllByText("Two logins recorded after purchase.").length).toBeGreaterThan(0);
    expect(screen.getAllByText("log-1.pdf").length).toBeGreaterThan(0);
    expect(screen.getAllByText("log-2.png").length).toBeGreaterThan(0);
    expect(screen.queryByText("Why it matters")).not.toBeInTheDocument();
  });

  it("editing title/description in the drawer persists through the real store and updates the accordion row", () => {
    render(
      <ChatStoreProvider>
        <Harness disputeId="2481" seedItem={aiItem} />
      </ChatStoreProvider>,
    );

    fireEvent.click(screen.getByText("Access & activity records"));
    fireEvent.click(screen.getByText("Portal access log"));
    fireEvent.click(screen.getByText("Edit"));

    const titleInput = screen.getByDisplayValue("Portal access log");
    fireEvent.change(titleInput, { target: { value: "Portal access log (Aug 3-8)" } });
    fireEvent.click(screen.getByText("Save"));

    // The drawer closes edit mode and reflects the new title; the accordion row (still visible
    // behind the drawer) does too, since both read the same live store state.
    expect(screen.getAllByText("Portal access log (Aug 3-8)").length).toBeGreaterThan(0);
    expect(screen.queryByText("Portal access log")).not.toBeInTheDocument();
  });

  it("marking an item reviewed from the drawer is reflected live, without needing to reopen it", () => {
    render(
      <ChatStoreProvider>
        <Harness disputeId="2481" seedItem={aiItem} />
      </ChatStoreProvider>,
    );

    fireEvent.click(screen.getByText("Access & activity records"));
    fireEvent.click(screen.getByText("Portal access log"));
    // "AI found" shows on both the accordion row (still visible behind the drawer) and the
    // drawer's own header badge.
    expect(screen.getAllByText("AI found").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByText("Mark as reviewed"));

    expect(screen.getAllByText("Reviewed").length).toBeGreaterThan(0);
    expect(screen.queryByText("AI found")).not.toBeInTheDocument();
    // Reviewed items no longer offer "Mark as reviewed" again.
    expect(screen.queryByText("Mark as reviewed")).not.toBeInTheDocument();
  });

  it("a resolved dispute shows evidence read-only: no Add evidence, no Edit, no Mark as reviewed", () => {
    // #2390 (Priya Nair) is seeded as a resolved ("Won") case with real seedEvidenceItems.
    render(
      <ChatStoreProvider>
        <Harness disputeId="2390" />
      </ChatStoreProvider>,
    );

    expect(screen.queryByText("Add evidence")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Access & activity records"));
    const entry = screen.getByText("Portal login history");
    fireEvent.click(entry);

    expect(screen.getByText("Evidence detail")).toBeInTheDocument();
    expect(screen.queryByText("Edit")).not.toBeInTheDocument();
    expect(screen.queryByText("Mark as reviewed")).not.toBeInTheDocument();
  });
});
