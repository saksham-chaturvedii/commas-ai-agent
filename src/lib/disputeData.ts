/**
 * Dispute domain data — 5 mock cases demonstrating distinct Agent workflows (Resolution
 * Center demo-readiness pass, 2026-08-21). Case #2481 (Sarah Johnson) is the original story
 * ported from commas-ai-copilot; #2502/#2417/#2455/#2390 are new. Each case's deeper
 * agent-reasoning facts (likely reason, evidence gaps, draft text, recommendation) live in
 * server/mcp/mockCommasServer.ts's DISPUTES record, fetched via the commas_get_dispute tool —
 * this file only holds what the Resolution Center UI itself renders, kept in sync by hand
 * (same ids, amounts, reasons, dates) with the backend record for each case.
 */

export type DisputeStatus = "Needs response" | "Won";

export interface DisputeCase {
  id: string;
  reason: string;
  /** Machine-readable reason code, mirrored in server/mcp/mockCommasServer.ts's DISPUTES
   * record and used to build PageContext.dispute for the AI panel. */
  reasonCode: string;
  status: DisputeStatus;
  amount: string;
  purchasedAt: string;
  openedAt: string;
  evidenceDueAt: string;
  evidenceDueLabel: string;
  /** Coarse evidence-readiness signal surfaced to the agent via PageContext (not the manual
   * checklist state below) — "ready" for Evidence Ready/Won, "not_started"/"in_progress"
   * otherwise. */
  evidenceStatus: "not_started" | "in_progress" | "ready";
  customer: {
    name: string;
    email: string;
    initials: string;
  };
  product: {
    name: string;
    transactionId: string;
  };
  /** Which evidence checklist categories are pre-marked "Added" for this case, so switching
   * disputes feels like a real product with real progress — not a static, identical screenshot
   * for every row. Purely a UI seed; unrelated to the agent's own evidence-gap reasoning. */
  initialEvidenceAdded: string[];
  /** Pre-seeded, itemized evidence (title/description/attachments) shown for cases where the
   * Resolution Center needs to demonstrate a fully-evidenced historical record — currently
   * only Priya Nair's resolved case. Session-added evidence (via "Add evidence") is appended
   * alongside these in App.tsx's evidenceByDispute state; this array is just the starting
   * point. Empty for cases with no rich seed data — those cases only show the plain
   * Added/Not-added badges driven by initialEvidenceAdded above. */
  seedEvidenceItems: AIEvidenceItem[];
  /** Only set once a dispute is resolved (status !== "Needs response") — the response the
   * seller actually submitted, shown read-only instead of the editable draft textarea. */
  submittedResponse?: { text: string; submittedAt: string };
}

