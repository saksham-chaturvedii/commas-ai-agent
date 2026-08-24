import { useEffect, useState } from "react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ChatStoreProvider, useChatStore } from "../src/hooks/useChatStore";
import { ChatWorkspace } from "../src/components/chat/ChatWorkspace";
import { DisputeDetail } from "../src/components/resolution/DisputeDetail";
import { isThirdPartyEvidenceSource } from "../src/lib/mockData";
import type { Chat } from "../src/lib/types";

describe("isThirdPartyEvidenceSource", () => {
  it("treats every connected third-party app as requiring proof", () => {
    expect(isThirdPartyEvidenceSource("Fathom")).toBe(true);
    expect(isThirdPartyEvidenceSource("Gmail")).toBe(true);
    expect(isThirdPartyEvidenceSource("Zoom")).toBe(true);
    expect(isThirdPartyEvidenceSource("GoHighLevel")).toBe(true);
    expect(isThirdPartyEvidenceSource("Google Calendar")).toBe(true);
  });

  it("exempts Commas-native evidence and the seller's own manual entries", () => {
    expect(isThirdPartyEvidenceSource("Commas")).toBe(false);
    expect(isThirdPartyEvidenceSource("Commas — Transaction history")).toBe(false);
    expect(isThirdPartyEvidenceSource("Added by you → Product description")).toBe(false);
  });
});

/**
 * Third-party evidence must require actual proof before it counts as fully added (seller
 * feedback): evidence the AI finds in Fathom/Gmail/Zoom/GoHighLevel is only a claim about
 * something outside Commas, so the seller must attach their own supporting file before it's
 * real evidence in the case. Native Commas evidence is exempt — the record already exists in
 * the system of record.
 *
 * Drives the REAL end-to-end pipeline: a mocked /api/agent/run response proposes evidence via
 * ChatWorkspace (exactly like ProposedActions.test.tsx), approving it lands in the real
 * evidenceByDispute store, and DisputeDetail — rendered from that same store — is where the
 * proof-upload/confirm/remove interactions actually happen. Nothing here is a synthetic prop;
 * every state transition is the one a seller would actually trigger.
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

function mockFetchOnce(body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => body });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function sendAndAwait(text: string) {
  fireEvent.change(screen.getByPlaceholderText("Ask about your business…"), { target: { value: text } });
  fireEvent.keyDown(screen.getByPlaceholderText("Ask about your business…"), { key: "Enter" });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2000);
  });
}

/** Renders both the dispute chat (to drive propose -> approve) and the Resolution Center's own
 * DisputeDetail (to drive the resulting checklist item) side by side, off the exact same store —
 * mirrors how a seller actually moves between the AI panel and the case page. */
