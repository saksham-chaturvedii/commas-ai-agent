import type { Chat, CreditsState, PageContext, SourceInfo, SuggestedCapability } from "./types";

/**
 * Hand-authored mock data for the UI foundation pass. No backend, no LLM, no MCP — see
 * docs/active-context.md for what's mocked vs. real. Kept internally consistent with the
 * old commas-ai-copilot prototype's dispute scenario (Sarah Johnson, #2481, $499,
 * "Product not received") so a future phase can extend it rather than replace it.
 */

export const SOURCES: SourceInfo[] = [
  {
    id: "commas",
    name: "Commas",
    description: "Products, customers, transactions, subscriptions, and discount codes.",
    connection: "connected",
    isPrimary: true,
  },
  {
    id: "fathom",
    name: "Fathom",
    description: "Call recordings and AI summaries from customer calls.",
    connection: "connected",
  },
  {
    id: "zoom",
    name: "Zoom",
    description: "Meeting history — join times, duration, and attendees.",
    connection: "connected",
  },
  {
    id: "google-meet",
    name: "Google Meet",
    description: "Calendar-linked meeting records and attendance.",
    connection: "not_connected",
  },
  {
    id: "clickfunnels",
    name: "ClickFunnels",
    description: "Funnel and order data — page views, opt-ins, checkout steps.",
    connection: "not_connected",
  },
];

export const DISPUTE_CONTEXT: PageContext = {
  kind: "dispute",
  id: "2481",
  label: "Dispute #2481 — Sarah Johnson",
};

export const INITIAL_CREDITS: CreditsState = {
  balance: 284,
  startingBalance: 300,
};

export const SUGGESTED_CAPABILITIES: SuggestedCapability[] = [
  {
    id: "sales-summary",
    label: "Summarize my sales this month",
    prompt: "Give me a summary of my sales this month",
  },
  {
    id: "top-discounts",
    label: "Which discount codes get used the most?",
    prompt: "Which discount codes have been used the most?",
  },
  {
    id: "find-customer",
    label: "Look up a customer",
    prompt: "Look up customer sarah.johnson@example.com and show her purchase history",
  },
  {
    id: "dispute-help",
    label: "Help me respond to my open dispute",
    prompt: "Help me respond to my open dispute",
  },
];

export const DISPUTE_SUGGESTED_CAPABILITIES: SuggestedCapability[] = [
  {
    id: "investigate",
    label: "Investigate this dispute",
    prompt: "Investigate this dispute",
  },
  {
    id: "draft-response",
    label: "Draft an evidence response",
    prompt: "Draft an evidence response for this dispute",
  },
  {
    id: "customer-history",
    label: "What's the customer's history?",
    prompt: "What's this customer's history with us?",
  },
  {
    id: "check-delivery",
    label: "Check delivery across connected apps",
    prompt: "Check delivery across connected apps",
  },
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
          "($4,250). 3 refunds totaling $960 were issued, and 1 dispute is currently open (#2481).",
        ts: hoursAgo(3),
        toolSummary: [
          { sourceId: "commas", label: "Transactions", ok: true },
          { sourceId: "commas", label: "Products", ok: true },
        ],
      },
    ],
  },
];
