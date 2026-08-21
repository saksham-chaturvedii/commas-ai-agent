import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

/**
 * In-process mock Commas MCP server — a real MCP server (real protocol, real tool
 * definitions), backed by mock data instead of a live Commas account. This is the "local
 * development option" for the Commas MCP connection: commasdocs.com confirms a real remote
 * MCP server exists (Streamable HTTP, x-api-key auth — see server/mcp/client.ts's "real mode"
 * for that path) but no credentials for it are available in this environment, so this mock
 * stands in, matching the documented tool names/purpose (docs/active-context.md §Integrations).
 *
 * Data mirrors src/lib/disputeData.ts — 5 demo dispute cases (Sarah Johnson #2481, Marcus Webb
 * #2502, Elena Cruz #2417, David Kim #2455, Priya Nair #2390), one per Agent workflow
 * (docs/active-context.md — "Resolution Center Demo-Readiness") — kept in sync by hand.
 *
 * Tool set is deliberately small per the task's scope: customers, transactions, and the
 * disputes in this prototype's scenario. `commas_get_dispute` and `commas_mark_dispute_
 * response_ready` are namespaced `commas_` (not `fanbasis_`) because the real Commas platform
 * has no disputes API/evidence-submission API at all — confirmed gap, documented in
 * docs/active-context.md. `commas_mark_dispute_response_ready` is classified "write" in the
 * tool registry (server/agent/registry.ts) and therefore always pauses for seller approval
 * before running (server/agent/runtime.ts) — it never auto-executes, and it only ever flips a
 * mock in-memory flag; nothing is submitted anywhere real.
 */

interface MockCustomer {
  id: string;
  name: string;
  email: string;
}

interface MockTransaction {
  id: string;
  customerEmail: string;
  product: string;
  amountCents: number;
  status: string;
  purchasedAt: string;
}

interface MockDispute {
  id: string;
  status: string;
  reason: string;
  amountCents: number;
  customerName: string;
  customerEmail: string;
  productName: string;
  openedAt: string;
  evidenceDueAt: string;
  responseStatus: "not_started" | "in_progress" | "ready";
  /** Which of the 5 demo workflows this case demonstrates (docs/active-context.md —
   * "Resolution Center Demo-Readiness"). Drives which deterministic answer shape
   * server/llm/stubClient.ts produces for the why/evidence/draft/recommend/summarize intents —
   * purely a mock-reasoning label, not a real Commas field. */
  scenario: "needs_response" | "missing_evidence" | "evidence_ready" | "high_risk" | "resolved";
  likelyReason: string;
  evidenceCollected: string[];
  evidenceMissing: string[];
  recommendedAction: string;
  draftResponse: string;
  /** Only set for scenario "high_risk" — the agent must say this explicitly rather than
   * guessing a confident answer. */
  uncertaintyNote?: string;
  /** Only set for scenario "resolved". */
  resolutionOutcome?: string;
  /** Authored per-case summary of customer correspondence, used by the stub's
   * "review customer communications" intent (PRODUCT_READINESS_AUDIT.md P1-9). */
  communicationsSummary: string;
}

/** Month-level rollup returned by an UNFILTERED fanbasis_list_transactions call, so the
 * stub's sales-summary answer matches the Dashboard's numbers instead of contradicting them
 * (PRODUCT_READINESS_AUDIT.md P0-2). The per-customer TRANSACTIONS list below is a small
 * sample; this summary represents the full month the Dashboard displays. */
const MONTH_SUMMARY = {
  monthLabel: "August",
  totalCents: 1842000,
  transactionCount: 62,
  changePct: 12,
  topProducts: [
    { name: "Pro Coaching Program", totalCents: 980000 },
    { name: "1:1 Strategy Call", totalCents: 425000 },
  ],
  refunds: { count: 3, totalCents: 96000 },
  topDiscountCode: { code: "LAUNCH20", redemptions: 87 },
  openDisputes: { count: 4, totalCents: 177600, mostUrgentId: "2481" },
};

const CUSTOMERS: MockCustomer[] = [
  { id: "cus_sarahjohnson", name: "Sarah Johnson", email: "sarah.johnson@email.com" },
  { id: "cus_marcuswebb", name: "Marcus Webb", email: "marcus.webb@email.com" },
  { id: "cus_elenacruz", name: "Elena Cruz", email: "elena.cruz@email.com" },
  { id: "cus_davidkim", name: "David Kim", email: "david.kim@email.com" },
  { id: "cus_priyanair", name: "Priya Nair", email: "priya.nair@email.com" },
];

