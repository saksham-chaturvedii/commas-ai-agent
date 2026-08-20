import type { PageContext, ProgressStep, SourceId, ToolSummaryItem } from "./types";

/**
 * Scripted "agent" for the UI foundation — NOT a real agent loop, NOT connected to an LLM or
 * MCP. It pattern-matches the prompt and returns a canned multi-step plan so the chat UI has
 * something realistic to render (progress lines, source attribution, a final answer). See
 * docs/active-context.md "What remains mocked" and docs/ARCHITECTURE.md §4-9 for what a real
 * implementation replaces this with.
 *
 * The dispute story matches src/lib/disputeData.ts (August 2026): purchase Aug 2 14:32 UTC,
 * access granted 14:33, 14 logins Aug 2–8, 6 of 12 lessons completed, support thread Aug 2–3,
 * dispute opened Aug 9, evidence due Aug 13.
 */

export interface MockRunPlan {
  /** Sequential progress lines to play before the answer — empty means a direct answer. */
  steps: ProgressStep[];
  answer: string;
  toolSummary: ToolSummaryItem[];
}

function step(sourceId: SourceId, label: string): ProgressStep {
  return { id: `${sourceId}-${label}`, sourceId, classification: "read", label };
}

function summarize(steps: ProgressStep[]): ToolSummaryItem[] {
  return steps.map((s) => ({ sourceId: s.sourceId, label: s.label, ok: true }));
}

const SOURCE_LABELS: Record<SourceId, string> = {
  commas: "Commas",
  "google-calendar": "Google Calendar",
  zoom: "Zoom",
  fathom: "Fathom",
  gmail: "Gmail",
  crm: "your CRM",
};

const EXTERNAL_SOURCES: SourceId[] = ["google-calendar", "zoom", "fathom", "gmail", "crm"];

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Word-boundary substring match. Plain `.includes()` false-positives badly here — e.g. "hi"
 * matches inside "this" and "which", misrouting real prompts to the wrong branch.
 */
function includes(prompt: string, ...needles: string[]) {
  const p = prompt.toLowerCase();
  return needles.some((n) => new RegExp(`\\b${escapeRegex(n)}\\b`, "i").test(p));
}

