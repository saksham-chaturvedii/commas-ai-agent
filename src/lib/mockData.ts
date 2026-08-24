import type { Chat, CreditsState, PageContext, SourceInfo, SuggestedCapability } from "./types";
import { getDispute, type AIEvidenceItem } from "./disputeData";

/**
 * Hand-authored mock data for the chat/agent surfaces. No backend, no LLM, no MCP — see
 * docs/active-context.md for what's mocked vs. real. The dispute story matches
 * src/lib/disputeData.ts (ported from commas-ai-copilot): Sarah Johnson, Dispute #2481,
 * $499 Pro Coaching Program, purchased Aug 2 2026, disputed Aug 9, evidence due Aug 13.
 *
 * Source list per Commas CPO (external OAuth-style integrations for off-platform
 * fulfillment): Google Calendar, Zoom, Fathom, Gmail, GoHighLevel (GHL — internal id "crm").
 * Do not invent more.
 */

export const SOURCES: SourceInfo[] = [
  {
    id: "commas",
    name: "Commas",
    description: "Products, customers, transactions, subscriptions, and disputes.",
    connection: "connected",
    isPrimary: true,
  },
  {
    id: "google-calendar",
    name: "Google Calendar",
    description: "Scheduled sessions, invitations, and attendance.",
    connection: "connected",
  },
  {
    id: "zoom",
    name: "Zoom",
    description: "Meeting history — join times, duration, and attendees.",
    connection: "connected",
  },
  {
    id: "fathom",
    name: "Fathom",
    description: "Call recordings and AI summaries from customer calls.",
    connection: "connected",
  },
  {
    id: "gmail",
    name: "Gmail",
    description: "Email threads with your customers.",
    connection: "not_connected",
  },
  {
    id: "crm",
    name: "GoHighLevel",
    description: "Your GoHighLevel contact records and deal history.",
    connection: "not_connected",
  },
];

/** Default per-chat scope: every currently connected source. */
export const DEFAULT_ENABLED_SOURCES = ["commas", "google-calendar", "zoom", "fathom"] as const;

/**
 * Structured dispute context — attached whenever the agent panel opens from Dispute Detail
 * so the agent has the facts without a tool call or the seller copy/pasting anything
 * (PROTOTYPE_SPEC.md §2.11). Built from src/lib/disputeData.ts so all 5 demo cases (docs/
 * active-context.md) get a correct context, not just the original Sarah Johnson case; the
 * mock Commas MCP server's DISPUTES record (server/mcp/mockCommasServer.ts) mirrors the same
 * ids/facts, kept in sync by hand.
 */
/**
 * `evidenceItems` is the seller's currently-gathered evidence for this dispute (App.tsx's
 * `evidenceByDispute[disputeId]`, seeded + session-added) — summarized by checklist category
 * here so the agent can answer "what evidence do we have" from context alone, without a tool
 * call and without shipping full evidence text/files over the wire. Omit it only when no
 * evidence state is available yet (e.g. a not-yet-rendered dispute).
 */
export function buildDisputeContext(disputeId: string, evidenceItems: AIEvidenceItem[] = []): PageContext {
  const d = getDispute(disputeId);
  if (!d) return { kind: "dispute", id: disputeId, label: `Dispute #${disputeId}` };
  const byCategory = new Map<string, number>();
  for (const item of evidenceItems) {
    byCategory.set(item.category, (byCategory.get(item.category) ?? 0) + 1);
  }
  return {
    kind: "dispute",
    id: d.id,
    label: `Dispute #${d.id} — ${d.customer.name}`,
    dispute: {
      customerName: d.customer.name,
      customerEmail: d.customer.email,
      transactionId: d.product.transactionId,
      amountCents: Math.round(parseFloat(d.amount.replace(/[^0-9.]/g, "")) * 100),
      reason: d.reasonCode,
      openedAt: d.openedAt,
      evidenceDueAt: d.evidenceDueAt,
      evidenceStatus: d.evidenceStatus,
      status: d.status,
      evidenceSummary: Array.from(byCategory, ([category, count]) => ({ category, count })),
    },
  };
}

export const DASHBOARD_CONTEXT: PageContext = {
  kind: "dashboard",
  id: "dashboard",
  label: "Dashboard",
};

/** Prototype credit system (docs/active-context.md — "Chat Credit System"): a fresh workspace
 * starts with 300 total credits, 0 used. */
export const INITIAL_CREDITS: CreditsState = {
  totalCredits: 300,
  usedCredits: 0,
};

export const LOW_CREDIT_THRESHOLD = 50;

export const CREDIT_PACKAGES: { id: string; credits: number; price: string }[] = [
  { id: "50", credits: 50, price: "$30" },
  { id: "100", credits: 100, price: "$50" },
  { id: "250", credits: 250, price: "$100" },
];

/**
 * One unified credit model for the whole workspace — global chat and dispute investigations
 * draw from the exact same `CreditsState` (useChatStore's `credits`), never separate balances.
 * These three numbers are the entire demo-configurable pricing model: tune them here and every
 * chat surface picks up the change, no other file needs to. Charged once per completed turn,
 * by `creditCostForDisputeTurn`/`useChatStore.tsx`'s `chargeCredits`, only AFTER the agent's
 * work finishes successfully — never up front, never on a technical failure.
 */