export const DISPUTES: DisputeCase[] = [
  {
    id: "2481",
    reason: "Product not received",
    reasonCode: "product_not_received",
    status: "Needs response",
    amount: "$499.00",
    purchasedAt: "August 2, 2026 at 14:32 UTC",
    openedAt: "August 9, 2026",
    evidenceDueAt: "August 23, 2026",
    evidenceDueLabel: "Due in 2 days",
    evidenceStatus: "not_started",
    customer: { name: "Sarah Johnson", email: "sarah.johnson@email.com", initials: "SJ" },
    product: { name: "Pro Coaching Program", transactionId: "txn_8b3f2a1c9d" },
    initialEvidenceAdded: [],
    seedEvidenceItems: [],
  },
  {
    id: "2502",
    reason: "Product unacceptable",
    reasonCode: "product_unacceptable",
    status: "Needs response",
    amount: "$129.00",
    purchasedAt: "August 12, 2026 at 09:10 UTC",
    openedAt: "August 15, 2026",
    evidenceDueAt: "August 29, 2026",
    evidenceDueLabel: "Due in 8 days",
    evidenceStatus: "not_started",
    customer: { name: "Marcus Webb", email: "marcus.webb@email.com", initials: "MW" },
    product: { name: "1:1 Strategy Call", transactionId: "txn_7c91fe22ab" },
    initialEvidenceAdded: ["Transaction & payment details"],
    seedEvidenceItems: [],
  },
  {
    id: "2417",
    reason: "Duplicate charge",
    reasonCode: "duplicate",
    status: "Needs response",
    amount: "$899.00",
    purchasedAt: "August 8, 2026 at 11:47 UTC",
    openedAt: "August 11, 2026",
    evidenceDueAt: "August 25, 2026",
    evidenceDueLabel: "Due in 4 days",
    evidenceStatus: "ready",
    customer: { name: "Elena Cruz", email: "elena.cruz@email.com", initials: "EC" },
    product: { name: "Elite Mentorship Package", transactionId: "txn_5a2d81ffec" },
    initialEvidenceAdded: [
      "Transaction & payment details",
      "Customer & account information",
      "Access & activity records",
      "Product description & offer details",
      "Terms & refund policy",
      "Customer communications",
    ],
    // Evidence-ready showcase: the checklist isn't just green badges — the items themselves
    // are on file and inspectable, same as the resolved case (audit P1-7).
    seedEvidenceItems: [
      {
        id: "seed-2417-1",
        title: "Duplicate charge records",
        record:
          "Both charges for the Elite Mentorship Package on August 8, 2026 — txn_5a2d81ffec and its duplicate, " +
          "9 seconds apart, same cart and payment method.",
        sourceType: "transaction",
        sourceLabel: "Commas — Transaction history",
        addedBy: "seller",
        category: "Transaction & payment details",
        files: [
          { name: "charge-1-receipt.pdf", type: "application/pdf", size: 58_400, mockUrl: "mock://evidence/seed/charge-1-receipt.pdf" },
          { name: "charge-2-receipt.pdf", type: "application/pdf", size: 58_900, mockUrl: "mock://evidence/seed/charge-2-receipt.pdf" },
        ],
      },
      {
        id: "seed-2417-2",
        title: "Checkout retry log",
        record: "Server log showing the payment form was resubmitted after a timeout at 11:47:02, producing the second charge.",
        sourceType: "activity",
        sourceLabel: "Commas — Checkout logs",
        addedBy: "seller",
        category: "Access & activity records",
        files: [{ name: "checkout-retry-log.pdf", type: "application/pdf", size: 41_200, mockUrl: "mock://evidence/seed/checkout-retry-log.pdf" }],
      },
      {
        id: "seed-2417-3",
        title: "Elena's support email",
        record: "Elena's own August 10 email flagging the double charge, with both receipts attached — sent before she filed the dispute.",
        sourceType: "communication",
        sourceLabel: "Added by you — Customer communications",
        addedBy: "seller",
        category: "Customer communications",
        files: [{ name: "elena-support-email.pdf", type: "application/pdf", size: 33_700, mockUrl: "mock://evidence/seed/elena-support-email.pdf" }],
      },
    ],
  },
  {
    id: "2455",
    reason: "Product not received",
    reasonCode: "product_not_received",
    status: "Needs response",
    amount: "$249.00",
    purchasedAt: "August 14, 2026 at 18:05 UTC",
    openedAt: "August 17, 2026",
    evidenceDueAt: "August 31, 2026",
    evidenceDueLabel: "Due in 10 days",
    evidenceStatus: "in_progress",
    customer: { name: "David Kim", email: "david.kim@email.com", initials: "DK" },
    product: { name: "Growth Accelerator Course", transactionId: "txn_3f7b90c114" },
    initialEvidenceAdded: ["Transaction & payment details"],
    // Deliberately sparse — one transaction receipt and nothing else, matching this case's
    // "inconclusive evidence" story (audit P1-7).
    seedEvidenceItems: [
      {
        id: "seed-2455-1",
        title: "Transaction receipt",
        record: "Confirms the $249.00 charge for the Growth Accelerator Course succeeded on August 14, 2026.",
        sourceType: "transaction",
        sourceLabel: "Commas — Transaction history",
        addedBy: "seller",
        category: "Transaction & payment details",
        files: [{ name: "transaction-receipt.pdf", type: "application/pdf", size: 55_100, mockUrl: "mock://evidence/seed/kim-transaction-receipt.pdf" }],
      },
    ],
  },
  {
    id: "2390",
    reason: "Product not received",
    reasonCode: "product_not_received",
    status: "Won",
    amount: "$349.00",
    purchasedAt: "July 30, 2026 at 10:22 UTC",
    openedAt: "August 3, 2026",
    evidenceDueAt: "August 17, 2026",
    evidenceDueLabel: "Resolved",
    evidenceStatus: "ready",
    customer: { name: "Priya Nair", email: "priya.nair@email.com", initials: "PN" },
    product: { name: "Pro Coaching Program", transactionId: "txn_9d4c22ab77" },
    initialEvidenceAdded: [
      "Transaction & payment details",
      "Customer & account information",
      "Access & activity records",
      "Product description & offer details",
      "Terms & refund policy",
      "Customer communications",
    ],
    seedEvidenceItems: [
      {
        id: "seed-2390-1",
        title: "Original transaction record",
        record: "Confirms the $349.00 charge for the Pro Coaching Program succeeded on July 30, 2026.",
        sourceType: "transaction",
        sourceLabel: "Commas — Transaction history",
        addedBy: "seller",
        category: "Transaction & payment details",
        files: [
          { name: "transaction-receipt.pdf", type: "application/pdf", size: 61_200, mockUrl: "mock://evidence/seed/transaction-receipt.pdf" },
        ],
      },
      {
        id: "seed-2390-2",
        title: "Portal login history",
        record: "18 logins recorded between August 3–8, 2026, showing consistent engagement with course content after purchase.",
        sourceType: "activity",
        sourceLabel: "Commas — Access records",
        addedBy: "seller",
        category: "Access & activity records",
        files: [
          { name: "login-history.pdf", type: "application/pdf", size: 84_500, mockUrl: "mock://evidence/seed/login-history.pdf" },
        ],
      },
      {
        id: "seed-2390-3",
        title: "Onboarding call attendance",
        record: "Signed attendance record and a screenshot confirming Priya joined and participated in the August 4 onboarding call.",
        sourceType: "communication",
        sourceLabel: "Added by you — Customer communications",
        addedBy: "seller",
        category: "Customer communications",
        files: [
          {
            name: "call-attendance-signed.pdf",
            type: "application/pdf",
            size: 47_800,
            mockUrl: "mock://evidence/seed/call-attendance-signed.pdf",
          },
          {
            name: "attendance-screenshot.png",
            type: "image/png",
            size: 212_300,
            mockUrl: mockImageDataUri("attendance-screenshot.png"),
          },
        ],
      },
      {
        id: "seed-2390-4",
        title: "Program listing at time of purchase",
        record: "Screenshot of the Pro Coaching Program offer page as shown to Priya at checkout on July 30, 2026.",
        sourceType: "product",
        sourceLabel: "Added by you — Product description",
        addedBy: "seller",
        category: "Product description & offer details",
        files: [
          { name: "listing-screenshot.png", type: "image/png", size: 168_900, mockUrl: mockImageDataUri("listing-screenshot.png") },
        ],
      },
    ],
    submittedResponse: {
      text:
        "Priya Nair engaged extensively with the Pro Coaching Program after purchase — 18 portal logins between " +
        "August 3–8 and confirmed attendance at the August 4 onboarding call. This usage pattern directly " +
        "contradicts a \"product not received\" claim. We're submitting the attached login history and signed " +
        "attendance record as evidence of delivery and engagement, alongside the original transaction record and " +
        "the product listing shown at time of purchase.",
      submittedAt: "August 8, 2026",
    },
  },
];

