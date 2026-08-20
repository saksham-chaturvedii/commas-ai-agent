/**
 * Dispute domain data, ported from commas-ai-copilot's audited mock dataset (August 2026
 * story: Sarah Johnson, Dispute #2481, $499 Pro Coaching Program, "Product not received").
 * The chat mock engine (mockEngine.ts) tells the same story — keep them consistent.
 */

export const dispute = {
  id: "2481",
  reason: "Product not received",
  status: "Needs response" as const,
  amount: "$499.00",
  purchasedAt: "August 2, 2026 at 14:32 UTC",
  openedAt: "August 9, 2026",
  evidenceDueAt: "August 13, 2026",
  evidenceDueLabel: "Due tomorrow",
  customer: {
    name: "Sarah Johnson",
    email: "sarah.johnson@email.com",
    initials: "SJ",
  },
  product: {
    name: "Pro Coaching Program",
    transactionId: "txn_8b3f2a1c9d",
  },
};

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
