/**
 * Renders an `AgentContext` (./model.ts) into the system prompt the LLM actually sees — the one
 * place "global vs dispute, and which dispute" changes what the model is told, for both the
 * shared agent runtime and (via `agentContextFromPageContext`) the legacy runtime's dispute
 * chats. A pure function of its input: no session lookups, no I/O, so it can't itself leak state
 * between calls — the isolation guarantee lives one layer up, in how each caller builds the
 * `AgentContext` it passes in (server/agent/sessions/store.ts's scope-mismatch guard for the
 * shared agent; a fresh `PageContext` per request for the legacy runtime).
 */
import type { AgentContext } from "./model.js";

const BASE_PERSONA =
  "You are the Commas AI Agent, a helpful assistant for a seller using the Commas platform. " +
  "Be concise and direct. Never state a fact you can't support from what's given to you below, " +
  "and say plainly when you don't have something rather than guessing.";

function formatEvidence(summary: { category: string; count: number }[]): string {
  if (summary.length === 0) return "No evidence has been gathered for this dispute yet.";
  return `Evidence gathered so far: ${summary.map((s) => `${s.category} (${s.count})`).join(", ")}.`;
}

function formatWorkspace(workspace: AgentContext["workspace"]): string {
  const disputes = workspace?.disputesNeedingAttention ?? [];
  if (disputes.length === 0) return "There are currently no disputes needing a response.";
  const lines = disputes
    .map(
      (d) =>
        `Dispute #${d.disputeId} — ${d.customerName}, $${(d.amountCents / 100).toFixed(2)}, reason "${d.reason}", ` +
        `evidence due ${d.evidenceDueAt}`,
    )
    .join("; ");
  return `Disputes currently needing a response: ${lines}.`;
}

export function buildContextPrompt(context: AgentContext): string {
  const sources =
    context.connectedSources.length > 0
      ? ` Connected sources enabled for this conversation: ${context.connectedSources.join(", ")}.`
      : " No connected sources are enabled for this conversation.";

  if (context.conversationType === "dispute" && context.dispute) {
    const d = context.dispute;
    const facts =
      ` Known facts: customer ${d.customerName} (${d.customerId}), transaction ${d.transactionId}, ` +
      `reason "${d.reason}", dispute status "${d.status}", response status "${d.evidenceStatus}". ` +
      `${formatEvidence(d.evidenceSummary)} Use these directly — don't re-fetch what you already know, ` +
      "and don't claim evidence exists beyond what's listed above.";
    const investigationNote =
      context.investigation.turnsCompleted > 0
        ? ` This is turn ${context.investigation.turnsCompleted + 1} of the investigation — you already have ` +
          "the context from earlier in this conversation; don't ask the seller to repeat the dispute id."
        : "";
    return (
      `${BASE_PERSONA} The seller currently has Dispute #${d.disputeId} open in the Resolution Center, ` +
      `so assume questions about "this dispute" refer to it — never a different dispute.${facts}${investigationNote}${sources}`
    );
  }

  return (
    `${BASE_PERSONA} This is a general workspace conversation, not scoped to any specific dispute — ` +
    `never assume "this dispute" refers to one you haven't been told about. ${formatWorkspace(context.workspace)}${sources}`
  );
}