export const CREDIT_COSTS = {
  /** A plain answer: no tool calls, or a single source checked. This is also the only tier
   * global/dashboard chat can ever incur — the shared-agent streaming transport doesn't report
   * tool-call detail to the client, so there's no real signal to price a heavier tier by there. */
  standardMessage: 1,
  /** A dispute-chat turn that checked 2+ sources this turn (e.g. Commas + Gmail, or an
   * explicit "search my connected apps" sweep) without producing a full structured
   * investigation report. */
  multiSourceInvestigation: 3,
  /** A full multi-source dispute investigation — the structured `InvestigationReport` (case
   * summary, evidence found, contradictions, case strength, …). The most work the agent does in
   * one turn, priced accordingly. */
  advancedInvestigation: 5,
} as const;

/** Which `CREDIT_COSTS` tier a completed dispute-chat turn actually earned, decided from real
 * signals already on the response — never guessed, never charged before the work is known.
 * Global/dashboard chat (the streaming path) has no equivalent tool-detail signal, so it always
 * costs `standardMessage` — see `CREDIT_COSTS.standardMessage`'s own comment. */
export function creditCostForDisputeTurn(plan: { toolSummary: { length: number }; investigationReport?: unknown }): number {
  if (plan.investigationReport) return CREDIT_COSTS.advancedInvestigation;
  if (plan.toolSummary.length >= 2) return CREDIT_COSTS.multiSourceInvestigation;
  return CREDIT_COSTS.standardMessage;
}

export const SUGGESTED_CAPABILITIES: SuggestedCapability[] = [
  { id: "sales-summary", label: "Summarize my sales", prompt: "Summarize my sales this month" },
  { id: "find-customer", label: "Look up a customer", prompt: "Look up customer sarah.johnson@email.com" },
  { id: "analyze-disputes", label: "Analyze my disputes", prompt: "Analyze my disputes" },
  {
    id: "respond-customer",
    label: "Help me respond to a customer",
    prompt: "Help me respond to a customer",
  },
  {
    id: "cross-apps",
    label: "Find information across my connected apps",
    prompt: "Find information across my connected apps",
  },
];

export const DASHBOARD_SUGGESTED_CAPABILITIES: SuggestedCapability[] = [
  // Reworded from "why revenue dropped" — the Dashboard itself shows revenue UP 12%, so the
  // old chip contradicted the page it sits on (PRODUCT_READINESS_AUDIT.md P0-5).
  {
    id: "revenue-drivers",
    label: "What's driving my revenue this month?",
    prompt: "What's driving my revenue this month?",
  },
  { id: "sales-summary", label: "Summarize my sales", prompt: "Summarize my sales this month" },
  { id: "analyze-disputes", label: "Analyze my disputes", prompt: "Analyze my disputes" },
  {
    id: "cross-apps",
    label: "Find information across my connected apps",
    prompt: "Find information across my connected apps",
  },
];

/** Starter actions shown when a dispute-scoped chat has no investigation yet (0 messages) — the
 * unified conversation model's "no existing investigation" empty state
 * (docs/AI_ASSISTANT_IMPLEMENTATION_STATUS.md's current phase). Each is answered deterministically
 * against the currently selected dispute by server/llm/stubClient.ts. */
export const DISPUTE_SUGGESTED_CAPABILITIES: SuggestedCapability[] = [
  { id: "investigate", label: "Investigate this dispute", prompt: "Investigate this dispute" },
  { id: "find-evidence", label: "Find relevant evidence", prompt: "Find relevant evidence for this dispute" },
  { id: "check-apps", label: "Check connected apps", prompt: "Check my connected apps for information about this dispute" },
  { id: "customer-history", label: "Analyze customer history", prompt: "Analyze this customer's history" },
  { id: "draft-response", label: "Draft a response", prompt: "Draft a response" },
];

const now = Date.now();
const hoursAgo = (h: number) => new Date(now - h * 60 * 60 * 1000).toISOString();

/** Seed chat history so the history list and reload-persistence UI aren't empty on first load. */
export const SEED_CHATS: Chat[] = [
  {
    id: "chat-seed-1",
    title: "Which discount codes get used the most?",
    type: "global",
    createdAt: hoursAgo(26),
    updatedAt: hoursAgo(26),
    status: "idle",
    enabledSources: ["commas"],
    messages: [
      {
        id: "m1",
        role: "user",
        text: "Which discount codes have been used the most?",
        ts: hoursAgo(26),
      },
      {
        id: "m2",
        role: "assistant",
        text:
          "Your top discount code is **LAUNCH20** (20% off) with 87 redemptions this quarter, " +
          "followed by **WELCOME10** with 54 and **VIP25** with 12. LAUNCH20 accounts for roughly " +
          "38% of all discounted checkouts in the period.",
        ts: hoursAgo(26),
        toolSummary: [{ sourceId: "commas", label: "Discount codes", ok: true }],
      },
    ],
  },
  {
    id: "chat-seed-2",
    title: "Sales summary — last 30 days",
    type: "global",
    createdAt: hoursAgo(3),
    updatedAt: hoursAgo(3),
    status: "idle",
    enabledSources: ["commas"],
    messages: [
      {
        id: "m3",
        role: "user",
        text: "Give me a summary of my sales this month",
        ts: hoursAgo(3),
      },
      {
        id: "m4",
        role: "assistant",
        text:
          "This month you've done **$18,420** across 62 transactions — up 12% from last month. " +
          "**Pro Coaching Program** is your top seller ($9,800), followed by **1:1 Strategy Call** " +
          "($4,250). 3 refunds totaling $960 were issued, and 4 disputes are currently open — " +
          "**#2481** is the most urgent (evidence due August 23).",
        ts: hoursAgo(3),
        toolSummary: [
          { sourceId: "commas", label: "Transactions", ok: true },
          { sourceId: "commas", label: "Products", ok: true },
        ],
      },
    ],
  },
];
