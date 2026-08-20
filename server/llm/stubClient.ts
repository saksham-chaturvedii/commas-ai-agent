import type { LlmClient, LlmStepInput, LlmStepResult, ToolCallRecord } from "./types.js";

/**
 * Deterministic stand-in for a real LLM, used whenever ANTHROPIC_API_KEY isn't configured
 * (docs/active-context.md records this gap). It still drives the REAL agent loop: real tool
 * selection, real adapter/MCP calls, real tool results fed back before producing a final
 * answer — only the "reasoning" is scripted instead of an actual model call.
 *
 * The dispute-investigation chain below (dispute → CRM → Gmail → Fathom → Zoom) is a SCRIPTED
 * approximation for this stub only — it exists to prove the multi-source loop mechanism works
 * end to end. `AnthropicLlmClient` receives the exact same tool list, tool results, and
 * conversation history and decides its own sequence freely; nothing about the mechanism
 * assumes this particular order.
 */

const DISPUTE_CHAIN = ["commas_get_dispute", "crm_get_contact", "gmail_search_threads", "fathom_search_calls", "zoom_list_meetings"];

/** Matches an email without swallowing a trailing sentence period — plain `[\w.-]+` for the
 * domain greedily eats a "." that ends a sentence (e.g. "...sarah.johnson@email.com." from an
 * assistant reply), which silently broke follow-up lookups against conversation history. */
const EMAIL_REGEX = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/;

