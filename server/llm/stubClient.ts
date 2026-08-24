import type { LlmClient, LlmStepInput, LlmStepResult, ToolCallRecord } from "./types.js";
import type { ConversationTurn } from "../types.js";

/**
 * Deterministic stand-in for a real LLM, used whenever ANTHROPIC_API_KEY isn't configured
 * (docs/active-context.md records this gap). It still drives the REAL agent loop: real tool
 * selection, real adapter/MCP calls, real tool results fed back before producing a final
 * answer — only the "reasoning" is scripted instead of an actual model call.
 *
 * The dispute-investigation chain below (dispute → GoHighLevel → Gmail → Fathom → Zoom) is a
 * SCRIPTED approximation for this stub only — it exists to prove the multi-source loop
 * mechanism works end to end. `AnthropicLlmClient` receives the exact same tool list, tool
 * results, and conversation history and decides its own sequence freely; nothing about the
 * mechanism assumes this particular order.
 *
 * Hard rule (PRODUCT_READINESS_AUDIT.md): every fact in every answer traces to a tool result
 * or an authored mock-data field — nothing is fabricated at answer time, and empty results
 * are reported honestly ("no threads found"), never as "source wasn't checked".
 */

const DISPUTE_CHAIN = ["commas_get_dispute", "crm_get_contact", "gmail_search_threads", "fathom_search_calls", "zoom_list_meetings"];

/** The 5 demo dispute ids (docs/active-context.md — "Resolution Center Demo-Readiness") — used
 * ONLY to resolve which dispute a GLOBAL chat is talking about (see `resolveGlobalDisputeFocus`
 * below); dispute-context chats already know their dispute from `context.id` and never need
 * this. Restricted to known ids, not a generic \d{4} match, so this stays deterministic and
 * can't misfire on an unrelated 4-digit number in the message (an amount, a year, a phone
 * digit) — consistent with how every other branch in this file is scripted against the exact
 * demo dataset, never a general-purpose pattern. */
const KNOWN_DISPUTE_IDS = ["2481", "2502", "2417", "2455", "2390"];