const TRANSACTIONS: MockTransaction[] = [
  {
    id: "txn_8b3f2a1c9d",
    customerEmail: "sarah.johnson@email.com",
    product: "Pro Coaching Program",
    amountCents: 49900,
    status: "succeeded",
    purchasedAt: "2026-08-02T14:32:00Z",
  },
  {
    id: "txn_7c91fe22ab",
    customerEmail: "marcus.webb@email.com",
    product: "1:1 Strategy Call",
    amountCents: 12900,
    status: "succeeded",
    purchasedAt: "2026-08-12T09:10:00Z",
  },
  {
    id: "txn_5a2d81ffec",
    customerEmail: "elena.cruz@email.com",
    product: "Elite Mentorship Package",
    amountCents: 89900,
    status: "succeeded",
    purchasedAt: "2026-08-08T11:47:00Z",
  },
  {
    id: "txn_3f7b90c114",
    customerEmail: "david.kim@email.com",
    product: "Growth Accelerator Course",
    amountCents: 24900,
    status: "succeeded",
    purchasedAt: "2026-08-14T18:05:00Z",
  },
  {
    id: "txn_9d4c22ab77",
    customerEmail: "priya.nair@email.com",
    product: "Pro Coaching Program",
    amountCents: 34900,
    status: "succeeded",
    purchasedAt: "2026-07-30T10:22:00Z",
  },
];

/**
 * 5 demo dispute cases, one per Agent workflow (docs/active-context.md — "Resolution Center
 * Demo-Readiness"). Ids/amounts/reasons/dates mirror src/lib/disputeData.ts by hand; the
 * agent-reasoning fields below (likelyReason, evidenceCollected/Missing, recommendedAction,
 * draftResponse, uncertaintyNote, resolutionOutcome) exist ONLY here — they're what
 * server/llm/stubClient.ts reads to answer "why/evidence/draft/recommend/summarize"
 * deterministically per case, never fabricated at answer time.
 */