export class StubLlmClient implements LlmClient {
  async nextStep(input: LlmStepInput): Promise<LlmStepResult> {
    const { userPrompt, availableTools, toolHistory, context, conversationHistory } = input;
    const hasTool = (name: string) => availableTools.some((t) => t.name === name);
    const p = userPrompt.toLowerCase();

    if (availableTools.length === 0) {
      return { type: "final", text: "No sources are enabled for this chat — enable at least one in the sources menu and ask again." };
    }

    const calledNames = toolHistory.map((t) => t.toolName);
    const inDisputeChain = DISPUTE_CHAIN.some((name) => calledNames.includes(name));
    const wantsDisputeInvestigation =
      /\b(dispute|resolve)\b/.test(p) || (context?.kind === "dispute" && /\b(help|understand|investigate|why)\b/.test(p));

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
        text: "I can look up customers, transactions, and disputes in Commas, and check your connected apps (Google Calendar, Zoom, Fathom, Gmail, CRM) for extra context. Try asking about a customer, a transaction, or the open dispute.",
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

    if (/\b(connected apps|connected sources|across my)\b/.test(p)) {
      return this.crossSourceStep(input);
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

    if (/\b(respond|reply)\b/.test(p) && hasTool("fanbasis_list_customers")) {
      return { type: "tool_call", toolCallId: newId(), toolName: "fanbasis_list_customers", input: {} };
    }

    if (/\b(customer|look\s?up|sarah)\b/.test(p) && hasTool("fanbasis_list_customers")) {
      const emailMatch = userPrompt.match(EMAIL_REGEX);
      let search = emailMatch?.[0];
      if (!search) {
        const afterCustomer = userPrompt.match(/customer\s+(.+)/i);
        search = afterCustomer ? afterCustomer[1].trim() : p.includes("sarah") ? "sarah" : undefined;
      }
      return { type: "tool_call", toolCallId: newId(), toolName: "fanbasis_list_customers", input: search ? { search } : {} };
    }

    return {
      type: "final",
      text: "This preview only knows a handful of demo scenarios right now — try asking about a customer, a transaction, or the open dispute.",
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

    return this.synthesizeDisputeInvestigation(toolHistory, disputeId);
  }

  private synthesizeDisputeInvestigation(toolHistory: ToolCallRecord[], disputeId: string): LlmStepResult {
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
    const fmt = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric" });

    const lines: string[] = [
      "### Situation summary",
      `Dispute #${dispute.id} — $${(dispute.amountCents / 100).toFixed(2)}, "${dispute.reason.replace(/_/g, " ")}", opened ${fmt(dispute.openedAt)}, evidence due ${fmt(dispute.evidenceDueAt)}.`,
      "",
      "### Evidence",
    ];

    const evidence: string[] = [];
    const crm = get("crm_get_contact");
    if (crm?.ok) {
      const contact = (crm.data as { contact: { name: string; status: string; notes: string } }).contact;
      evidence.push(`- CRM: ${contact.name} — ${contact.status.replace("_", " ")}. ${contact.notes}`);
    }
    const gmail = get("gmail_search_threads");
    if (gmail?.ok) {
      const threads = (gmail.data as { threads: { messages: unknown[] }[] }).threads ?? [];
      if (threads.length > 0) evidence.push(`- Gmail: a thread with the customer confirming they gained access after a support reply.`);
    }
    const fathom = get("fathom_search_calls");
    if (fathom?.ok) {
      const calls = (fathom.data as { calls: { durationMinutes: number }[] }).calls ?? [];
      if (calls.length > 0) evidence.push(`- Fathom: ${calls.length} recorded call(s), including a ${calls[0].durationMinutes}-minute onboarding session.`);
    }
    const zoom = get("zoom_list_meetings");
    if (zoom?.ok) {
      const meetings = (zoom.data as { meetings: unknown[] }).meetings ?? [];
      if (meetings.length > 0) evidence.push(`- Zoom: ${meetings.length} meeting(s) with matching join times, corroborating the Fathom calls.`);
    }
    lines.push(...(evidence.length > 0 ? evidence : ["- Only Commas data was checked — no connected apps were available to this chat."]));

    lines.push("", "### Recommendation");
    lines.push(
      "The customer engaged with the product after purchase — respond with evidence of delivery and " +
        "engagement. Tell me to \"mark the response ready\" when you're satisfied with the evidence, and " +
        "I'll confirm with you before doing anything.",
    );

    const missing = DISPUTE_CHAIN.slice(1).filter((name) => !get(name));
    if (missing.length > 0) {
      const labels = missing.map((n) => ({ crm_get_contact: "CRM", gmail_search_threads: "Gmail", fathom_search_calls: "Fathom", zoom_list_meetings: "Zoom" })[n]);
      lines.push("", "### Missing information", `${labels.join(", ")} — enable in the sources menu for a fuller picture.`);
    }

    return { type: "final", text: lines.join("\n") };
  }

  private crossSourceStep(input: LlmStepInput): LlmStepResult {
    const { availableTools, toolHistory, context } = input;
    const externalToolsInOrder = ["fathom_search_calls", "zoom_list_meetings", "gmail_search_threads", "crm_get_contact", "calendar_list_events"];
    const hasTool = (name: string) => availableTools.some((t) => t.name === name);
    const calledNames = new Set(toolHistory.map((t) => t.toolName));
    const customerEmail = context?.dispute?.customerEmail ?? "sarah.johnson@email.com";

    for (const name of externalToolsInOrder) {
      if (hasTool(name) && !calledNames.has(name)) {
        const argKey = name === "crm_get_contact" ? "email" : name === "gmail_search_threads" ? "with_email" : "attendee_email";
        return { type: "tool_call", toolCallId: newId(), toolName: name, input: { [argKey]: customerEmail } };
      }
    }

    if (toolHistory.length === 0) {
      return {
        type: "final",
        text: "No connected apps are available to this chat right now. Connect Google Calendar, Zoom, Fathom, Gmail, or your CRM (or enable them in the sources menu) and I can search across them.",
      };
    }
    const checked = toolHistory.filter((t) => t.result?.ok).map((t) => t.toolName);
    return {
      type: "final",
      text: `I checked ${checked.length} connected app${checked.length === 1 ? "" : "s"}. Ask me about a specific customer or session and I'll dig into the details.`,
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
      const c = customers[0];
      return { type: "final", text: `**${c.name}** — ${c.email}.` };
    }

    if (last.toolName === "fanbasis_list_transactions") {
      const txns = (data.transactions as { amountCents: number }[] | undefined) ?? [];
      if (txns.length === 0) return { type: "final", text: "No transactions found for that customer." };
      const totalCents = txns.reduce((sum, t) => sum + t.amountCents, 0);
      return {
        type: "final",
        text: `Found ${txns.length} transaction${txns.length === 1 ? "" : "s"} totaling $${(totalCents / 100).toFixed(2)}.`,
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
      const dueDate = new Date(d.evidenceDueAt).toLocaleDateString("en-US", { month: "long", day: "numeric" });
      return {
        type: "final",
        text: `**Dispute #${d.id}** — ${d.reason.replace(/_/g, " ")}, $${(d.amountCents / 100).toFixed(2)}, evidence due ${dueDate}.`,
      };
    }

    if (last.toolName === "commas_mark_dispute_response_ready") {
      return {
        type: "final",
        text: "Done — I've marked the dispute response as ready. Nothing was submitted anywhere; that step is still yours from the dispute page.",
      };
    }

    return { type: "final", text: "Done." };
  }
}

interface DisputeShape {
  id: string;
  reason: string;
  amountCents: number;
  openedAt: string;
  evidenceDueAt: string;
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