/** Inline SVG placeholder used as the mockUrl for pre-seeded image evidence (no real file
 * bytes exist for historical/seed data — see docs/active-context.md's Evidence File Upload
 * limitations). Honestly labeled as a mock, still a real, clickable/previewable image. */
function mockImageDataUri(label: string): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="320">` +
    `<rect width="480" height="320" fill="#e5e7eb"/>` +
    `<text x="50%" y="46%" font-family="sans-serif" font-size="15" fill="#6b7280" text-anchor="middle">Mock evidence preview</text>` +
    `<text x="50%" y="56%" font-family="sans-serif" font-size="13" fill="#9ca3af" text-anchor="middle">${label}</text>` +
    `</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export function getDispute(id: string): DisputeCase | undefined {
  return DISPUTES.find((d) => d.id === id);
}

/** Workspace-level summary for GLOBAL chat's agent context (docs/AI_ASSISTANT_ARCHITECTURE.md
 * §5) — e.g. "Show me disputes that need attention." Deliberately a thin projection (no
 * agent-reasoning fields) of the same DISPUTES this file already exports for the Resolution
 * Center list, not a separate dataset. */
export function disputesNeedingAttention(): {
  disputeId: string;
  customerName: string;
  reason: string;
  amountCents: number;
  evidenceDueAt: string;
}[] {
  return DISPUTES.filter((d) => d.status === "Needs response").map((d) => ({
    disputeId: d.id,
    customerName: d.customer.name,
    reason: d.reason,
    amountCents: Math.round(parseFloat(d.amount.replace(/[^0-9.]/g, "")) * 100),
    evidenceDueAt: d.evidenceDueAt,
  }));
}