const DISPUTES: MockDispute[] = [
  {
    id: "2481",
    status: "needs_response",
    reason: "product_not_received",
    amountCents: 49900,
    customerName: "Sarah Johnson",
    customerEmail: "sarah.johnson@email.com",
    productName: "Pro Coaching Program",
    openedAt: "2026-08-09T00:00:00Z",
    evidenceDueAt: "2026-08-23T00:00:00Z",
    responseStatus: "not_started",
    scenario: "needs_response",
    likelyReason:
      "Sarah engaged heavily with the product after purchase — 14 logins and 6 of 12 lessons completed, plus a " +
      "42-minute onboarding call on Fathom. That pattern points to a forgotten-purchase or friendly-fraud dispute " +
      "rather than genuine non-delivery.",
    evidenceCollected: [],
    evidenceMissing: ["Access & activity records", "Customer communications", "Transaction & payment details"],
    recommendedAction:
      "Add your access/activity records and transaction confirmation to the evidence checklist, then respond " +
      "before the Aug 13 deadline with proof Sarah received and used the product.",
    draftResponse:
      "The customer, Sarah Johnson, purchased the Pro Coaching Program on August 2, 2026. Our records show she " +
      "logged into the course portal 14 times and completed 6 of 12 lessons, and attended a 42-minute onboarding " +
      "call on August 4. This level of engagement is inconsistent with a claim of non-delivery — the product was " +
      "clearly delivered and actively used. We respectfully ask that this dispute be resolved in our favor.",
    communicationsSummary:
      "There's one Gmail thread with Sarah (\"Welcome to Pro Coaching Program\", Aug 2–3): she initially asked how " +
      "to access the program, support replied with the login link, and she confirmed \"Got it, thanks! I'm in now.\" " +
      "That written confirmation of access is strong evidence against her non-delivery claim — include it in your response.",
  },
  {
    id: "2502",
    status: "needs_response",
    reason: "product_unacceptable",
    amountCents: 12900,
    customerName: "Marcus Webb",
    customerEmail: "marcus.webb@email.com",
    productName: "1:1 Strategy Call",
    openedAt: "2026-08-15T00:00:00Z",
    evidenceDueAt: "2026-08-29T00:00:00Z",
    responseStatus: "not_started",
    scenario: "missing_evidence",
    likelyReason:
      "Marcus says the session didn't match what was advertised. We don't yet have the call recording or the " +
      "original offer page on file, so there's no way to confirm what was actually promised or delivered.",
    evidenceCollected: ["Transaction & payment details"],
    evidenceMissing: ["Product description & offer details", "Access & activity records", "Customer communications"],
    recommendedAction:
      "Collect the missing evidence before responding — without the offer page and a delivery record, a " +
      "response is unlikely to succeed. Start with the product listing shown at time of purchase.",
    draftResponse:
      "I don't have enough evidence on file yet to draft a strong response for this one. Add the product " +
      "description shown at checkout, the call/access record, and any support messages with Marcus — once " +
      "those are in, ask me to draft again and I'll write the response.",
    communicationsSummary:
      "I don't see any email threads with Marcus in your connected inbox — no complaint, no support request " +
      "before the dispute. That absence matters: if he never raised the quality issue with you first, note it " +
      "in your response, and check whether the conversation happened somewhere else (DMs, phone).",
  },
  {
    id: "2417",
    status: "needs_response",
    reason: "duplicate",
    amountCents: 89900,
    customerName: "Elena Cruz",
    customerEmail: "elena.cruz@email.com",
    productName: "Elite Mentorship Package",
    openedAt: "2026-08-11T00:00:00Z",
    evidenceDueAt: "2026-08-25T00:00:00Z",
    responseStatus: "in_progress",
    scenario: "evidence_ready",
    likelyReason:
      "Elena was charged twice for the same purchase due to a checkout retry — the transaction log shows two " +
      "charges seconds apart for the same cart, both for the Elite Mentorship Package.",
    evidenceCollected: [
      "Transaction & payment details",
      "Customer & account information",
      "Access & activity records",
      "Product description & offer details",
      "Terms & refund policy",
      "Customer communications",
    ],
    evidenceMissing: [],
    recommendedAction:
      "You already have everything you need. Either refund the duplicate charge directly or respond with the " +
      "transaction log showing both charges before Aug 25 — either resolves this cleanly.",
    draftResponse:
      "Our transaction log shows Elena Cruz was charged twice for the same order — transaction txn_5a2d81ffec " +
      "and a duplicate charge seconds later, both for the Elite Mentorship Package on August 8, 2026. This was a " +
      "checkout-retry duplicate, not two separate purchases. We are refunding the duplicate charge and ask that " +
      "this dispute be closed accordingly.",
    communicationsSummary:
      "Elena emailed support on August 10 flagging the double charge herself, before filing the dispute — polite " +
      "and factual, with both receipts attached. That thread is already in your evidence. A quick refund plus a " +
      "reply acknowledging her original email is the cleanest close here.",
  },
  {
    id: "2455",
    status: "needs_response",
    reason: "product_not_received",
    amountCents: 24900,
    customerName: "David Kim",
    customerEmail: "david.kim@email.com",
    productName: "Growth Accelerator Course",
    openedAt: "2026-08-17T00:00:00Z",
    evidenceDueAt: "2026-08-31T00:00:00Z",
    responseStatus: "not_started",
    scenario: "high_risk",
    likelyReason:
      "The signals are mixed: David never logged into the course portal, but he also never opened a support " +
      "ticket or replied to the onboarding email. That's consistent with either genuine non-delivery or simple " +
      "non-engagement — the data alone can't tell us which.",
    evidenceCollected: ["Transaction & payment details"],
    evidenceMissing: ["Access & activity records", "Customer communications"],
    uncertaintyNote:
      "I want to be upfront: the evidence here doesn't clearly point one way or the other. I wouldn't commit to " +
      "a response strategy without gathering more first — treating this as clear-cut friendly fraud would be " +
      "guessing, not reasoning from the data.",
    recommendedAction:
      "This one's genuinely uncertain. Before responding, check whether the delivery/access email actually " +
      "reached David and whether support ever heard from him. Don't assume friendly fraud without more signal.",
    draftResponse:
      "I can draft something, but I want to flag that the evidence for this case is inconclusive — David shows " +
      "no login activity, but also no support contact, so I can't confidently claim the product was used. A " +
      "safer starting draft: \"We show transaction txn_3f7b90c114 completed successfully on August 14, 2026, " +
      "granting immediate access to the Growth Accelerator Course. We're gathering additional access records " +
      "and will follow up with further evidence.\" I'd firm this up once you have activity or communication " +
      "records rather than relying on transaction proof alone.",
    communicationsSummary:
      "No email threads with David at all — he never opened the onboarding email's thread and never contacted " +
      "support. Combined with zero logins, the communications record can't distinguish non-delivery from " +
      "non-engagement. Before responding, verify the delivery email actually reached his address.",
  },
  {
    id: "2390",
    status: "won",
    reason: "product_not_received",
    amountCents: 34900,
    customerName: "Priya Nair",
    customerEmail: "priya.nair@email.com",
    productName: "Pro Coaching Program",
    openedAt: "2026-08-03T00:00:00Z",
    evidenceDueAt: "2026-08-17T00:00:00Z",
    responseStatus: "ready",
    scenario: "resolved",
    likelyReason:
      "Priya disputed as \"product not received,\" but she had already logged in 18 times and attended a " +
      "coaching call before filing — a classic friendly-fraud pattern.",
    evidenceCollected: [
      "Transaction & payment details",
      "Customer & account information",
      "Access & activity records",
      "Product description & offer details",
      "Terms & refund policy",
      "Customer communications",
    ],
    evidenceMissing: [],
    recommendedAction: "No action needed — this case is closed and resolved in your favor.",
    resolutionOutcome:
      "Won on August 9, 2026. The seller submitted evidence of 18 portal logins and a signed onboarding-call " +
      "attendance record before the deadline, and the card network ruled in the seller's favor. No further " +
      "action is needed.",
    draftResponse: "This dispute is already resolved — there's nothing left to draft or submit.",
    communicationsSummary:
      "The correspondence on file (onboarding email and the signed attendance record) was part of the winning " +
      "evidence package. This case is closed — nothing further is needed.",
  },
];

