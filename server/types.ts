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
  /** Result-aware, past-tense label shown once this step completes (e.g. "Found completed
   * coaching calls" vs. the in-flight "Searching Fathom calls…") — computed from the tool's
   * actual result, never a static re-phrasing of `label` (server/agent/registry.ts's
   * `resultLabelFor`). Falls back to `label` when absent (write-tool steps, unknown tools). */
  doneLabel?: string;
}

export interface ToolSummaryItem {
  sourceId: SourceId;
  label: string;
  ok: boolean;
  /** Same result-aware label as `ProgressStep.doneLabel`, carried onto the collapsed
   * "Checked N sources" summary so it shows what was actually found, not just what was
   * checked. */
  resultLabel?: string;
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

/** One concrete fact the investigation actually found, grounded in a real tool result —
 * distinct from `ProposedEvidenceCandidate` above, which is specifically a candidate for the
 * case's evidence checklist. Every `EvidenceFinding` is read-only/informational (rendered in
 * `InvestigationReportCard`'s "Evidence found" section); approving something INTO the case
 * still goes through the existing propose/approve pipeline. `raw` is the underlying source
 * record itself (a Fathom call, a Gmail thread, a Calendar event, …) so the UI can offer a real
 * "inspect this / open the underlying source" view instead of just repeating `record`'s prose. */
export interface EvidenceFinding {
  id: string;
  category: string;
  title: string;
  record: string;
  why: string;
  sourceType: string;
  sourceLabel: string;
  sourceId: SourceId;
  raw?: Record<string, unknown>;
}

/** The structured result of a full multi-source dispute investigation
 * (server/llm/stubClient.ts's `synthesizeDisputeInvestigation`) — never fabricated: every field
 * is derived from tool results actually returned this turn, or from the dispute's own authored
 * facts. Rendered by `InvestigationReportCard.tsx` instead of parsing prose out of `answer`. */
export interface InvestigationReport {
  disputeId: string;
  caseSummary: string;
  evidenceFound: EvidenceFinding[];
  /** Each line names a source and why it's absent — never enabled vs. connected-but-lower-
   * priority-for-this-reason, kept as two separate lines rather than merged. Empty when nothing
   * is missing. */
  missingInformation: string[];
  /** Concrete tensions between what was found and the customer's claim, or between two
   * sources — e.g. a call that happened but ran short of what was booked. Empty (never a
   * fabricated one) when the investigation found none. */
  potentialContradictions: string[];
  recommendedNextAction: string;
  /** `label` is a short, dispute-grounded strength read (e.g. "Strong", "Weak", "Resolved") —
   * never a numeric score, which would imply more precision than this prototype's data
   * supports. `explanation` is always the dispute's own authored reasoning, never invented. */
  caseStrength: { label: string; explanation: string };
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
  /** Set only by a full multi-source dispute investigation (server/llm/stubClient.ts's
   * `synthesizeDisputeInvestigation`) — additive to `answer` (a short lead-in line), never a
   * substitute: `InvestigationReportCard.tsx` renders this structured breakdown instead of
   * parsing `answer`'s prose. */
  investigationReport?: InvestigationReport;
}
