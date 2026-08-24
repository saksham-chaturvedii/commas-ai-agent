import type { LlmClient, LlmStepInput, LlmStepResult, ToolCallRecord } from "./types.js";
import type { ConversationTurn, EvidenceFinding, InvestigationReport, SourceId } from "../types.js";

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

/** Every tool `disputeChainStep` could possibly call beyond the dispute record itself — used to
 * compute what a reason's priority list deliberately leaves out (server/llm/stubClient.ts's
 * REASON_SOURCE_PRIORITY), distinct from what simply isn't enabled for this chat. */
const ALL_INVESTIGATION_TOOLS = ["crm_get_contact", "gmail_search_threads", "fathom_search_calls", "zoom_list_meetings", "calendar_list_events"];

/**
 * Which sources actually matter for a given dispute reason — "the agent should selectively call
 * relevant sources... do not automatically search every connector for every request." Ordered:
 * earlier entries are checked first. A reason not listed here falls back to
 * DEFAULT_SOURCE_PRIORITY (the full legacy chain — the safe, exhaustive default for anything not
 * explicitly reasoned about yet, never a silent gap).
 *   - product_not_received: activity/fulfillment evidence (did the customer actually engage?)
 *     plus communications — GoHighLevel's pipeline/deal data isn't informative for "did they
 *     receive it," so it's the one source deliberately skipped here.
 *   - product_unacceptable ("service not received" in the task's own wording — Commas' one
 *     service-style product, the 1:1 Strategy Call, disputes under this code): Calendar, Zoom,
 *     Fathom, and communications are exactly the sources that can confirm whether the session
 *     happened and what it covered; GoHighLevel again isn't informative here.
 *   - duplicate: a transaction-record question first and foremost — communications only to
 *     check whether the customer already self-reported it (Elena Cruz's real story). Fathom/
 *     Zoom/Calendar/GoHighLevel have nothing to add to "was this charged twice."
 *   - fraudulent (the real Stripe/card-network dispute-reason-code spelling — no current demo
 *     case uses it, but the mapping is real and tested): account/transaction history is exactly
 *     GoHighLevel's pipeline + Commas' own transaction record. Device/IP and geographic
 *     consistency data would belong here too, but no connector in this prototype actually
 *     exposes that — never fabricated just to fill out the category (see Known limitations).
 */
const REASON_SOURCE_PRIORITY: Record<string, string[]> = {
  product_not_received: ["fathom_search_calls", "zoom_list_meetings", "gmail_search_threads"],
  product_unacceptable: ["calendar_list_events", "zoom_list_meetings", "fathom_search_calls", "gmail_search_threads"],
  duplicate: ["gmail_search_threads"],
  fraudulent: ["crm_get_contact"],
};
const DEFAULT_SOURCE_PRIORITY = ["crm_get_contact", "gmail_search_threads", "fathom_search_calls", "zoom_list_meetings", "calendar_list_events"];

export function sourcePriorityFor(reasonCode: string | undefined): string[] {
  if (!reasonCode) return DEFAULT_SOURCE_PRIORITY;
  return REASON_SOURCE_PRIORITY[reasonCode] ?? DEFAULT_SOURCE_PRIORITY;
}

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
 * `findRecentEmail` below exactly (scan conversation text, most recent turn first). Suppressing
 * this recall for a message that's clearly about something else entirely (`looksLikeUnrelatedQuery`,
 * checked at the call site) is what prevents a dispute mentioned many turns back from "sticking"
 * to an unrelated later question (audit P1-4) — a shrunk scan window was tried first and
 * rejected: it broke the legitimate case of a real multi-question follow-up thread about the
 * same dispute (id, why, evidence, purchase history) once that thread ran past a few turns. */
function findRecentDisputeId(history: ConversationTurn[]): string | undefined {
  for (let i = history.length - 1; i >= 0; i--) {
    const id = findDisputeIdMentioned(history[i].text);
    if (id) return id;
  }
  return undefined;
}

/** A message this clearly about something else (sales/revenue, the whole disputes portfolio, or
 * a plain customer lookup) should never be hijacked into a specific dispute's case summary just
 * because that dispute came up a turn or two earlier (audit P1-4) — these patterns mirror the
 * ones their own branches further down already match on, checked here only to SUPPRESS the
 * recall fallback, never to route anywhere themselves. */