function CombinedHarness({ disputeId = "2481" }: { disputeId?: string }) {
  const { createChat, chats, evidenceByDispute, addEvidenceItem } = useChatStore();
  const [chatId, setChatId] = useState<string | null>(null);
  useEffect(() => {
    setChatId(createChat({ kind: "dispute", id: disputeId, label: `Dispute #${disputeId}` }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const chat = chats.find((c: Chat) => c.id === chatId);
  return (
    <div>
      {chat && <ChatWorkspace chat={chat} />}
      <DisputeDetail
        disputeId={disputeId}
        evidenceItems={evidenceByDispute[disputeId] ?? []}
        onAddEvidence={(item) => addEvidenceItem(disputeId, item)}
        onBack={vi.fn()}
        onInvestigate={vi.fn()}
      />
    </div>
  );
}

function proposeAndApprove(items: Record<string, unknown>[]) {
  mockFetchOnce({
    steps: [],
    answer: "I found some evidence.",
    toolSummary: [],
    proposedActions: [
      { id: "action-1", type: "add_evidence", disputeId: "2481", summary: "I found evidence.", status: "pending", items },
    ],
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  // jsdom doesn't implement Object URL APIs — stub them so file selection doesn't throw.
  if (!URL.createObjectURL) Object.defineProperty(URL, "createObjectURL", { value: vi.fn(() => "blob:mock"), configurable: true });
  if (!URL.revokeObjectURL) Object.defineProperty(URL, "revokeObjectURL", { value: vi.fn(), configurable: true });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("third-party evidence requires supporting proof", () => {
  it("scenario 1: a Gmail email is proposed, requires proof, and is only fully added once a screenshot is attached and confirmed", async () => {
    render(
      <ChatStoreProvider>
        <CombinedHarness />
      </ChatStoreProvider>,
    );

    proposeAndApprove([
      { category: "Customer communications", title: "Customer correspondence", record: "Email confirming access.", sourceType: "communication", sourceLabel: "Gmail" },
    ]);
    await sendAndAwait("find evidence for me");
    fireEvent.click(screen.getByText(/Add selected/));

    // Visible immediately in the checklist — "AI found" + a real signal proof is still needed —
    // but the category doesn't count it as Added yet.
    fireEvent.click(screen.getByText("Customer communications"));
    expect(screen.getByText("Customer correspondence")).toBeInTheDocument();
    expect(screen.getByText("Proof required")).toBeInTheDocument();
    expect(screen.getByText("0 of 6 items added")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Customer correspondence"));
    expect(screen.getByText("Supporting proof required")).toBeInTheDocument();
    expect(screen.getByText(/found in Gmail, an external app/)).toBeInTheDocument();
    // Nothing to confirm yet.
    expect(screen.getByText("Confirm evidence")).toHaveProperty("disabled", true);

    selectFiles([makeFile("gmail-screenshot.png", 2048, "image/png")]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1200);
    });
    expect(screen.getByText("Confirm evidence")).toHaveProperty("disabled", false);

    fireEvent.click(screen.getByText("Confirm evidence"));

    // Now fully added: the proof-required badge and upload UI are gone, replaced by the normal
    // attachments view, and the category counts it.
    expect(screen.queryByText("Proof required")).not.toBeInTheDocument();
    expect(screen.getAllByText("gmail-screenshot.png").length).toBeGreaterThan(0);
    expect(screen.getByText("1 of 6 items added")).toBeInTheDocument();
  });

  it("scenario 2: a Fathom call is proposed, requires proof, and is confirmed the same way", async () => {
    render(
      <ChatStoreProvider>
        <CombinedHarness />
      </ChatStoreProvider>,
    );

    proposeAndApprove([
      { category: "Access & activity records", title: "Fathom call — 42-minute session", record: "Onboarding call.", sourceType: "activity", sourceLabel: "Fathom" },
    ]);
    await sendAndAwait("find evidence for me");
    fireEvent.click(screen.getByText(/Add selected/));

    fireEvent.click(screen.getByText("Access & activity records"));
    expect(screen.getByText("Proof required")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Fathom call — 42-minute session"));
    expect(screen.getByText(/found in Fathom, an external app/)).toBeInTheDocument();

    selectFiles([makeFile("call-recording-screenshot.png", 3000, "image/png")]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1200);
    });
    fireEvent.click(screen.getByText("Confirm evidence"));

    expect(screen.getByText("1 of 6 items added")).toBeInTheDocument();
  });

  it("scenario 3: native Commas transaction data is added without requiring a proof upload", async () => {
    render(
      <ChatStoreProvider>
        <CombinedHarness />
      </ChatStoreProvider>,
    );

    proposeAndApprove([
      { category: "Transaction & payment details", title: "Transaction record", record: "$499.00 charge succeeded.", sourceType: "transaction", sourceLabel: "Commas" },
    ]);
    await sendAndAwait("find evidence for me");
    fireEvent.click(screen.getByText(/Add selected/));

    // Commas-sourced evidence counts as fully added immediately — no proof gate.
    expect(screen.getByText("1 of 6 items added")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Transaction & payment details"));
    expect(screen.queryByText("Proof required")).not.toBeInTheDocument();
    expect(screen.getByText("Transaction record")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Transaction record"));
    expect(screen.queryByText("Supporting proof required")).not.toBeInTheDocument();
    expect(screen.getByText("Attachments")).toBeInTheDocument();
  });

  it("scenario 4: confirming third-party evidence with no proof attached is prevented, with a clear explanation of what's missing", async () => {
    render(
      <ChatStoreProvider>
        <CombinedHarness />
      </ChatStoreProvider>,
    );

    proposeAndApprove([
      { category: "Customer communications", title: "Customer correspondence", record: "Email confirming access.", sourceType: "communication", sourceLabel: "Gmail" },
    ]);
    await sendAndAwait("find evidence for me");
    fireEvent.click(screen.getByText(/Add selected/));

    fireEvent.click(screen.getByText("Customer communications"));
    fireEvent.click(screen.getByText("Customer correspondence"));

    const confirmButton = screen.getByText("Confirm evidence");
    expect(confirmButton).toHaveProperty("disabled", true);
    fireEvent.click(confirmButton);

    // Still not added — clicking a disabled button is a no-op, and the explanation is visible.
    expect(screen.getByText(/attach a screenshot or file from it before this counts as/)).toBeInTheDocument();
    expect(screen.getByText("0 of 6 items added")).toBeInTheDocument();
  });

  it("scenario 5: multiple proof files attached to one item all remain visible and usable after confirmation", async () => {
    render(
      <ChatStoreProvider>
        <CombinedHarness />
      </ChatStoreProvider>,
    );

    proposeAndApprove([
      { category: "Access & activity records", title: "Zoom attendance", record: "Attended the live session.", sourceType: "activity", sourceLabel: "Zoom" },
    ]);
    await sendAndAwait("find evidence for me");
    fireEvent.click(screen.getByText(/Add selected/));

    fireEvent.click(screen.getByText("Access & activity records"));
    fireEvent.click(screen.getByText("Zoom attendance"));

    selectFiles([makeFile("zoom-screenshot-1.png", 1500, "image/png"), makeFile("zoom-invite.pdf", 4000, "application/pdf")]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1200);
    });
    fireEvent.click(screen.getByText("Confirm evidence"));

    // Both files present, both usable (rendered as clickable attachment chips) after confirming.
    expect(screen.getAllByText("zoom-screenshot-1.png").length).toBeGreaterThan(0);
    expect(screen.getAllByText("zoom-invite.pdf").length).toBeGreaterThan(0);
    expect(screen.getByText("Attachments (2)")).toBeInTheDocument();

    // Close and reopen the entry — both attachments are still there on the confirmed item.
    fireEvent.click(screen.getByLabelText("Close"));
    fireEvent.click(screen.getByText("Zoom attendance"));
    expect(screen.getByText("Attachments (2)")).toBeInTheDocument();
  });

  it("scenario 6: the evidence detail view never shows a 'Why it matters' section, for any evidence type", async () => {
    render(
      <ChatStoreProvider>
        <CombinedHarness />
      </ChatStoreProvider>,
    );

    proposeAndApprove([
      { category: "Transaction & payment details", title: "Transaction record", record: "$499.00 charge succeeded.", sourceType: "transaction", sourceLabel: "Commas" },
      { category: "Customer communications", title: "Customer correspondence", record: "Email confirming access.", sourceType: "communication", sourceLabel: "Gmail" },
    ]);
    await sendAndAwait("find evidence for me");
    fireEvent.click(screen.getByText(/Add selected/));

    fireEvent.click(screen.getByText("Transaction & payment details"));
    fireEvent.click(screen.getByText("Transaction record"));
    expect(screen.queryByText("Why it matters")).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Close"));

    fireEvent.click(screen.getByText("Customer communications"));
    fireEvent.click(screen.getByText("Customer correspondence"));
    expect(screen.queryByText("Why it matters")).not.toBeInTheDocument();
  });
});

describe("removing added evidence", () => {
  it("removing the last item in a category reverts it from Added to Not added and updates the count", async () => {
    render(
      <ChatStoreProvider>
        <CombinedHarness />
      </ChatStoreProvider>,
    );

    proposeAndApprove([
      { category: "Transaction & payment details", title: "Transaction record", record: "$499.00 charge succeeded.", sourceType: "transaction", sourceLabel: "Commas" },
    ]);
    await sendAndAwait("find evidence for me");
    fireEvent.click(screen.getByText(/Add selected/));
    expect(screen.getByText("1 of 6 items added")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Transaction & payment details"));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.click(screen.getByLabelText("Remove Transaction record"));

    expect(screen.getByText("0 of 6 items added")).toBeInTheDocument();
    expect(screen.queryByText("Transaction record")).not.toBeInTheDocument();
  });

  it("removing one entry from a category with multiple entries keeps the category Added and keeps the other entry", async () => {
    render(
      <ChatStoreProvider>
        <CombinedHarness />
      </ChatStoreProvider>,
    );

    proposeAndApprove([
      { category: "Access & activity records", title: "Fathom call", record: "Onboarding call.", sourceType: "activity", sourceLabel: "Commas" },
      { category: "Access & activity records", title: "Zoom attendance", record: "Attended the live session.", sourceType: "activity", sourceLabel: "Commas" },
    ]);
    await sendAndAwait("find evidence for me");
    fireEvent.click(screen.getByText(/Add selected/));

    fireEvent.click(screen.getByText("Access & activity records"));
    expect(screen.getByText("1 of 6 items added")).toBeInTheDocument();

    vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.click(screen.getByLabelText("Remove Fathom call"));

    expect(screen.queryByText("Fathom call")).not.toBeInTheDocument();
    expect(screen.getByText("Zoom attendance")).toBeInTheDocument();
    // Still Added — the other entry in the category survived.
    expect(screen.getByText("1 of 6 items added")).toBeInTheDocument();
  });

  it("a removal is cancelled if the confirmation is declined", async () => {
    render(
      <ChatStoreProvider>
        <CombinedHarness />
      </ChatStoreProvider>,
    );

    proposeAndApprove([
      { category: "Transaction & payment details", title: "Transaction record", record: "$499.00 charge succeeded.", sourceType: "transaction", sourceLabel: "Commas" },
    ]);
    await sendAndAwait("find evidence for me");
    fireEvent.click(screen.getByText(/Add selected/));

    fireEvent.click(screen.getByText("Transaction & payment details"));
    vi.spyOn(window, "confirm").mockReturnValue(false);
    fireEvent.click(screen.getByLabelText("Remove Transaction record"));

    expect(screen.getByText("Transaction record")).toBeInTheDocument();
    expect(screen.getByText("1 of 6 items added")).toBeInTheDocument();
  });
});
