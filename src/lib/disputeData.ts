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
    evidenceDueAt: "August 13, 2026",
    evidenceDueLabel: "Due tomorrow",
    evidenceStatus: "not_started",
    customer: { name: "Sarah Johnson", email: "sarah.johnson@email.com", initials: "SJ" },
    product: { name: "Pro Coaching Program", transactionId: "txn_8b3f2a1c9d" },
    initialEvidenceAdded: [],
  },
  {
    id: "2502",
    reason: "Product unacceptable",
    reasonCode: "product_unacceptable",
    status: "Needs response",
    amount: "$129.00",
    purchasedAt: "August 12, 2026 at 09:10 UTC",
    openedAt: "August 15, 2026",
    evidenceDueAt: "August 22, 2026",
    evidenceDueLabel: "Due in 1 day",
    evidenceStatus: "not_started",
    customer: { name: "Marcus Webb", email: "marcus.webb@email.com", initials: "MW" },
    product: { name: "1:1 Strategy Call", transactionId: "txn_7c91fe22ab" },
    initialEvidenceAdded: ["Transaction & payment details"],
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
  },
  {
    id: "2455",
    reason: "Product not received",
    reasonCode: "product_not_received",
    status: "Needs response",
    amount: "$249.00",
    purchasedAt: "August 14, 2026 at 18:05 UTC",
    openedAt: "August 17, 2026",
    evidenceDueAt: "August 24, 2026",
    evidenceDueLabel: "Due in 3 days",
    evidenceStatus: "in_progress",
    customer: { name: "David Kim", email: "david.kim@email.com", initials: "DK" },
    product: { name: "Growth Accelerator Course", transactionId: "txn_3f7b90c114" },
    initialEvidenceAdded: ["Transaction & payment details"],
  },
  {
    id: "2390",
    reason: "Product not received",
    reasonCode: "product_not_received",
    status: "Won",
    amount: "$349.00",
    purchasedAt: "July 30, 2026 at 10:22 UTC",
    openedAt: "August 3, 2026",
    evidenceDueAt: "August 7, 2026",
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
  },
];

export function getDispute(id: string): DisputeCase | undefined {
  return DISPUTES.find((d) => d.id === id);
}

export type EvidenceSourceType =
  | "transaction"
  | "activity"
  | "product"
  | "terms"
  | "communication"
  | "manual";

export type AIEvidenceItem = {
  id: string;
  title: string;
  record: string;
  why: string;
  sourceType: EvidenceSourceType;
  sourceLabel: string;
  sourceAnchor?: string;
  addedBy: "ai" | "seller";
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
