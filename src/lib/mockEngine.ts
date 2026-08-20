import type { PageContext, ProgressStep, SourceId, ToolSummaryItem } from "./types";

/**
 * Scripted "agent" for the UI foundation pass — NOT a real agent loop, NOT connected to an
 * LLM or MCP. It pattern-matches the prompt and returns a canned multi-step plan so the chat
 * UI has something realistic to render (progress lines, source attribution, a final answer).
 * See docs/active-context.md "What remains mocked" and docs/ARCHITECTURE.md §4-9 for what a
 * real implementation replaces this with.
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

const CONNECTED_APP_LABELS: Record<SourceId, string> = {
  commas: "Commas",
  fathom: "Fathom",
  zoom: "Zoom",
  "google-meet": "Google Meet",
  clickfunnels: "ClickFunnels",
};

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
  const { prompt, enabledSources, context } = input;
  const has = (id: SourceId) => enabledSources.includes(id);

  // 1. Direct answers — no tool use.
  if (includes(prompt, "what can you", "help", "hi", "hello", "hey")) {
    return {
      steps: [],
      answer:
        "I can help you investigate your Commas business — sales, customers, discount codes, " +
        "subscriptions — and, on a dispute page, pull in your connected apps to help you " +
        "respond. Try one of the suggestions below, or ask me something directly.",
      toolSummary: [],
    };
  }

  // 2. Sales summary.
  if (includes(prompt, "sales", "summary", "revenue")) {
    if (!has("commas")) {
      return {
        steps: [],
        answer:
          "Commas is turned off as a source for this chat, so I don't have anything to check " +
          "sales against. Enable Commas in the sources menu and ask again.",
        toolSummary: [],
      };
    }
    const steps = [step("commas", "Checking transaction history…"), step("commas", "Checking products…")];
    return {
      steps,
      answer:
        "This month you've done **$18,420** across 62 transactions — up 12% from last month. " +
        "**Pro Coaching Program** is your top seller ($9,800), followed by **1:1 Strategy Call** " +
        "($4,250). 3 refunds totaling $960 were issued, and 1 dispute is currently open (#2481).",
      toolSummary: summarize(steps),
    };
  }

  // 3. Discount codes.
  if (includes(prompt, "discount", "coupon", "promo")) {
    if (!has("commas")) {
      return {
        steps: [],
        answer: "Commas is turned off as a source for this chat — enable it to check discount codes.",
        toolSummary: [],
      };
    }
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

  // 4. Customer lookup.
  if (includes(prompt, "customer", "look up", "lookup", "sarah")) {
    if (!has("commas")) {
      return {
        steps: [],
        answer: "Commas is turned off as a source for this chat — enable it to look up customers.",
        toolSummary: [],
      };
    }
    const steps = [step("commas", "Searching customers…"), step("commas", "Checking transaction history…")];
    return {
      steps,
      answer:
        "**Sarah Johnson** (sarah.johnson@example.com) — customer since Jan 2026. 1 purchase: " +
        "**Pro Coaching Program**, $499, on Feb 3. Payment status: disputed (#2481, \"Product not " +
        "received\", filed Feb 8, due Feb 15). No prior refunds or disputes on this account.",
      toolSummary: summarize(steps),
    };
  }

  // 5. Dispute investigation / evidence draft — the flagship flow. Richer when opened with
  // dispute page context, but answers generically if asked from standalone chat too.
  if (includes(prompt, "dispute", "investigate", "evidence", "draft a response", "chargeback")) {
    const wantsDraft = includes(prompt, "draft", "response");
    const allSteps: ProgressStep[] = [
      step("commas", "Checking dispute record…"),
      step("commas", "Checking customer & transaction…"),
      step("commas", "Checking subscription & access logs…"),
    ];
    const connectedAppSteps: ProgressStep[] = [
      step("fathom", `Searching Fathom calls with ${context ? "the customer" : "Sarah"}…`),
      step("zoom", "Checking Zoom meeting history…"),
      step("google-meet", "Checking Google Meet calendar…"),
      step("clickfunnels", "Checking ClickFunnels order trail…"),
    ].filter((s) => has(s.sourceId));

    const skipped = (["fathom", "zoom", "google-meet", "clickfunnels"] as SourceId[]).filter(
      (id) => !has(id),
    );

    const steps = [...allSteps, ...connectedAppSteps];

    const hasFathom = connectedAppSteps.some((s) => s.sourceId === "fathom");
    const hasZoom = connectedAppSteps.some((s) => s.sourceId === "zoom");
    const hasClickfunnels = connectedAppSteps.some((s) => s.sourceId === "clickfunnels");

    const skippedNote =
      skipped.length > 0
        ? ` I couldn't check ${skipped.map((id) => CONNECTED_APP_LABELS[id]).join(", ")} — ${
            skipped.length === 1 ? "it's" : "they're"
          } turned off for this chat.`
        : "";

    const caseSummary =
      "### Case summary\n\n" +
      "**Dispute #2481 — $499, \"Product not received\"**. Sarah Johnson purchased the Pro " +
      "Coaching Program on Feb 3 and was granted immediate portal access." +
      skippedNote;

    const timelineItems = [
      "- **Feb 3** — Purchase completed, portal access granted (Commas)",
      "- **Feb 3–7** — 4 logins recorded (Commas activity logs)",
    ];
    if (hasFathom) timelineItems.push("- **Feb 4** — 42-minute onboarding call (Fathom)");
    if (hasZoom) timelineItems.push("- **Feb 4** — Matching Zoom join time recorded (Zoom)");
    if (hasFathom) timelineItems.push("- **Feb 6** — Coaching session call (Fathom)");
    if (hasZoom) timelineItems.push("- **Feb 6** — Matching Zoom join time recorded (Zoom)");
    if (hasClickfunnels) timelineItems.push("- **Feb 3** — Checkout completed, no prior chargebacks (ClickFunnels)");
    const timeline = "### Timeline\n\n" + timelineItems.join("\n");

    const evidenceItems = ["- Login activity: 4 sessions between Feb 3–7 (Commas)"];
    if (hasFathom) evidenceItems.push("- Call recordings: onboarding (Feb 4) and coaching session (Feb 6) (Fathom)");
    if (hasZoom) evidenceItems.push("- Meeting log corroborating both sessions (Zoom)");
    if (hasClickfunnels) evidenceItems.push("- Completed order with no prior chargebacks (ClickFunnels)");
    const evidence = "### Evidence\n\n" + evidenceItems.join("\n");

    const draft =
      "### Drafted response\n\n" +
      "\"The customer received full access to the Pro Coaching Program immediately upon " +
      "purchase and logged in 4 times over the following week, including two live coaching " +
      "sessions on Feb 4 and Feb 6. Login timestamps, session recordings, and calendar " +
      "records are attached as evidence.\" You can copy this draft — nothing is submitted " +
      "automatically.";

    const answer = [caseSummary, timeline, evidence, ...(wantsDraft ? [draft] : [])].join("\n\n");

    return {
      steps,
      answer,
      toolSummary: summarize(steps),
    };
  }

  // 6. Fallback — honest about being a scripted demo, not a general assistant.
  return {
    steps: [],
    answer:
      "This preview only knows a handful of demo scenarios right now — try asking about " +
      "sales, discount codes, a customer, or the open dispute, or use one of the suggestions " +
      "below.",
    toolSummary: [],
  };
}