export function planMockRun(input: {
  prompt: string;
  enabledSources: SourceId[];
  context?: PageContext;
}): MockRunPlan {
  const { prompt, enabledSources } = input;
  const has = (id: SourceId) => enabledSources.includes(id);
  const noCommas = (what: string): MockRunPlan => ({
    steps: [],
    answer: `Commas is turned off as a source for this chat, so I can't check ${what}. Enable it in the sources menu and ask again.`,
    toolSummary: [],
  });

  // 1. Direct answers — no tool use.
  if (includes(prompt, "what can you", "help me get started", "hi", "hello", "hey")) {
    return {
      steps: [],
      answer:
        "I can help you run your Commas business — summarize sales, look up customers, analyze " +
        "disputes, draft customer responses — and pull in your connected apps (calendar, " +
        "meetings, calls, email, CRM) when the answer lives off-platform. Try one of the " +
        "suggestions below, or just ask.",
      toolSummary: [],
    };
  }

  // 2. Revenue-drop analysis (dashboard-contextual suggestion) — check before generic sales.
  if (includes(prompt, "dropped", "drop", "down", "declined", "why revenue")) {
    if (!has("commas")) return noCommas("your revenue");
    const steps = [
      step("commas", "Checking this month's transactions…"),
      step("commas", "Comparing against last month…"),
      step("commas", "Checking refunds & subscriptions…"),
    ];
    return {
      steps,
      answer:
        "### What changed\n\n" +
        "Revenue is down **9% month-over-month** ($18,420 vs $20,240). Three things account " +
        "for almost all of it:\n\n" +
        "- **1:1 Strategy Call bookings fell** from 14 to 9 — about $1,250 of the gap (Commas)\n" +
        "- **3 refunds totaling $960** vs 1 last month (Commas)\n" +
        "- **2 subscription cancellations** at the start of the month (Commas)\n\n" +
        "New Pro Coaching Program sales are actually up slightly — the drop is concentrated in " +
        "call bookings and refunds, not your core product.",
      toolSummary: summarize(steps),
    };
  }

  // 3. Sales summary.
  if (includes(prompt, "sales", "summary", "revenue")) {
    if (!has("commas")) return noCommas("sales");
    const steps = [step("commas", "Checking transaction history…"), step("commas", "Checking products…")];
    return {
      steps,
      answer:
        "This month you've done **$18,420** across 62 transactions — up 12% from last month. " +
        "**Pro Coaching Program** is your top seller ($9,800), followed by **1:1 Strategy Call** " +
        "($4,250). 3 refunds totaling $960 were issued, and 1 dispute is currently open " +
        "(#2481, evidence due August 13).",
      toolSummary: summarize(steps),
    };
  }

  // 4. Discount codes.
  if (includes(prompt, "discount", "coupon", "promo")) {
    if (!has("commas")) return noCommas("discount codes");
    const steps = [step("commas", "Checking discount codes…")];
    return {
      steps,
      answer:
        "Your top discount code is **LAUNCH20** (20% off) with 87 redemptions this quarter, " +
        "followed by **WELCOME10** with 54 and **VIP25** with 12. LAUNCH20 accounts for roughly " +
        "38% of all discounted checkouts in the period.",
      toolSummary: summarize(steps),
    };
  }

  // 5. Dispute investigation / evidence draft — the flagship flow. Checked before the
  // customer branches so dispute-context prompts land here.
  if (includes(prompt, "dispute", "disputes", "resolve", "evidence", "chargeback", "delivery")) {
    if (!has("commas")) return noCommas("the dispute");
    const wantsDraft = includes(prompt, "draft", "response");

    const commasSteps: ProgressStep[] = [
      step("commas", "Checking dispute record…"),
      step("commas", "Checking customer & transaction…"),
      step("commas", "Checking access & activity logs…"),
    ];
    const externalSteps: ProgressStep[] = [
      step("fathom", "Searching Fathom calls with Sarah…"),
      step("zoom", "Checking Zoom meeting history…"),
      step("google-calendar", "Checking scheduled sessions…"),
      step("gmail", "Searching email threads with Sarah…"),
      step("crm", "Checking CRM contact record…"),
    ].filter((s) => has(s.sourceId));
    const steps = [...commasSteps, ...externalSteps];

    const skipped = EXTERNAL_SOURCES.filter((id) => !has(id));
    const skippedNote =
      skipped.length > 0
        ? ` I couldn't check ${skipped.map((id) => SOURCE_LABELS[id]).join(", ")} — ${
            skipped.length === 1 ? "it isn't" : "they aren't"
          } available to this chat.`
        : "";

    const hasFathom = has("fathom");
    const hasZoom = has("zoom");
    const hasCalendar = has("google-calendar");
    const hasGmail = has("gmail");
    const hasCrm = has("crm");

    const caseSummary =
      "### Case summary\n\n" +
      "**Dispute #2481 — $499.00, \"Product not received\"**, opened August 9, evidence due " +
      "**August 13**. Sarah Johnson purchased the Pro Coaching Program on August 2 at 14:32 UTC " +
      "and was granted access one minute later. Her account shows sustained use of the program " +
      "after purchase." +
      skippedNote;

    const timelineItems = [
      "- **Aug 2, 14:32 UTC** — $499.00 payment processed, txn_8b3f2a1c9d (Commas)",
      "- **Aug 2, 14:33 UTC** — Program access granted; welcome email delivered (Commas)",
      "- **Aug 2–3** — Support thread: Sarah asked how to access, confirmed \"I'm in now\" (Commas)",
      "- **Aug 3, 10:32 AM** — First login, 18 hours after purchase (Commas)",
    ];
    if (hasCalendar) timelineItems.push("- **Aug 4 & Aug 6** — Accepted session invitations on her calendar (Google Calendar)");
    if (hasFathom) timelineItems.push("- **Aug 4** — 42-minute onboarding call recorded (Fathom)");
    if (hasZoom) timelineItems.push("- **Aug 4 & Aug 6** — Matching meeting join times (Zoom)");
    if (hasFathom) timelineItems.push("- **Aug 6** — Group coaching session recorded (Fathom)");
    if (hasGmail) timelineItems.push("- **Aug 2** — Welcome + access emails delivered and opened (Gmail)");
    timelineItems.push("- **Aug 2–8** — 14 logins, 6 of 12 lessons completed (Commas)");
    timelineItems.push("- **Aug 9** — Dispute opened: \"Product not received\" (Commas)");
    const timeline = "### Timeline\n\n" + timelineItems.join("\n");

    const evidenceItems = [
      "- Transaction receipt: $499.00, Visa •••• 4242, Aug 2 14:32 UTC (Commas)",
      "- Access & login records: access at 14:33, 14 logins Aug 2–8 (Commas)",
      "- Lesson activity: 6 of 12 lessons completed (Commas)",
      "- Support thread where Sarah confirmed access in writing (Commas)",
    ];
    if (hasFathom) evidenceItems.push("- Call recordings: onboarding Aug 4, coaching session Aug 6 (Fathom)");
    if (hasZoom) evidenceItems.push("- Meeting log corroborating both sessions (Zoom)");
    if (hasCalendar) evidenceItems.push("- Accepted calendar invitations for both sessions (Google Calendar)");
    if (hasGmail) evidenceItems.push("- Delivered and opened welcome/access emails (Gmail)");
    if (hasCrm) evidenceItems.push("- Active-client contact record with engagement notes (CRM)");
    const evidence = "### Evidence\n\n" + evidenceItems.join("\n");

    const draft =
      "### Drafted response\n\n" +
      "\"Sarah Johnson purchased the Pro Coaching Program ($499.00) on August 2, 2026 at 14:32 " +
      "UTC (txn_8b3f2a1c9d). Access was granted one minute after payment and confirmed by the " +
      "customer in writing. Our records show 14 logins and 6 completed lessons between August 2 " +
      "and August 8, plus attended live sessions on August 4 and 6. The customer accepted our " +
      "terms and 14-day refund policy at checkout and did not request a refund before disputing. " +
      "We ask that this dispute be resolved in the seller's favor.\" " +
      "You can copy this into the response box — nothing is submitted automatically.";

    return {
      steps,
      answer: [caseSummary, timeline, evidence, ...(wantsDraft ? [draft] : [])].join("\n\n"),
      toolSummary: summarize(steps),
    };
  }

  // 6. Help me respond to a customer (no dispute keyword) — comms check + drafted reply.
  if (includes(prompt, "respond", "reply")) {
    if (!has("commas")) return noCommas("your conversations");
    const steps = [step("commas", "Checking recent conversations…")];
    return {
      steps,
      answer:
        "Your most recent open thread is from **Sarah Johnson** (Aug 2): she asked how to access " +
        "the Pro Coaching Program, support replied with the login link, and she confirmed access " +
        "the next day — nothing outstanding there. If you tell me which customer you want to " +
        "reply to, I'll pull their history and draft a response in your tone.",
      toolSummary: summarize(steps),
    };
  }

  // 7. Cross-app search.
  if (includes(prompt, "connected apps", "across my", "find information")) {
    const externalSteps = [
      step("google-calendar", "Checking scheduled sessions…"),
      step("zoom", "Checking meeting history…"),
      step("fathom", "Checking call recordings…"),
      step("gmail", "Checking email threads…"),
      step("crm", "Checking contact records…"),
    ].filter((s) => has(s.sourceId));
    if (externalSteps.length === 0) {
      return {
        steps: [],
        answer:
          "No connected apps are available to this chat right now. Connect Google Calendar, " +
          "Zoom, Fathom, Gmail, or your CRM (or enable them in the sources menu) and I can " +
          "search across them.",
        toolSummary: [],
      };
    }
    const found = externalSteps.map((s) => SOURCE_LABELS[s.sourceId]).join(", ");
    return {
      steps: externalSteps,
      answer:
        `I can currently see **${found}**. Across them I found: 2 upcoming coaching sessions ` +
        "this week, 3 call recordings with customers from the last 14 days, and 2 accepted " +
        "session invitations from Sarah Johnson. Ask me about a specific customer or session " +
        "and I'll dig in.",
      toolSummary: summarize(externalSteps),
    };
  }

  // 8. Customer lookup.
  if (includes(prompt, "customer", "look up", "lookup", "sarah", "history")) {
    if (!has("commas")) return noCommas("customers");
    const steps = [step("commas", "Searching customers…"), step("commas", "Checking transaction history…")];
    return {
      steps,
      answer:
        "**Sarah Johnson** (sarah.johnson@email.com) — 1 purchase: **Pro Coaching Program**, " +
        "$499.00, on August 2, 2026 (txn_8b3f2a1c9d). Account activity: 14 logins and 6 of 12 " +
        "lessons completed between Aug 2–8. Payment status: disputed (#2481, \"Product not " +
        "received\", opened Aug 9, evidence due Aug 13). No prior refunds or disputes.",
      toolSummary: summarize(steps),
    };
  }

  // 9. Fallback — honest about being a scripted demo, not a general assistant.
  return {
    steps: [],
    answer:
      "This preview only knows a handful of demo scenarios right now — try asking about sales, " +
      "discount codes, a customer, your revenue, or the open dispute, or use one of the " +
      "suggestions below.",
    toolSummary: [],
  };
}
