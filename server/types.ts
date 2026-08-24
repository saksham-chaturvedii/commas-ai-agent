/**
 * Server-side types. Deliberately NOT importing from src/lib/types.ts — that file belongs to
 * the frontend's tsc project (tsconfig.app.json) and TypeScript project references don't allow
 * one source file to be included by two sibling projects. These mirror the shapes the frontend
 * expects on the wire (see src/lib/types.ts); keep them in sync by hand.
 */

export type SourceId = "commas" | "google-calendar" | "zoom" | "fathom" | "gmail" | "crm";

export interface DisputeContextDetail {
  customerName: string;
  customerEmail: string;
  transactionId: string;
  amountCents: number;
  reason: string;
  openedAt: string;
  evidenceDueAt: string;
  evidenceStatus: "not_started" | "in_progress" | "ready";
  status: "Needs response" | "Won";
  evidenceSummary: { category: string; count: number }[];
}

export interface PageContext {
  kind: "dispute" | "dashboard";
  id: string;
  label: string;
  dispute?: DisputeContextDetail;
}

export type ToolClassification = "read" | "write";

export interface ProgressStep {
  id: string;
  sourceId: SourceId;
  classification: ToolClassification;
  label: string;
}

export interface ToolSummaryItem {
  sourceId: SourceId;
  label: string;
  ok: boolean;
}

/** One prior turn of the conversation — role + final text only, no tool internals, kept lean
 * (a capped window, not the full history — see runtime.ts's HISTORY_TURN_LIMIT). */
export interface ConversationTurn {
  role: "user" | "assistant";
  text: string;
}

export interface PendingApproval {
  toolCallId: string;
  toolName: string;
  summary: string;
  input: Record<string, unknown>;
}

/** Request body for POST /api/agent/run. */
export interface AgentRunRequest {
  prompt: string;
  enabledSources: SourceId[];
  context?: PageContext;
  history?: ConversationTurn[];
}

/** Request body for POST /api/agent/approve — resumes a run paused on a write tool. */
export interface AgentApproveRequest {
  decision: "approve" | "decline";
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
  /** The prompt that originally led to this pending approval — replayed on resume. */
  prompt: string;
  enabledSources: SourceId[];
  context?: PageContext;
  history?: ConversationTurn[];
}

export type AgentErrorCode =
  | "auth_failed"
  | "server_unavailable"
  | "malformed_result"
  | "tool_error"
  | "timeout"
  | "empty_result"
  | "unknown";

/** A single agent-recommended evidence item (docs/AI_ASSISTANT_ARCHITECTURE.md §7) — never
 * added to the case itself; only ever a candidate the seller can approve. `sourceType` mirrors
 * src/lib/disputeData.ts's `EvidenceSourceType` union, kept as a plain string here since server
 * code can't import frontend types. */
export interface ProposedEvidenceCandidate {
  category: string;
  title: string;
  record: string;
  why: string;
  sourceType: string;
  sourceLabel: string;
}

/** An action the agent proposes but never executes itself — see server/agent/actions/index.ts.
 * `status` starts "pending" server-side and is only ever advanced client-side, once the seller
 * actually clicks approve/decline; the server never learns the outcome (this is a UI-local
 * decision, not a round-tripped one, unlike the write-tool `pendingApproval` flow above). */
export type ProposedAction =
  | { id: string; type: "add_evidence"; disputeId: string; summary: string; items: ProposedEvidenceCandidate[]; status: "pending" }
  | { id: string; type: "draft_response"; disputeId: string; summary: string; draftText: string; status: "pending" };

/** Response body for POST /api/agent/run and /api/agent/approve. */
export interface AgentRunResponse {
  steps: ProgressStep[];
  answer: string;
  toolSummary: ToolSummaryItem[];
  error?: { code: AgentErrorCode; message: string };
  /** Set instead of a final answer when the agent wants to run a write tool — the run pauses
   * here until the client calls /api/agent/approve. */
  pendingApproval?: PendingApproval;
  /** Zero or more actions the agent proposed this turn (server/agent/actions/index.ts) —
   * additive to `answer`, never a substitute for it: the turn still ends with a normal final
   * answer once every proposal this turn has been recorded. */
  proposedActions?: ProposedAction[];
}