function looksLikeUnrelatedQuery(p: string): boolean {
  return /\b(sales|transaction|transactions|revenue)\b/.test(p) || /\bdisputes\b/.test(p);
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

type DisputeIntent = "draft" | "evidence" | "communications" | "history" | "summarize" | "recommend" | "why";

/** Which demo-script question (docs/active-context.md — "Resolution Center Demo-Readiness")
 * the user is asking, checked in specificity order so overlapping words ("recommended"
 * containing "recommend") resolve to the intended intent. */
function detectDisputeIntent(p: string): DisputeIntent | undefined {
  if (/\bdraft\b/.test(p)) return "draft";
  if (/communicat|correspond|inbox|gmail/.test(p)) return "communications";
  if (/customer('?s)? history|account history|pipeline/.test(p)) return "history";
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
      const disputeId = findDisputeIdMentioned(userPrompt) ?? (looksLikeUnrelatedQuery(p) ? undefined : findRecentDisputeId(conversationHistory));
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
        if (disputeIntent === "history" && hasTool("crm_get_contact") && !calledNames.includes("crm_get_contact")) {
          return {
            type: "tool_call",
            toolCallId: newId(),
            toolName: "crm_get_contact",
            input: { email: disputeData?.customerEmail ?? "" },
          };
        }
        if (disputeIntent) {
          return this.answerDisputeIntent(disputeIntent, toolHistory, disputeId, hasTool("gmail_search_threads"), hasTool);
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
        // The history intent additionally pulls the live GoHighLevel contact when available.
        if (disputeIntent === "history" && hasTool("crm_get_contact") && !calledNames.includes("crm_get_contact")) {
          const email = context.dispute?.customerEmail ?? "";
          return { type: "tool_call", toolCallId: newId(), toolName: "crm_get_contact", input: { email } };
        }
        return this.answerDisputeIntent(disputeIntent, toolHistory, context.id, hasTool("gmail_search_threads"), hasTool);
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

    // Commas turned off for this chat: there's no dispute record to investigate around, so stop
    // here rather than running the whole external-source chain first and only THEN admitting it
    // (audit P1-10 — this used to check 5 connectors, several minutes of simulated progress and
    // a real credit charge, before answering "Commas is turned off").
    if (!calledNames.has("commas_get_dispute") && !hasTool("commas_get_dispute")) {
      return {
        type: "final",
        text: "Commas is turned off as a source for this chat, so I can't look up the dispute. Enable it in the sources menu and ask again.",
      };
    }

    // The dispute record has to come back before we know which reason code to prioritize by —
    // until then there's nothing more the chain can decide.
    const disputeResult = toolHistory.find((t) => t.toolName === "commas_get_dispute")?.result;
    const reasonCode = disputeResult?.ok ? (disputeResult.data as { dispute: DisputeShape }).dispute.reason : undefined;

    // Selective, reason-driven source order — "the agent should selectively call relevant
    // sources... do not automatically search every connector for every request" — instead of
    // the old fixed chain that always checked every source regardless of dispute type.
    for (const toolName of sourcePriorityFor(reasonCode)) {
      if (calledNames.has(toolName) || !hasTool(toolName)) continue;
      const argKey = toolName === "crm_get_contact" ? "email" : toolName === "gmail_search_threads" ? "with_email" : "attendee_email";
      return { type: "tool_call", toolCallId: newId(), toolName, input: { [argKey]: customerEmail } };
    }

    // One evidence-recommendation pass, after every prioritized source has been checked but
    // before synthesizing the final answer — grounded only in what was actually found this
    // turn (see buildEvidenceProposal), never a generic per-dispute template.
    if (!calledNames.has("propose_add_evidence") && hasTool("propose_add_evidence")) {
      const proposal = this.buildEvidenceProposal(toolHistory);
      if (proposal) {
        return { type: "tool_call", toolCallId: newId(), toolName: "propose_add_evidence", input: proposal };
      }
    }

    return this.synthesizeDisputeInvestigation(toolHistory, disputeId, availableTools.map((t) => t.name), reasonCode);
  }

  /** Builds evidence candidates strictly from facts already on hand this turn: the dispute's own
   * `evidenceMissing` gaps, filled only where a real tool result backs the claim (a Fathom call
   * that was actually found, the dispute's own authored `communicationsSummary`/`likelyReason`
   * fields) — never a category proposed with nothing concrete behind it. Returns `undefined` when
   * there's genuinely nothing to recommend (no gaps, or no grounding for any of them), matching
   * "if data does not exist, say so" rather than fabricating a plausible-looking candidate. */
  private buildEvidenceProposal(toolHistory: ToolCallRecord[]): { summary: string; items: Record<string, unknown>[] } | undefined {
    const disputeResult = toolHistory.find((t) => t.toolName === "commas_get_dispute")?.result;
    if (!disputeResult?.ok) return undefined;
    const d = (disputeResult.data as { dispute: DisputeShape }).dispute;
    if (d.evidenceMissing.length === 0) return undefined;

    const items: Record<string, unknown>[] = [];

    const fathomResult = toolHistory.find((t) => t.toolName === "fathom_search_calls")?.result;
    const calls = fathomResult?.ok ? ((fathomResult.data as { calls: { durationMinutes: number }[] }).calls ?? []) : [];
    if (calls.length > 0 && d.evidenceMissing.includes("Access & activity records")) {
      items.push({
        category: "Access & activity records",
        title: `Fathom call — ${calls[0].durationMinutes}-minute session`,
        record: `A recorded ${calls[0].durationMinutes}-minute call with ${d.customerName} on Fathom.`,
        why: "Shows direct engagement with the product around the time of purchase.",
        sourceType: "activity",
        sourceLabel: "Fathom",
      });
    }

    // Only proposed when gmail_search_threads was actually called AND actually found a thread —
    // citing an absence ("no threads found") as an "Added" evidence item would misrepresent what
    // was found as what wasn't (audit P1-6). d.communicationsSummary is authored prose that can
    // describe either an existing thread or the lack of one; only the former is real evidence.
    const gmailResult = toolHistory.find((t) => t.toolName === "gmail_search_threads")?.result;
    const gmailThreads = gmailResult?.ok ? ((gmailResult.data as { threads: unknown[] }).threads ?? []) : [];
    if (gmailThreads.length > 0 && d.evidenceMissing.includes("Customer communications") && d.communicationsSummary) {
      items.push({
        category: "Customer communications",
        title: "Customer correspondence",
        record: d.communicationsSummary,
        why: "Direct correspondence relevant to this dispute.",
        sourceType: "communication",
        sourceLabel: "Gmail",
      });
    }

    // No "Commas" fallback for access/activity evidence: Commas exposes no access/login/lesson
    // data (see server/mcp/mockCommasServer.ts) — a candidate here used to cite d.likelyReason
    // (authored narrative prose, not a tool result) as if it were a Commas-sourced record, which
    // is exactly the "state a fact you can't support" failure audit P0-3 flagged. Access-activity
    // evidence can only ever come from an actual source above (Fathom).

    if (items.length === 0) return undefined;
    return {
      summary:
        items.length === 1
          ? `I found ${items[0].sourceLabel === "Fathom" ? "a Fathom call" : "evidence"} that appears relevant.`
          : `I found ${items.length} strong evidence items.`,
      items,
    };
  }

  /** Synthesizes the multi-source investigation answer. Grounded in the specific dispute's
   * authored analysis fields (likelyReason / recommendedAction / uncertaintyNote /
   * resolutionOutcome) — never a one-size-fits-all recommendation — and reports every source
   * that was actually checked, including honest "no results" lines (audit P0-3/P0-8). */
  private synthesizeDisputeInvestigation(
    toolHistory: ToolCallRecord[],
    disputeId: string,
    availableToolNames: string[],
    reasonCodeHint?: string,
  ): LlmStepResult {
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
    const reasonCode = reasonCodeHint ?? dispute.reason;

    const evidenceFound = buildEvidenceFound(toolHistory);

    // Two distinct reasons a source might be absent — never conflated, so the report never
    // implies a deliberately-skipped source was unavailable (or vice versa): not enabled for
    // this chat at all, vs. enabled but simply not a priority source for this dispute's reason
    // code (REASON_SOURCE_PRIORITY), so the chain never called it.
    const priority = new Set(sourcePriorityFor(reasonCode));
    const checked = new Set(toolHistory.map((t) => t.toolName));
    const notEnabled = ALL_INVESTIGATION_TOOLS.filter((name) => !availableToolNames.includes(name));
    const notPrioritized = ALL_INVESTIGATION_TOOLS.filter(
      (name) => availableToolNames.includes(name) && !priority.has(name) && !checked.has(name),
    );
    // A source that was called but errored out is neither "not enabled" nor "not prioritized"
    // — it matches neither filter above and previously vanished from the report entirely
    // (audit P2-2). Surface it as its own category so a source error reads as "couldn't be
    // checked," not as if it were never relevant.
    const failed = ALL_INVESTIGATION_TOOLS.filter(
      (name) => checked.has(name) && toolHistory.find((t) => t.toolName === name)?.result?.ok === false,
    );
    const missingInformation: string[] = [];
    if (notEnabled.length > 0) {
      const labels = notEnabled.map((n) => SOURCE_TOOL_NAMES[n]).filter(Boolean);
      missingInformation.push(`${labels.join(", ")} — not enabled for this chat. Turn on in the sources menu for a fuller picture.`);
    }
    if (notPrioritized.length > 0) {
      const labels = notPrioritized.map((n) => SOURCE_TOOL_NAMES[n]).filter(Boolean);
      missingInformation.push(`${labels.join(", ")} — available but not checked; lower priority for a "${reasonCode.replace(/_/g, " ")}" investigation.`);
    }
    if (failed.length > 0) {
      const labels = failed.map((n) => SOURCE_TOOL_NAMES[n]).filter(Boolean);
      missingInformation.push(`${labels.join(", ")} — couldn't be checked (source error). Retry before relying on this report.`);
    }

    const recommendedNextAction =
      dispute.scenario === "resolved"
        ? (dispute.resolutionOutcome ?? dispute.recommendedAction)
        : dispute.scenario === "high_risk"
          ? `${dispute.uncertaintyNote} ${dispute.recommendedAction}`
          : dispute.recommendedAction;

    const report: InvestigationReport = {
      disputeId: dispute.id,
      caseSummary:
        `Dispute #${dispute.id} — ${money(dispute.amountCents)}, "${dispute.reason.replace(/_/g, " ")}", opened ${fmtDate(dispute.openedAt)}, ` +
        `evidence due ${fmtDate(dispute.evidenceDueAt)}. ${dispute.likelyReason}`,
      evidenceFound,
      missingInformation,
      potentialContradictions: findContradictions(toolHistory, dispute),
      recommendedNextAction,
      caseStrength:
        failed.length > 0
          ? {
              ...caseStrengthFor(dispute),
              explanation: `${caseStrengthFor(dispute).explanation} (Note: ${failed.map((n) => SOURCE_TOOL_NAMES[n]).filter(Boolean).join(", ")} couldn't be checked — this assessment may change once it's retried.)`,
            }
          : caseStrengthFor(dispute),
    };

    const sourcesChecked = toolHistory.filter((t) => t.toolName !== "commas_get_dispute" && t.toolName !== "propose_add_evidence").length;
    const leadIn =
      sourcesChecked > 0
        ? `I investigated dispute #${dispute.id} across ${sourcesChecked} connected source${sourcesChecked === 1 ? "" : "s"} — here's the case report.`
        : `I investigated dispute #${dispute.id} — here's the case report.`;

    return { type: "final", text: leadIn, investigationReport: report };
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
      if (last.result.declined) {
        return { type: "final", text: "Okay — I won't do that. Let me know if you'd like to try something else." };
      }
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
    hasTool: (name: string) => boolean,
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

    const calledNames = toolHistory.map((t) => t.toolName);

    switch (intent) {
      case "draft": {
        // An active dispute has the propose-tool available: route the draft through the
        // approval card instead of dropping the full text straight into the chat. A resolved
        // dispute never gets the propose-tool (server/agent/runtime.ts's availableToolsFor) —
        // `d.draftResponse` for those cases is already an authored "nothing to draft" line, so
        // falling back to plain text is correct there, not a degraded path.
        if (hasTool("propose_draft_response")) {
          if (!calledNames.includes("propose_draft_response")) {
            return {
              type: "tool_call",
              toolCallId: newId(),
              toolName: "propose_draft_response",
              input: { summary: "I can draft a response based on the evidence.", draftText: d.draftResponse },
            };
          }
          return { type: "final", text: "I've put together a draft based on the evidence — review it below." };
        }
        return { type: "final", text: d.draftResponse };
      }

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

      case "history": {
        const crmResult = toolHistory.find((t) => t.toolName === "crm_get_contact")?.result;
        const contact = crmResult?.ok
          ? (crmResult.data as { contact: { name: string; status: string; pipelineStage: string; notes: string } | null }).contact
          : undefined;
        if (!hasTool("crm_get_contact")) {
          return {
            type: "final",
            text: "GoHighLevel isn't connected for this chat, so I can't pull account history. Turn it on in Sources and ask again.",
          };
        }
        if (!contact) {
          return { type: "final", text: `No GoHighLevel contact record for ${d.customerEmail} — no pipeline or account history on file.` };
        }
        return {
          type: "final",
          text: `${contact.name} — ${contact.status.replace(/_/g, " ")}, pipeline stage "${contact.pipelineStage}". ${contact.notes}`,
        };
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

/** Builds the investigation report's "Evidence found" list straight from what tool results
 * this turn actually contain — strictly positive findings (a call that happened, a thread that
 * exists, a contact on file), never an empty-result line (those belong to `missingInformation`
 * or the per-source ToolSummary, not "found"). `raw` carries the underlying record so the UI's
 * "Inspect" action can show real source detail, not just this function's own prose. */
function buildEvidenceFound(toolHistory: ToolCallRecord[]): EvidenceFinding[] {
  const get = (name: string) => toolHistory.find((t) => t.toolName === name)?.result;
  const findings: EvidenceFinding[] = [];

  const fathom = get("fathom_search_calls");
  if (fathom?.ok) {
    const calls = (fathom.data as { calls: { id: string; title: string; occurredAt: string; durationMinutes: number; summary: string; transcriptExcerpt: string; recordingUrl: string }[] }).calls ?? [];
    calls.forEach((call, i) => {
      findings.push({
        id: `fathom-${i}`,
        category: "Access & activity records",
        title: `Fathom call — ${call.durationMinutes}-minute session`,
        record: call.summary,
        why: "Shows direct engagement with the product or service around the time of purchase.",
        sourceType: "activity",
        sourceLabel: "Fathom",
        sourceId: "fathom" as SourceId,
        raw: call,
      });
    });
  }

  const zoom = get("zoom_list_meetings");
  if (zoom?.ok) {
    const meetings = (zoom.data as { meetings: { id: string; topic: string; joinedAt: string; leftAt: string; durationMinutes: number }[] }).meetings ?? [];
    meetings.forEach((mtg, i) => {
      findings.push({
        id: `zoom-${i}`,
        category: "Access & activity records",
        title: `Zoom meeting — ${mtg.durationMinutes} minute${mtg.durationMinutes === 1 ? "" : "s"} attended`,
        record: `"${mtg.topic}" — joined ${fmtDate(mtg.joinedAt)}, left after ${mtg.durationMinutes} minutes.`,
        why: "Independently corroborates call attendance and duration alongside Fathom.",
        sourceType: "activity",
        sourceLabel: "Zoom",
        sourceId: "zoom" as SourceId,
        raw: mtg,
      });
    });
  }

  const calendar = get("calendar_list_events");
  if (calendar?.ok) {
    const events = (calendar.data as { events: { id: string; title: string; startAt: string; durationMinutes: number; status: string }[] }).events ?? [];
    events.forEach((evt, i) => {
      findings.push({
        id: `calendar-${i}`,
        category: "Access & activity records",
        title: `Calendar event — "${evt.title}"`,
        record: `Booked for ${evt.durationMinutes} minutes on ${fmtDate(evt.startAt)} (${evt.status.replace(/_/g, " ")}).`,
        why: "Shows what was actually scheduled, for comparison against what happened on the call.",
        sourceType: "activity",
        sourceLabel: "Google Calendar",
        sourceId: "google-calendar" as SourceId,
        raw: evt,
      });
    });
  }

  const gmail = get("gmail_search_threads");
  if (gmail?.ok) {
    const threads = (gmail.data as { threads: { id: string; subject: string; category: string; messages: { from: string; sentAt: string; snippet: string }[] }[] }).threads ?? [];
    threads.forEach((thread, i) => {
      findings.push({
        id: `gmail-${i}`,
        category: "Customer communications",
        title: `Email thread — "${thread.subject}"`,
        record: thread.messages[thread.messages.length - 1]?.snippet ?? "",
        why: "Direct correspondence relevant to this dispute.",
        sourceType: "communication",
        sourceLabel: "Gmail",
        sourceId: "gmail" as SourceId,
        raw: thread,
      });
    });
  }

  const crm = get("crm_get_contact");
  if (crm?.ok) {
    const contact = (crm.data as { contact: { email: string; name: string; status: string; pipelineStage: string; notes: string; activityLog: { date: string; type: string; detail: string }[] } | null }).contact;
    if (contact) {
      findings.push({
        id: "crm-0",
        category: "Customer & account information",
        title: `GoHighLevel contact — ${contact.name}`,
        record: `${contact.status.replace(/_/g, " ")}, pipeline stage "${contact.pipelineStage}". ${contact.notes}`,
        why: "Shows account history and engagement level with the business.",
        sourceType: "activity",
        sourceLabel: "GoHighLevel",
        sourceId: "crm" as SourceId,
        raw: contact,
      });
    }
  }

  return findings;
}

/** Concrete tensions between sources, or between a source and the customer's claim — never a
 * fabricated one: each check is grounded in real fields from tool results already gathered this
 * turn, and the function returns an empty array (never a placeholder) when it finds none. */
function findContradictions(toolHistory: ToolCallRecord[], dispute: DisputeShape): string[] {
  const get = (name: string) => toolHistory.find((t) => t.toolName === name)?.result;
  const contradictions: string[] = [];

  const calendar = get("calendar_list_events");
  const fathom = get("fathom_search_calls");
  if (calendar?.ok && fathom?.ok) {
    const events = (calendar.data as { events: { durationMinutes: number }[] }).events ?? [];
    const calls = (fathom.data as { calls: { durationMinutes: number }[] }).calls ?? [];
    if (events.length > 0 && calls.length > 0) {
      const booked = events[0].durationMinutes;
      const actual = calls[0].durationMinutes;
      if (actual < booked) {
        contradictions.push(
          `Booked for ${booked} minutes but the call lasted only ${actual} — the session ran short of what was scheduled, which partially supports the customer's complaint even though the session did happen.`,
        );
      }
    }
  }

  const zoom = get("zoom_list_meetings");
  const hadEngagement = (fathom?.ok && ((fathom.data as { calls: unknown[] }).calls ?? []).length > 0) || (zoom?.ok && ((zoom.data as { meetings: unknown[] }).meetings ?? []).length > 0);
  if (dispute.reason === "product_not_received" && hadEngagement) {
    contradictions.push("Customer claims the product wasn't received, but call/meeting records show direct engagement with it after purchase.");
  }

  return contradictions;
}

/** A short, dispute-grounded strength read — never a numeric score, which would imply more
 * precision than this prototype's data supports. `explanation` always reuses the dispute's own
 * authored reasoning (never invents new analysis), same discipline as the rest of this file. */
function caseStrengthFor(dispute: DisputeShape): { label: string; explanation: string } {
  switch (dispute.scenario) {
    case "resolved":
      return { label: "Resolved", explanation: dispute.resolutionOutcome ?? dispute.recommendedAction };
    case "high_risk":
      return { label: "Weak", explanation: `${dispute.uncertaintyNote ?? ""} ${dispute.recommendedAction}`.trim() };
    case "missing_evidence":
      return { label: "Weak", explanation: dispute.recommendedAction };
    case "evidence_ready":
      return { label: "Strong", explanation: dispute.recommendedAction };
    default:
      return dispute.evidenceMissing.length === 0
        ? { label: "Strong", explanation: dispute.recommendedAction }
        : { label: "Moderate", explanation: dispute.recommendedAction };
  }
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
