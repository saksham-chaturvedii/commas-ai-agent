import type { Chat, CreditsState, PageContext, SourceInfo, SuggestedCapability } from "./types";
import { getDispute } from "./disputeData";

/**
 * Hand-authored mock data for the chat/agent surfaces. No backend, no LLM, no MCP — see
 * docs/active-context.md for what's mocked vs. real. The dispute story matches
 * src/lib/disputeData.ts (ported from commas-ai-copilot): Sarah Johnson, Dispute #2481,
 * $499 Pro Coaching Program, purchased Aug 2 2026, disputed Aug 9, evidence due Aug 13.
 *
 * Source list per Commas CPO (external OAuth-style integrations for off-platform
 * fulfillment): Google Calendar, Zoom, Fathom, Gmail, CRM. Do not invent more.
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
    name: "CRM",
    description: "Your CRM's contact records and deal history.",
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
export function buildDisputeContext(disputeId: string): PageContext {
  const d = getDispute(disputeId);
  if (!d) return { kind: "dispute", id: disputeId, label: `Dispute #${disputeId}` };
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
  {
    id: "revenue-drop",
    label: "Help me understand why revenue dropped this month",
    prompt: "Help me understand why revenue dropped this month",
  },
  { id: "sales-summary", label: "Summarize my sales", prompt: "Summarize my sales this month" },
  { id: "analyze-disputes", label: "Analyze my disputes", prompt: "Analyze my disputes" },
  {
    id: "cross-apps",
    label: "Find information across my connected apps",
    prompt: "Find information across my connected apps",
  },
];

/** Demo-script prompts for the Resolution Center chat (docs/active-context.md — "Resolution
 * Center Demo-Readiness"), each answered deterministically against the currently selected
 * dispute by server/llm/stubClient.ts. */
export const DISPUTE_SUGGESTED_CAPABILITIES: SuggestedCapability[] = [
  { id: "investigate", label: "Investigate this dispute", prompt: "Investigate this dispute" },
  { id: "why-open", label: "Why is this dispute open?", prompt: "Why is this dispute open?" },
  { id: "evidence-needed", label: "Find missing evidence", prompt: "What evidence do I need?" },
  {
    id: "review-comms",
    label: "Review customer communications",
    prompt: "Check customer communications for this dispute",
  },
  { id: "draft-response", label: "Draft my response", prompt: "Draft my response" },
  { id: "summarize-case", label: "Summarize this case", prompt: "Summarize this case" },
  { id: "next-step", label: "What should I do next?", prompt: "What should I do next?" },
];

const now = Date.now();
const hoursAgo = (h: number) => new Date(now - h * 60 * 60 * 1000).toISOString();

/** Seed chat history so the history list and reload-persistence UI aren't empty on first load. */
export const SEED_CHATS: Chat[] = [
  {
    id: "chat-seed-1",
    title: "Which discount codes get used the most?",
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
          "($4,250). 3 refunds totaling $960 were issued, and 1 dispute is currently open " +
          "(#2481, evidence due August 13).",
        ts: hoursAgo(3),
        toolSummary: [
          { sourceId: "commas", label: "Transactions", ok: true },
          { sourceId: "commas", label: "Products", ok: true },
        ],
      },
    ],
  },
];
