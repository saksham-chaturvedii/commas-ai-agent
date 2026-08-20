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

/** Response body for POST /api/agent/run and /api/agent/approve. */
export interface AgentRunResponse {
  steps: ProgressStep[];
  answer: string;
  toolSummary: ToolSummaryItem[];
  error?: { code: AgentErrorCode; message: string };
  /** Set instead of a final answer when the agent wants to run a write tool — the run pauses
   * here until the client calls /api/agent/approve. */
  pendingApproval?: PendingApproval;
}