function textResult(payload: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload) }] };
}

function errorResult(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

export function createMockCommasServer(): McpServer {
  const server = new McpServer({ name: "commas-mock", version: "0.1.0" });

  server.registerTool(
    "fanbasis_list_customers",
    {
      title: "List customers",
      description: "Search customers by name or email.",
      inputSchema: { search: z.string().optional() },
    },
    async ({ search }) => {
      const q = search?.trim().toLowerCase();
      const results = q
        ? CUSTOMERS.filter((c) => c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q))
        : CUSTOMERS;
      return textResult({ customers: results });
    },
  );

  server.registerTool(
    "fanbasis_list_transactions",
    {
      title: "List transactions",
      description: "List transactions, optionally filtered by customer email.",
      inputSchema: { customer_email: z.string().optional() },
    },
    async ({ customer_email }) => {
      if (customer_email) {
        const results = TRANSACTIONS.filter((t) => t.customerEmail.toLowerCase() === customer_email.toLowerCase());
        return textResult({ transactions: results });
      }
      // Unfiltered = "how's the month going" — include the rollup the Dashboard shows, so
      // agent answers can't contradict the rest of the product (audit P0-2).
      return textResult({ transactions: TRANSACTIONS, summary: MONTH_SUMMARY });
    },
  );

  server.registerTool(
    "commas_list_disputes",
    {
      title: "List disputes",
      description:
        "List all disputes with their status. Prototype-only tool — the real Commas platform has no disputes API.",
      inputSchema: {},
    },
    async () => {
      return textResult({
        disputes: DISPUTES.map((d) => ({
          id: d.id,
          status: d.status,
          reason: d.reason,
          amountCents: d.amountCents,
          customerName: d.customerName,
          evidenceDueAt: d.evidenceDueAt,
        })),
      });
    },
  );

  server.registerTool(
    "fanbasis_get_transaction",
    {
      title: "Get transaction",
      description: "Look up a single transaction by id.",
      inputSchema: { id: z.string() },
    },
    async ({ id }) => {
      const txn = TRANSACTIONS.find((t) => t.id === id);
      if (!txn) return errorResult(`Transaction not found: ${id}`);
      return textResult({ transaction: txn });
    },
  );

  server.registerTool(
    "commas_get_dispute",
    {
      title: "Get dispute",
      description:
        "Look up a dispute by id. Prototype-only tool — the real Commas platform has no disputes API.",
      inputSchema: { id: z.string() },
    },
    async ({ id }) => {
      const dispute = DISPUTES.find((d) => d.id === id);
      if (!dispute) return errorResult(`Dispute not found: ${id}`);
      return textResult({ dispute });
    },
  );

  server.registerTool(
    "commas_mark_dispute_response_ready",
    {
      title: "Mark dispute response ready",
      description:
        "Mark a dispute's evidence response as ready to submit. Prototype-only, simulated — " +
        "the real Commas platform has no evidence-submission API; this only flips a mock flag " +
        "and is never actually sent anywhere. Always requires seller confirmation before running.",
      inputSchema: { dispute_id: z.string() },
    },
    async ({ dispute_id }) => {
      const dispute = DISPUTES.find((d) => d.id === dispute_id);
      if (!dispute) return errorResult(`Dispute not found: ${dispute_id}`);
      dispute.responseStatus = "ready";
      return textResult({ dispute, simulated: true });
    },
  );

  return server;
}
