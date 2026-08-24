/**
 * The shared agent's context model (docs/AI_ASSISTANT_ARCHITECTURE.md §5) — the one typed
 * representation of "what does the agent currently know about this conversation" for BOTH
 * GLOBAL and DISPUTE modes. This is deliberately the single place that shape is defined: the
 * shared agent runtime (server/agent/runtime/sharedAgent.ts) builds one from its session +
 * per-request facts, and the *legacy* runtime (server/agent/runtime.ts) builds one from its own
 * per-request `PageContext` via `agentContextFromPageContext` below — two different runtimes,
 * one context representation, satisfying "do not create two separate agent backends" at the
 * context layer specifically (tool execution is a separate, intentionally-still-legacy concern
 * for dispute chats — see server/agent/README.md).
 */
import type { PageContext, SourceId } from "../../types.js";

export interface DisputeFacts {
  disputeId: string;
  /** This prototype has no separate customer-id scheme — the email is the unique key used
   * everywhere server-side (server/mcp/mockCommasServer.ts's CUSTOMERS), so it doubles as the
   * "active customer id" the context model is asked to represent. */
  customerId: string;
  customerName: string;
  transactionId: string;
  reason: string;
  /** The dispute's lifecycle status ("Needs response" | "Won") — distinct from evidenceStatus. */
  status: string;
  evidenceStatus: "not_started" | "in_progress" | "ready";
  /** Gathered evidence, by checklist category — never full evidence text (see
   * src/lib/mockData.ts's buildDisputeContext, where this is computed). */
  evidenceSummary: { category: string; count: number }[];
}

export interface WorkspaceDisputeSummary {
  disputeId: string;
  customerName: string;
  reason: string;
  amountCents: number;
  evidenceDueAt: string;
}

export interface InvestigationProgress {
  status: "not_started" | "in_progress";
  turnsCompleted: number;
}

export interface AgentContext {
  conversationId: string;
  conversationType: "global" | "dispute";
  connectedSources: SourceId[];
  /** Present only in dispute mode — the isolation boundary the whole model exists to enforce:
   * a global-mode context never has this, and a dispute-mode context only ever has facts for
   * its own disputeId (server/agent/sessions/store.ts's scope-mismatch guard is what prevents a
   * session from ever holding a different dispute's facts here). */
  dispute?: DisputeFacts;
  /** Present only in global mode — broad workspace orientation ("Show me disputes that need
   * attention"), never dispute-specific facts. */
  workspace?: { disputesNeedingAttention: WorkspaceDisputeSummary[] };
  investigation: InvestigationProgress;
  /** Always empty in this phase — the propose/approve action pipeline
   * (docs/AI_ASSISTANT_ARCHITECTURE.md §7) doesn't exist yet (server/agent/actions/index.ts).
   * Typed `never[]` on purpose: it documents "capable of representing pending/recommended
   * actions" without inventing a shape ahead of the feature that will define one. */
  pendingActions: never[];
}

export interface BuildAgentContextArgs {
  conversationId: string;
  conversationType: "global" | "dispute";
  connectedSources?: SourceId[];
  dispute?: DisputeFacts;
  workspace?: { disputesNeedingAttention: WorkspaceDisputeSummary[] };
  /** How many turns this conversation has already completed, from the caller's own memory
   * (the shared agent's SessionRecord; always 0 for the legacy runtime's per-request calls,
   * since that runtime keeps no server-side memory of its own — see server/agent/README.md). */
  priorTurnsCompleted?: number;
}

export function buildAgentContext(args: BuildAgentContextArgs): AgentContext {
  const turnsCompleted = args.priorTurnsCompleted ?? 0;
  return {
    conversationId: args.conversationId,
    conversationType: args.conversationType,
    connectedSources: args.connectedSources ?? [],
    dispute: args.conversationType === "dispute" ? args.dispute : undefined,
    workspace: args.conversationType === "global" ? args.workspace : undefined,
    investigation: { status: turnsCompleted > 0 ? "in_progress" : "not_started", turnsCompleted },
    pendingActions: [],
  };
}

/** Adapts the legacy runtime's per-request `PageContext` (server/agent/runtime.ts) into the
 * same `AgentContext` shape the shared agent builds from its session — the specific function
 * that makes "one context model, two runtimes" true rather than aspirational. Stateless by
 * design: the legacy runtime keeps no session, so `priorTurnsCompleted` is always 0 here (its
 * own memory-equivalent is the client-resent `conversationHistory`, unchanged by this model). */
export function agentContextFromPageContext(conversationId: string, context: PageContext | undefined): AgentContext {
  if (context?.kind === "dispute" && context.dispute) {
    const d = context.dispute;
    return buildAgentContext({
      conversationId,
      conversationType: "dispute",
      dispute: {
        disputeId: context.id,
        customerId: d.customerEmail,
        customerName: d.customerName,
        transactionId: d.transactionId,
        reason: d.reason,
        // Defensive fallback, not a type escape hatch: a chat persisted to localStorage before
        // these fields existed would arrive over the wire without them.
        status: d.status ?? "Needs response",
        evidenceStatus: d.evidenceStatus,
        evidenceSummary: d.evidenceSummary ?? [],
      },
    });
  }
  return buildAgentContext({ conversationId, conversationType: "global" });
}
