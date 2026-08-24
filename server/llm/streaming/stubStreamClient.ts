import type { AgentContext } from "../../agent/context/model.js";
import type { StreamReplyArgs, StreamingLlmClient } from "./types.js";

/**
 * Deterministic streaming stand-in for the shared agent, used whenever ANTHROPIC_API_KEY isn't
 * configured — the same reason `server/llm/stubClient.ts` exists for the legacy runtime. This is
 * NOT just a single-chunk fake: it delivers its reply word-by-word with a small delay between
 * chunks, so the streaming transport (SSE endpoint → fetch reader → incremental UI update) is
 * genuinely exercised end-to-end even with no live model available — the piece being proven here
 * is the pipe, not the reasoning. The reasoning itself stays honestly scripted, exactly as the
 * legacy stub already is — but it's genuinely grounded in `context` (server/agent/context/
 * model.ts) where that context has real facts, not just pattern-matched on the user's text, so
 * this stub can actually demonstrate the context model doing something without a live model.
 */

const CHUNK_DELAY_MS = 35;

const GREETING_REPLY =
  "I can help with customers, transactions, and disputes in Commas, plus your connected apps " +
  "(Google Calendar, Zoom, Fathom, Gmail, GoHighLevel). Try asking about a customer, a " +
  "transaction, or open a dispute and I'll help you investigate it.";

const ACKNOWLEDGMENT_REPLY = "Anytime — anything else I can help with?";

const FALLBACK_REPLY =
  "I don't have a specific answer for that in this lightweight mode yet, but I'm listening — " +
  "try asking about a customer, a transaction, or one of your open disputes.";

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function workspaceReply(context: AgentContext): string {
  const disputes = context.workspace?.disputesNeedingAttention ?? [];
  if (disputes.length === 0) return "There are no disputes needing a response right now — you're all caught up.";
  const lines = disputes
    .map((d) => `Dispute #${d.disputeId} (${d.customerName}, ${formatCents(d.amountCents)}, "${d.reason}")`)
    .join(", ");
  return `${disputes.length} dispute${disputes.length === 1 ? "" : "s"} need${disputes.length === 1 ? "s" : ""} a response: ${lines}.`;
}

function evidenceReply(context: AgentContext): string {
  const d = context.dispute;
  const summary = d?.evidenceSummary ?? [];
  if (summary.length === 0) {
    return `No evidence has been gathered for Dispute #${d?.disputeId ?? "this dispute"} yet — add some from the evidence checklist and ask me again.`;
  }
  const lines = summary.map((s) => `${s.category} (${s.count})`).join(", ");
  return `For Dispute #${d?.disputeId}, evidence gathered so far: ${lines}.`;
}

function draftReply(context: AgentContext): string {
  const d = context.dispute;
  if (!d) return FALLBACK_REPLY;
  if ((d.evidenceSummary?.length ?? 0) === 0) {
    return (
      `I don't have enough evidence on file yet to draft a strong response for Dispute #${d.disputeId} — ` +
      "add some from the evidence checklist and ask me to draft again."
    );
  }
  return (
    `Draft for Dispute #${d.disputeId}: the customer, ${d.customerName}, disputed this transaction citing ` +
    `"${d.reason}". Based on the evidence on file, we ask that this dispute be resolved in our favor.`
  );
}

function replyFor(userText: string, context?: AgentContext): string {
  const p = userText.toLowerCase().trim();
  if (/^\s*(hi|hello|hey|what can you)\b/.test(p)) return GREETING_REPLY;
  if (/^\s*(thanks|thank you|thx|ok|okay|got it|great|perfect|awesome|cool|nice)[\s!.]*$/.test(p)) {
    return ACKNOWLEDGMENT_REPLY;
  }
  if (context?.conversationType === "global" && /disput|attention|needs a response/.test(p)) {
    return workspaceReply(context);
  }
  if (context?.conversationType === "dispute" && /evidence/.test(p)) {
    return evidenceReply(context);
  }
  if (context?.conversationType === "dispute" && /draft|response/.test(p)) {
    return draftReply(context);
  }
  return FALLBACK_REPLY;
}

/** Splits into word-sized deltas (each carrying its own leading space, except the first word) so
 * a client reassembling deltas in order reproduces the exact original text. */
function chunkText(text: string): string[] {
  const words = text.split(" ");
  return words.map((w, i) => (i === 0 ? w : ` ${w}`));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class StubStreamClient implements StreamingLlmClient {
  async streamReply({ transcript, context, onDelta, signal }: StreamReplyArgs): Promise<void> {
    const lastUserTurn = [...transcript].reverse().find((t) => t.role === "user");
    const text = replyFor(lastUserTurn?.text ?? "", context);

    for (const chunk of chunkText(text)) {
      if (signal?.aborted) {
        throw new DOMException("The stream was aborted.", "AbortError");
      }
      await onDelta(chunk);
      await delay(CHUNK_DELAY_MS);
    }
  }
}
