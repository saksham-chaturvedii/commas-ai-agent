import type { LlmClient, LlmStepInput, LlmStepResult } from "./types.js";

/**
 * Deterministic stand-in for a real LLM, used whenever ANTHROPIC_API_KEY isn't configured
 * (docs/active-context.md records this gap — no key is available in this environment). It
 * still drives the REAL agent loop: real tool selection, real MCP calls through
 * server/mcp/client.ts, real tool results fed back before producing a final answer. Only the
 * "reasoning" step is scripted instead of an actual model call — everything downstream of it
 * (MCP protocol, tool registry, error handling) is exercised exactly as it would be with a
 * real LLM. Swap in AnthropicLlmClient (same LlmClient interface) once a key is supplied.
 */
export class StubLlmClient implements LlmClient {
  async nextStep(input: LlmStepInput): Promise<LlmStepResult> {
    const { userPrompt, availableTools, history, context } = input;
    const hasTool = (name: string) => availableTools.some((t) => t.name === name);
    const p = userPrompt.toLowerCase();

    if (availableTools.length === 0) {
      return { type: "final", text: "Commas is turned off as a source for this chat — enable it in the sources menu and ask again." };
    }

    // A tool result is already in hand from an earlier step this turn — summarize it.
    if (history.length > 0) {
      return this.finalize(history[history.length - 1]);
    }

    if (/\b(hi|hello|hey|what can you)\b/.test(p)) {
      return {
        type: "final",
        text: "I can look up customers, transactions, and disputes in Commas. Try asking about a customer, a transaction, or the open dispute.",
      };
    }

    if (/\b(dispute|resolve|evidence)\b/.test(p) && hasTool("commas_get_dispute")) {
      const id = context?.kind === "dispute" ? context.id : "2481";
      return { type: "tool_call", toolCallId: newId(), toolName: "commas_get_dispute", input: { id } };
    }

    const txnMatch = userPrompt.match(/txn_[a-z0-9]+/i);
    if (txnMatch && hasTool("fanbasis_get_transaction")) {
      return { type: "tool_call", toolCallId: newId(), toolName: "fanbasis_get_transaction", input: { id: txnMatch[0] } };
    }

    if (/\b(sales|transaction|transactions|revenue|summary)\b/.test(p) && hasTool("fanbasis_list_transactions")) {
      const emailMatch = userPrompt.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
      return {
        type: "tool_call",
        toolCallId: newId(),
        toolName: "fanbasis_list_transactions",
        input: emailMatch ? { customer_email: emailMatch[0] } : {},
      };
    }

    if (/\b(customer|look\s?up|sarah)\b/.test(p) && hasTool("fanbasis_list_customers")) {
      const emailMatch = userPrompt.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
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

  private finalize(last: LlmStepInput["history"][number]): LlmStepResult {
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
      const d = data.dispute as
        | { id: string; reason: string; amountCents: number; evidenceDueAt: string }
        | undefined;
      if (!d) return { type: "final", text: "That dispute wasn't found." };
      const dueDate = new Date(d.evidenceDueAt).toLocaleDateString("en-US", { month: "long", day: "numeric" });
      return {
        type: "final",
        text: `**Dispute #${d.id}** — ${d.reason.replace(/_/g, " ")}, $${(d.amountCents / 100).toFixed(2)}, evidence due ${dueDate}.`,
      };
    }

    return { type: "final", text: "Done." };
  }
}

let counter = 0;
function newId() {
  counter += 1;
  return `stub-call-${counter}`;
}