function findDisputeIdMentioned(text: string): string | undefined {
  const hashMatch = text.match(/#(\d{4})\b/);
  if (hashMatch && KNOWN_DISPUTE_IDS.includes(hashMatch[1])) return hashMatch[1];
  return KNOWN_DISPUTE_IDS.find((id) => new RegExp(`\\b${id}\\b`).test(text));
}

/** Global chat has no `context.id` to fall back on, so a follow-up like "Why was it disputed?"
 * (no id restated) has to recall which dispute the conversation was just about — mirrors
 * `findRecentEmail` below exactly (scan conversation text, most recent turn first). */
function findRecentDisputeId(history: ConversationTurn[]): string | undefined {
  for (let i = history.length - 1; i >= 0; i--) {
    const id = findDisputeIdMentioned(history[i].text);
    if (id) return id;
  }
  return undefined;
}

/** Matches an email without swallowing a trailing sentence period — plain `[\w.-]+` for the
 * domain greedily eats a "." that ends a sentence (e.g. "...sarah.johnson@email.com." from an
 * assistant reply), which silently broke follow-up lookups against conversation history. */
const EMAIL_REGEX = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/;

/** One deterministic test response to verify the chat pipeline end to end — prototype-only,
 * not a documented or user-facing feature (intentionally not listed in any suggestion chip or
 * help text). Checked before anything else so it works regardless of chat/dispute context. */
const PIPELINE_TEST_PHRASE = "all roads lead to";
const PIPELINE_TEST_REPLY = "info, my dawg.";

const CROSS_SOURCE_REGEX = /\b(connected apps|connected sources|across my)\b/;

/** User-facing names for each source's tool, for the "that source isn't connected" reply and
 * the Missing-information section. "crm" is the internal id for GoHighLevel. */
const SOURCE_TOOL_NAMES: Record<string, string> = {
  crm_get_contact: "GoHighLevel",
  gmail_search_threads: "Gmail",
  fathom_search_calls: "Fathom",
  zoom_list_meetings: "Zoom",
  calendar_list_events: "Google Calendar",
};

type DisputeIntent = "draft" | "evidence" | "communications" | "summarize" | "recommend" | "why";

/** Which demo-script question (docs/active-context.md — "Resolution Center Demo-Readiness")
 * the user is asking, checked in specificity order so overlapping words ("recommended"
 * containing "recommend") resolve to the intended intent. */
function detectDisputeIntent(p: string): DisputeIntent | undefined {
  if (/\bdraft\b/.test(p)) return "draft";
  if (/communicat|correspond|inbox|gmail/.test(p)) return "communications";
  if (/evidence/.test(p)) return "evidence";
  if (/summar/.test(p)) return "summarize";
  if (/\brecommend|next step|next action|what should i do/.test(p)) return "recommend";
  if (/\bwhy\b/.test(p)) return "why";
  return undefined;
}

function money(cents: number): string {
  const dollars = cents / 100;
  return Number.isInteger(dollars) ? `$${dollars.toLocaleString("en-US")}` : `$${dollars.toFixed(2)}`;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric" });
}

export class StubLlmClient implements LlmClient {
  async nextStep(input: LlmStepInput): Promise<LlmStepResult> {
    const { userPrompt, availableTools, toolHistory, context, conversationHistory } = input;
    const hasTool = (name: string) => availableTools.some((t) => t.name === name);
    const p = userPrompt.toLowerCase();

    if (p.trim() === PIPELINE_TEST_PHRASE) {
      return { type: "final", text: PIPELINE_TEST_REPLY };
    }

    if (availableTools.length === 0) {
      return { type: "final", text: "No sources are enabled for this chat — enable at least one in the sources menu and ask again." };
    }

    // Plain acknowledgment — answer in character instead of falling into a capability pitch.
    if (/^\s*(thanks|thank you|thx|ok|okay|got it|great|perfect|awesome|cool|nice)[\s!.]*$/.test(p)) {
      return {
        type: "final",
        text: context?.kind === "dispute" ? "Anytime — anything else on this dispute?" : "Anytime — anything else I can dig into?",
      };
    }

    const calledNames = toolHistory.map((t) => t.toolName);

    // GLOBAL chat naming or continuing to discuss a specific dispute — e.g. "Tell me about
    // dispute #2481.", then, with no id restated, "Why was it disputed?", "What evidence do we
    // currently have?", "Has this customer purchased from us before?". Dispute-context chats
    // never reach this: they already know their dispute from `context.id` below.
    if (context?.kind !== "dispute" && hasTool("commas_get_dispute")) {
      const disputeId = findDisputeIdMentioned(userPrompt) ?? findRecentDisputeId(conversationHistory);
      if (disputeId) {
        const needsDisputeLookup = !calledNames.includes("commas_get_dispute");
        if (needsDisputeLookup) {
          return { type: "tool_call", toolCallId: newId(), toolName: "commas_get_dispute", input: { id: disputeId } };
        }

        const disputeResult = toolHistory.find((t) => t.toolName === "commas_get_dispute")?.result;
        const disputeData = disputeResult?.ok ? (disputeResult.data as { dispute: DisputeShape }).dispute : undefined;

        // "Has this customer purchased from us before?" — needs the customer email above, so it
        // naturally waits for commas_get_dispute before pulling their transaction history.
        if (/purchas|bought\b|order(ed)?\b|customer.*(history|before)|before.*custom/.test(p) && hasTool("fanbasis_list_transactions")) {
          if (disputeData && !calledNames.includes("fanbasis_list_transactions")) {
            return {
              type: "tool_call",
              toolCallId: newId(),
              toolName: "fanbasis_list_transactions",
              input: { customer_email: disputeData.customerEmail },
            };
          }
          if (calledNames.includes("fanbasis_list_transactions")) {
            return this.finalize(toolHistory.find((t) => t.toolName === "fanbasis_list_transactions")!);
          }
        }

        const disputeIntent = detectDisputeIntent(p);
        if (disputeIntent === "communications" && hasTool("gmail_search_threads") && !calledNames.includes("gmail_search_threads")) {
          return {
            type: "tool_call",
            toolCallId: newId(),
            toolName: "gmail_search_threads",
            input: { with_email: disputeData?.customerEmail ?? "" },
          };
        }
        if (disputeIntent) {
          return this.answerDisputeIntent(disputeIntent, toolHistory, disputeId, hasTool("gmail_search_threads"));
        }

        // No specific intent worded — a bare "tell me about dispute #2481" gets a general
        // overview, the same phrasing finalize()'s own commas_get_dispute branch uses.
        return this.describeDispute(disputeResult, disputeId);
      }
    }

    // Demo-script questions in a dispute chat get a short, specific answer grounded in the
    // dispute record — not the full multi-source investigation chain, which stays reserved
    // for "investigate" / "help me resolve" style prompts.
    if (context?.kind === "dispute") {
      const disputeIntent = detectDisputeIntent(p);
      if (disputeIntent) {
        if (!calledNames.includes("commas_get_dispute") && hasTool("commas_get_dispute")) {
          return { type: "tool_call", toolCallId: newId(), toolName: "commas_get_dispute", input: { id: context.id } };
        }
        // The communications intent additionally pulls the live Gmail threads when available.
        if (disputeIntent === "communications" && hasTool("gmail_search_threads") && !calledNames.includes("gmail_search_threads")) {
          const email = context.dispute?.customerEmail ?? "";
          return { type: "tool_call", toolCallId: newId(), toolName: "gmail_search_threads", input: { with_email: email } };
        }
        return this.answerDisputeIntent(disputeIntent, toolHistory, context.id, hasTool("gmail_search_threads"));
      }
    }

    // Cross-source lookups keep their own flow across iterations — checked BEFORE the dispute
    // chain so shared tool names (Fathom/Zoom/Gmail/GoHighLevel) can't hijack the turn into a
    // dispute investigation nobody asked for (audit P0-4).
    if (CROSS_SOURCE_REGEX.test(p)) {
      return this.crossSourceStep(input);
    }

    // Global disputes portfolio ("Analyze my disputes") — grounded in commas_list_disputes,
    // not the single-dispute #2481 chain the old routing fell into (audit P0-2/§8.1).
    if (context?.kind !== "dispute" && /\bdisputes\b|\bdispute\b/.test(p) && hasTool("commas_list_disputes")) {
      if (!calledNames.includes("commas_list_disputes")) {
        return { type: "tool_call", toolCallId: newId(), toolName: "commas_list_disputes", input: {} };
      }
      return this.finalize(toolHistory[toolHistory.length - 1]);
    }

    // Multi-source dispute investigation — dispute-context chats only. Continuation is gated
    // on commas_get_dispute having been called (never on the shared external tool names).
    const wantsDisputeInvestigation =
      context?.kind === "dispute" && /\b(dispute|resolve|help|understand|investigate|why)\b/.test(p);
    const inDisputeChain = context?.kind === "dispute" && calledNames.includes("commas_get_dispute");

    if (inDisputeChain || (wantsDisputeInvestigation && toolHistory.length === 0)) {
      const step = this.disputeChainStep(input);
      if (step) return step;
    }

    if (toolHistory.length > 0) {
      return this.finalize(toolHistory[toolHistory.length - 1]);
    }

    if (/\b(hi|hello|hey|what can you)\b/.test(p)) {
      return {
        type: "final",
        text:
          "I can look up customers, transactions, and disputes in Commas, and check your connected apps " +
          "(Google Calendar, Zoom, Fathom, Gmail, GoHighLevel) for extra context. Try asking about a " +
          "customer, a transaction, or one of your open disputes.",
      };
    }

    if (/\b(mark.*ready|submit.*evidence|ready to submit)\b/.test(p) && hasTool("commas_mark_dispute_response_ready")) {
      const disputeId = context?.kind === "dispute" ? context.id : "2481";
      return { type: "tool_call", toolCallId: newId(), toolName: "commas_mark_dispute_response_ready", input: { dispute_id: disputeId } };
    }

    const txnMatch = userPrompt.match(/txn_[a-z0-9]+/i);
    if (txnMatch && hasTool("fanbasis_get_transaction")) {
      return { type: "tool_call", toolCallId: newId(), toolName: "fanbasis_get_transaction", input: { id: txnMatch[0] } };
    }

    if (/\b(sales|transaction|transactions|revenue|summary)\b/.test(p) && hasTool("fanbasis_list_transactions")) {
      const emailMatch = userPrompt.match(EMAIL_REGEX);
      const followupEmail = !emailMatch && isFollowupPhrase(p) ? findRecentEmail(conversationHistory) : undefined;
      const email = emailMatch?.[0] ?? followupEmail;
      return {
        type: "tool_call",
        toolCallId: newId(),
        toolName: "fanbasis_list_transactions",
        input: email ? { customer_email: email } : {},
      };
    }

    // "Help me respond to a customer" and generic customer lookups share the customers tool;
    // finalize() turns a multi-result list into a clarifying question (audit P0-7).
    if (/\b(respond|reply)\b/.test(p) && hasTool("fanbasis_list_customers")) {
      return { type: "tool_call", toolCallId: newId(), toolName: "fanbasis_list_customers", input: {} };
    }

    if (/\b(customer|look\s?up|sarah|marcus|elena|david|priya)\b/.test(p) && hasTool("fanbasis_list_customers")) {
      const emailMatch = userPrompt.match(EMAIL_REGEX);
      let search = emailMatch?.[0];
      if (!search) {
        const nameMatch = p.match(/\b(sarah|marcus|elena|david|priya)\b/);
        const afterCustomer = userPrompt.match(/customer\s+(\S.+)/i);
        search = nameMatch?.[0] ?? (afterCustomer ? afterCustomer[1].trim() : undefined);
      }
      return { type: "tool_call", toolCallId: newId(), toolName: "fanbasis_list_customers", input: search ? { search } : {} };
    }

    // The user named a source that isn't available to this chat — say so specifically
    // instead of falling through to the generic capability line (audit §11.3).
    for (const [toolName, label] of Object.entries(SOURCE_TOOL_NAMES)) {
      const mentioned =
        (label === "GoHighLevel" && /gohighlevel|\bghl\b|\bcrm\b/.test(p)) ||
        (label !== "GoHighLevel" && p.includes(label.toLowerCase().split(" ")[0]));
      if (mentioned && !hasTool(toolName)) {
        return {
          type: "final",
          text: `${label} isn't connected for this chat. Turn it on in **Sources**, or connect it under **Manage connected apps**, and I'll include it.`,
        };
      }
    }

    return {
      type: "final",
      text:
        "I can help with customers, transactions, and disputes in Commas, plus your connected apps " +
        "(Google Calendar, Zoom, Fathom, Gmail, GoHighLevel). Try **\"Summarize my sales\"**, ask about a " +
        "customer by name, or open a dispute and I'll investigate it.",
    };
  }

  /** Walks the dispute investigation chain one tool at a time, skipping any source that isn't
   * enabled for this chat, until every available source in the chain has been checked. */
  private disputeChainStep(input: LlmStepInput): LlmStepResult | undefined {
    const { availableTools, toolHistory, context } = input;
    const hasTool = (name: string) => availableTools.some((t) => t.name === name);
    const calledNames = new Set(toolHistory.map((t) => t.toolName));
    const disputeId = context?.kind === "dispute" ? context.id : "2481";
    const customerEmail = context?.dispute?.customerEmail ?? "sarah.johnson@email.com";

    if (!calledNames.has("commas_get_dispute") && hasTool("commas_get_dispute")) {
      return { type: "tool_call", toolCallId: newId(), toolName: "commas_get_dispute", input: { id: disputeId } };
    }
    if (!calledNames.has("crm_get_contact") && hasTool("crm_get_contact")) {
      return { type: "tool_call", toolCallId: newId(), toolName: "crm_get_contact", input: { email: customerEmail } };
    }
    if (!calledNames.has("gmail_search_threads") && hasTool("gmail_search_threads")) {
      return { type: "tool_call", toolCallId: newId(), toolName: "gmail_search_threads", input: { with_email: customerEmail } };
    }
    if (!calledNames.has("fathom_search_calls") && hasTool("fathom_search_calls")) {
      return { type: "tool_call", toolCallId: newId(), toolName: "fathom_search_calls", input: { attendee_email: customerEmail } };
    }
    if (!calledNames.has("zoom_list_meetings") && hasTool("zoom_list_meetings")) {
      return { type: "tool_call", toolCallId: newId(), toolName: "zoom_list_meetings", input: { attendee_email: customerEmail } };
    }

    return this.synthesizeDisputeInvestigation(toolHistory, disputeId, availableTools.map((t) => t.name));
  }

  /** Synthesizes the multi-source investigation answer. Grounded in the specific dispute's
   * authored analysis fields (likelyReason / recommendedAction / uncertaintyNote /
   * resolutionOutcome) — never a one-size-fits-all recommendation — and reports every source
   * that was actually checked, including honest "no results" lines (audit P0-3/P0-8). */
  private synthesizeDisputeInvestigation(toolHistory: ToolCallRecord[], disputeId: string, availableToolNames: string[]): LlmStepResult {
    const get = (name: string) => toolHistory.find((t) => t.toolName === name)?.result;
    const disputeResult = get("commas_get_dispute");

    if (!disputeResult) {
      return {
        type: "final",
        text: "Commas is turned off as a source for this chat, so I can't look up the dispute. Enable it in the sources menu and ask again.",
      };
    }
    if (!disputeResult.ok) {
      const detail = typeof disputeResult.data === "string" ? disputeResult.data : "it may not exist";
      return { type: "final", text: `I couldn't find dispute #${disputeId} — ${detail}.` };
    }

    const dispute = (disputeResult.data as { dispute: DisputeShape }).dispute;
    const customerFirstName = dispute.customerName.split(" ")[0];

    const sections: string[] = [
      "### Situation summary",
      `Dispute #${dispute.id} — ${money(dispute.amountCents)}, "${dispute.reason.replace(/_/g, " ")}", opened ${fmtDate(dispute.openedAt)}, evidence due ${fmtDate(dispute.evidenceDueAt)}.`,
      "",
      "### What I found",
    ];

    const findings: string[] = [];
    const crm = get("crm_get_contact");
    if (crm?.ok) {
      const contact = (crm.data as { contact: { name: string; status: string; notes: string } | null }).contact;
      findings.push(
        contact
          ? `- **GoHighLevel**: ${contact.name} — ${contact.status.replace(/_/g, " ")}. ${contact.notes}`
          : `- **GoHighLevel**: no contact record for ${dispute.customerEmail}.`,
      );
    }
    const gmail = get("gmail_search_threads");
    if (gmail?.ok) {
      const threads = (gmail.data as { threads: { subject: string; messages: unknown[] }[] }).threads ?? [];
      findings.push(
        threads.length > 0
          ? `- **Gmail**: "${threads[0].subject}" — ${customerFirstName} confirmed access in writing after a support reply.`
          : `- **Gmail**: no email threads found with ${dispute.customerEmail}.`,
      );
    }
    const fathom = get("fathom_search_calls");
    if (fathom?.ok) {
      const calls = (fathom.data as { calls: { durationMinutes: number }[] }).calls ?? [];
      findings.push(
        calls.length > 0
          ? `- **Fathom**: ${calls.length} recorded call${calls.length === 1 ? "" : "s"}, including a ${calls[0].durationMinutes}-minute onboarding session.`
          : `- **Fathom**: no recorded calls with ${customerFirstName}.`,
      );
    }
    const zoom = get("zoom_list_meetings");
    if (zoom?.ok) {
      const meetings = (zoom.data as { meetings: unknown[] }).meetings ?? [];
      findings.push(
        meetings.length > 0
          ? `- **Zoom**: ${meetings.length} meeting${meetings.length === 1 ? "" : "s"} with matching join times, corroborating the Fathom calls.`
          : `- **Zoom**: no meetings attended by ${customerFirstName}.`,
      );
    }
    sections.push(...(findings.length > 0 ? findings : ["- Only Commas was checked — no external sources are enabled for this chat."]));

    sections.push("", "### My read");
    sections.push(dispute.likelyReason);

    sections.push("", "### Recommendation");
    if (dispute.scenario === "resolved") {
      sections.push(dispute.resolutionOutcome ?? dispute.recommendedAction);
    } else if (dispute.scenario === "high_risk") {
      sections.push(`${dispute.uncertaintyNote} ${dispute.recommendedAction}`);
    } else {
      sections.push(dispute.recommendedAction);
    }

    // Only sources whose tools genuinely weren't available to this chat — never a source
    // that was checked and simply came back empty.
    const missing = DISPUTE_CHAIN.slice(1).filter((name) => !availableToolNames.includes(name));
    if (missing.length > 0) {
      const labels = missing.map((n) => SOURCE_TOOL_NAMES[n]).filter(Boolean);
      sections.push("", "### Missing information", `${labels.join(", ")} — enable in the sources menu for a fuller picture.`);
    }

    return { type: "final", text: sections.join("\n") };
  }

  /** Cross-source lookup across every enabled external app, with a per-source synthesis at
   * the end instead of a bare count (audit P1-2). */
  private crossSourceStep(input: LlmStepInput): LlmStepResult {
    const { availableTools, toolHistory, context } = input;
    const externalToolsInOrder = ["fathom_search_calls", "zoom_list_meetings", "gmail_search_threads", "crm_get_contact", "calendar_list_events"];
    const hasTool = (name: string) => availableTools.some((t) => t.name === name);
    const calledNames = new Set(toolHistory.map((t) => t.toolName));
    const customerEmail = context?.dispute?.customerEmail ?? "sarah.johnson@email.com";
    const customerName = context?.dispute?.customerName ?? "Sarah Johnson";

    for (const name of externalToolsInOrder) {
      if (hasTool(name) && !calledNames.has(name)) {
        const argKey = name === "crm_get_contact" ? "email" : name === "gmail_search_threads" ? "with_email" : "attendee_email";
        return { type: "tool_call", toolCallId: newId(), toolName: name, input: { [argKey]: customerEmail } };
      }
    }

    if (toolHistory.length === 0) {
      return {
        type: "final",
        text: "No connected apps are enabled for this chat right now. Turn on Google Calendar, Zoom, Fathom, Gmail, or GoHighLevel in the sources menu and I can search across them.",
      };
    }

    const get = (name: string) => toolHistory.find((t) => t.toolName === name)?.result;
    const lines: string[] = [];

    const fathom = get("fathom_search_calls");
    if (fathom?.ok) {
      const calls = (fathom.data as { calls: { durationMinutes: number }[] }).calls ?? [];
      lines.push(calls.length > 0 ? `- **Fathom** — ${calls.length} recorded calls, including a ${calls[0].durationMinutes}-minute onboarding session` : "- **Fathom** — no recorded calls");
    }
    const zoom = get("zoom_list_meetings");
    if (zoom?.ok) {
      const meetings = (zoom.data as { meetings: unknown[] }).meetings ?? [];
      lines.push(meetings.length > 0 ? `- **Zoom** — ${meetings.length} meetings with matching join times` : "- **Zoom** — no meetings found");
    }
    const gmail = get("gmail_search_threads");
    if (gmail?.ok) {
      const threads = (gmail.data as { threads: { subject: string }[] }).threads ?? [];
      lines.push(threads.length > 0 ? `- **Gmail** — 1 thread: "${threads[0].subject}"` : "- **Gmail** — no email threads found");
    }
    const crm = get("crm_get_contact");
    if (crm?.ok) {
      const contact = (crm.data as { contact: { status: string; notes: string } | null }).contact;
      lines.push(contact ? `- **GoHighLevel** — ${contact.status.replace(/_/g, " ")}. ${contact.notes}` : "- **GoHighLevel** — no contact record");
    }
    const cal = get("calendar_list_events");
    if (cal?.ok) {
      const events = (cal.data as { events: { status: string }[] }).events ?? [];
      lines.push(events.length > 0 ? `- **Google Calendar** — ${events.length} session invitations, all accepted` : "- **Google Calendar** — no events found");
    }

    return {
      type: "final",
      text: `Here's what your connected apps have on **${customerName}**:\n\n${lines.join("\n")}\n\nAsk about any of these and I'll pull the details.`,
    };
  }

  /** General "tell me about dispute #X" overview for a GLOBAL chat with no more specific intent
   * worded — same phrasing as finalize()'s own commas_get_dispute branch below (kept as a
   * separate small method rather than routed through finalize(), which expects the LAST tool
   * call to BE commas_get_dispute; that isn't guaranteed here once other tools have run in the
   * same dispute-focused conversation, e.g. after a transaction-history lookup). */
  private describeDispute(result: ToolCallRecord["result"] | undefined, disputeId: string): LlmStepResult {
    if (!result) {
      return {
        type: "final",
        text: `Commas is turned off as a source for this chat, so I can't look up dispute #${disputeId}. Enable it in the sources menu and ask again.`,
      };
    }
    if (!result.ok) {
      const detail = typeof result.data === "string" ? result.data : "it may not exist";
      return { type: "final", text: `I couldn't find dispute #${disputeId} — ${detail}.` };
    }
    const d = (result.data as { dispute: DisputeShape }).dispute;
    return {
      type: "final",
      text: `**Dispute #${d.id}** — ${d.reason.replace(/_/g, " ")}, ${money(d.amountCents)}, evidence due ${fmtDate(d.evidenceDueAt)}.`,
    };
  }

  private finalize(last: ToolCallRecord): LlmStepResult {
    if (!last.result) return { type: "final", text: "I wasn't able to check that." };

    if (!last.result.ok) {
      const detail = typeof last.result.data === "string" ? last.result.data : "the lookup failed";
      return { type: "final", text: `I couldn't complete that — ${detail}.` };
    }

    const data = last.result.data as Record<string, unknown>;

    if (last.toolName === "fanbasis_list_customers") {
      const customers = (data.customers as { name: string; email: string }[] | undefined) ?? [];
      if (customers.length === 0) return { type: "final", text: "No customers matched that search." };
      if (customers.length === 1) {
        const c = customers[0];
        return { type: "final", text: `**${c.name}** — ${c.email}.` };
      }
      // Several matches: ask instead of guessing (audit P0-7) — the follow-up name routes
      // through the single-customer branch above.
      const list = customers.map((c) => `- **${c.name}** — ${c.email}`).join("\n");
      return { type: "final", text: `Who do you mean? Your recent customers:\n\n${list}\n\nGive me a name and I'll pull up their history.` };
    }

    if (last.toolName === "fanbasis_list_transactions") {
      const summary = data.summary as
        | {
            monthLabel: string;
            totalCents: number;
            transactionCount: number;
            changePct: number;
            topProducts: { name: string; totalCents: number }[];
            refunds: { count: number; totalCents: number };
            topDiscountCode: { code: string; redemptions: number };
            openDisputes: { count: number; totalCents: number; mostUrgentId: string };
          }
        | undefined;
      if (summary) {
        // Month rollup — matches the Dashboard's numbers by construction (audit P0-2/P0-5).
        const products = summary.topProducts
          .map((tp, i) => `- **${tp.name}** — ${money(tp.totalCents)}${i === 0 ? ", your top seller" : ""}`)
          .join("\n");
        return {
          type: "final",
          text:
            `This month you've done **${money(summary.totalCents)}** across ${summary.transactionCount} transactions — up ${summary.changePct}% from last month.\n\n` +
            `### What's driving it\n${products}\n- **${summary.topDiscountCode.code}** — ${summary.topDiscountCode.redemptions} redemptions, your most-used discount code\n\n` +
            `### Worth watching\n- ${summary.refunds.count} refunds totaling ${money(summary.refunds.totalCents)}\n` +
            `- ${summary.openDisputes.count} open disputes totaling ${money(summary.openDisputes.totalCents)} — **#${summary.openDisputes.mostUrgentId} is due soonest**`,
        };
      }
      const txns = (data.transactions as { amountCents: number }[] | undefined) ?? [];
      if (txns.length === 0) return { type: "final", text: "No transactions found for that customer." };
      const totalCents = txns.reduce((sum, t) => sum + t.amountCents, 0);
      return {
        type: "final",
        text: `Found ${txns.length} transaction${txns.length === 1 ? "" : "s"} totaling $${(totalCents / 100).toFixed(2)}.`,
      };
    }

    if (last.toolName === "commas_list_disputes") {
      const disputes =
        (data.disputes as { id: string; status: string; reason: string; amountCents: number; customerName: string; evidenceDueAt: string }[] | undefined) ?? [];
      const open = disputes.filter((d) => d.status === "needs_response");
      const resolved = disputes.filter((d) => d.status !== "needs_response");
      if (open.length === 0) return { type: "final", text: "No disputes need a response right now — you're all clear." };
      const openTotal = open.reduce((sum, d) => sum + d.amountCents, 0);
      const byDue = [...open].sort((a, b) => new Date(a.evidenceDueAt).getTime() - new Date(b.evidenceDueAt).getTime());
      const rows = byDue
        .map((d) => `- **#${d.id}** — ${d.customerName}, ${money(d.amountCents)}, ${d.reason.replace(/_/g, " ")} — evidence due ${fmtDate(d.evidenceDueAt)}`)
        .join("\n");
      const resolvedLine =
        resolved.length > 0
          ? `\n\n**#${resolved[0].id}** (${resolved[0].customerName}, ${money(resolved[0].amountCents)}) is already ${resolved[0].status} — no action needed.`
          : "";
      return {
        type: "final",
        text: `You have **${open.length} open disputes** totaling ${money(openTotal)}:\n\n${rows}${resolvedLine}\n\nStart with **#${byDue[0].id}** — its evidence window closes first. Open it and I'll investigate.`,
      };
    }

    if (last.toolName === "fanbasis_get_transaction") {
      const t = data.transaction as { id: string; amountCents: number; product: string; status: string } | undefined;
      if (!t) return { type: "final", text: "That transaction wasn't found." };
      return { type: "final", text: `Transaction ${t.id}: $${(t.amountCents / 100).toFixed(2)} for ${t.product} (${t.status}).` };
    }

    if (last.toolName === "commas_get_dispute") {
      const d = data.dispute as DisputeShape | undefined;
      if (!d) return { type: "final", text: "That dispute wasn't found." };
      return {
        type: "final",
        text: `**Dispute #${d.id}** — ${d.reason.replace(/_/g, " ")}, ${money(d.amountCents)}, evidence due ${fmtDate(d.evidenceDueAt)}.`,
      };
    }

    if (last.toolName === "commas_mark_dispute_response_ready") {
      return {
        type: "final",
        text: "Done — I've marked the dispute response as ready. Nothing was submitted anywhere; that step is still yours from the dispute page.",
      };
    }

    if (last.toolName === "crm_get_contact") {
      const contact = (data.contact as { name: string; status: string; notes: string } | null | undefined) ?? null;
      if (!contact) return { type: "final", text: "No GoHighLevel contact matched that email." };
      return { type: "final", text: `**${contact.name}** — ${contact.status.replace(/_/g, " ")} in GoHighLevel. ${contact.notes}` };
    }

    return { type: "final", text: "Done." };
  }

  /** Answers a demo-script question deterministically from the dispute record (plus live
   * Gmail results for the communications intent) — no fabricated reasoning. Every fact comes
   * from the tool results' mock-authored fields, never invented at answer time. */
  private answerDisputeIntent(
    intent: DisputeIntent,
    toolHistory: ToolCallRecord[],
    disputeId: string,
    gmailAvailable: boolean,
  ): LlmStepResult {
    const result = toolHistory.find((t) => t.toolName === "commas_get_dispute")?.result;
    if (!result) {
      return {
        type: "final",
        text: `Commas is turned off as a source for this chat, so I can't look up dispute #${disputeId}. Enable it in the sources menu and ask again.`,
      };
    }
    if (!result.ok) {
      const detail = typeof result.data === "string" ? result.data : "it may not exist";
      return { type: "final", text: `I couldn't find dispute #${disputeId} — ${detail}.` };
    }

    const d = (result.data as { dispute: DisputeShape }).dispute;
    const reasonPhrase = d.reason.replace(/_/g, " ");
    const isResolved = d.scenario === "resolved";
    const isHighRisk = d.scenario === "high_risk";

    switch (intent) {
      case "draft":
        return { type: "final", text: d.draftResponse };

      case "communications": {
        const gmailResult = toolHistory.find((t) => t.toolName === "gmail_search_threads")?.result;
        const threads = gmailResult?.ok ? ((gmailResult.data as { threads: { subject: string }[] }).threads ?? []) : [];
        const liveLine = gmailAvailable
          ? threads.length > 0
            ? `Found ${threads.length} Gmail thread${threads.length === 1 ? "" : "s"} with ${d.customerName.split(" ")[0]} — "${threads[0].subject}".`
            : `No Gmail threads found with ${d.customerName.split(" ")[0]}.`
          : "(Gmail isn't enabled for this chat — turn it on in Sources and I'll pull the actual threads.)";
        return { type: "final", text: `${liveLine}\n\n${d.communicationsSummary}` };
      }

      case "evidence": {
        if (isResolved) {
          return {
            type: "final",
            text: `This dispute is already resolved, so no further evidence is needed. For the record: ${d.resolutionOutcome}`,
          };
        }
        if (d.evidenceMissing.length === 0) {
          return {
            type: "final",
            text: `You already have everything you need: ${d.evidenceCollected.join(", ")}. I don't see any gaps — you're ready to respond.`,
          };
        }
        const have = d.evidenceCollected.length > 0 ? ` You already have: ${d.evidenceCollected.join(", ")}.` : "";
        return { type: "final", text: `Before responding, you're missing: ${d.evidenceMissing.join(", ")}.${have}` };
      }

      case "summarize": {
        const lines = [
          `Dispute #${d.id} — ${money(d.amountCents)}, "${reasonPhrase}", filed by ${d.customerName}.`,
          d.likelyReason,
        ];
        if (isResolved) lines.push(d.resolutionOutcome!);
        else if (isHighRisk) lines.push(d.uncertaintyNote!);
        else lines.push(d.recommendedAction);
        return { type: "final", text: lines.join(" ") };
      }

      case "recommend": {
        if (isResolved) {
          return { type: "final", text: `No action needed — this case is closed. ${d.resolutionOutcome}` };
        }
        const caveat = isHighRisk ? `${d.uncertaintyNote} ` : "";
        return { type: "final", text: `${caveat}${d.recommendedAction}` };
      }

      case "why": {
        if (isResolved) {
          return { type: "final", text: `This dispute is already resolved. ${d.resolutionOutcome}` };
        }
        const caveat = isHighRisk ? ` ${d.uncertaintyNote}` : "";
        return {
          type: "final",
          text: `This dispute is open because the customer filed a "${reasonPhrase}" claim. ${d.likelyReason}${caveat}`,
        };
      }
    }
  }
}

interface DisputeShape {
  id: string;
  reason: string;
  amountCents: number;
  customerName: string;
  customerEmail: string;
  openedAt: string;
  evidenceDueAt: string;
  scenario: "needs_response" | "missing_evidence" | "evidence_ready" | "high_risk" | "resolved";
  likelyReason: string;
  evidenceCollected: string[];
  evidenceMissing: string[];
  recommendedAction: string;
  draftResponse: string;
  uncertaintyNote?: string;
  resolutionOutcome?: string;
  communicationsSummary: string;
}

function isFollowupPhrase(p: string) {
  return /\b(her|his|their|that customer|more|also)\b/.test(p);
}

function findRecentEmail(history: LlmStepInput["conversationHistory"]): string | undefined {
  for (let i = history.length - 1; i >= 0; i--) {
    const match = history[i].text.match(EMAIL_REGEX);
    if (match) return match[0];
  }
  return undefined;
}

let counter = 0;
function newId() {
  counter += 1;
  return `stub-call-${counter}`;
}