export type EvidenceSourceType =
  | "transaction"
  | "activity"
  | "product"
  | "terms"
  | "communication"
  | "manual";

/** Mocked file metadata attached to a seller-submitted evidence item — no real upload/storage,
 * see src/lib/evidenceUpload.ts. `mockUrl` is an object URL for images (revoked once the file
 * list unmounts) or a synthetic `mock://` reference for other file types. */
export interface EvidenceFileMeta {
  name: string;
  type: string;
  size: number;
  mockUrl: string;
}

export type AIEvidenceItem = {
  id: string;
  title: string;
  record: string;
  sourceType: EvidenceSourceType;
  sourceLabel: string;
  sourceAnchor?: string;
  addedBy: "ai" | "seller";
  /** Which evidence checklist category (evidenceCategories[].label) this item belongs to —
   * lets the Resolution Center group/display session-added items per row without a redesign. */
  category: string;
  files: EvidenceFileMeta[];
  /** True only once a human has explicitly clicked "Mark as verified" on this specific item
   * (DisputeDetail.tsx) — never set automatically, and never implied just because the seller
   * approved adding it to the case (approving is "use this," not "I've checked it's accurate").
   * Undefined/false render identically ("AI found" — unverified); only `addedBy === "ai"` items
   * show either badge at all, since a seller-uploaded item was never an AI claim to verify. */
  verifiedByHuman?: boolean;
  /** True when this item was sourced from a third-party connected app (Fathom, Gmail, Zoom,
   * GoHighLevel/CRM, …) rather than Commas' own first-party record — such evidence needs the
   * seller's own supporting proof before it counts as fully added, since the seller is relying
   * on external information rather than a record the system already holds. Never set for
   * Commas-sourced AI evidence or seller-added manual items (both already have — or ARE — their
   * own proof). Set once, at creation (useChatStore's `resolveProposedAction`); never changes. */
  proofRequired?: boolean;
  /** Set once the seller has attached at least one proof file and explicitly confirmed. Always
   * true for items where `proofRequired` is falsy (nothing to confirm). While `proofRequired &&
   * !proofConfirmed`, the item is "AI found — proof required": visible in the checklist, but not
   * counted toward a category's "Added" state until confirmed. */
  proofConfirmed?: boolean;
};

export const evidenceCategories = [
  {
    label: "Transaction & payment details",
    description: "Purchase confirmation, checkout details, payment method",
  },
  {
    label: "Customer & account information",
    description: "Customer identity, account creation, contact details",
  },
  {
    label: "Access & activity records",
    description: "Login history, course access, session activity",
  },
  {
    label: "Product description & offer details",
    description: "Listing shown at time of purchase",
  },
  {
    label: "Terms & refund policy",
    description: "Policy version and acceptance record",
  },
  {
    label: "Customer communications",
    description: "Support tickets, emails, chat history",
  },
];
