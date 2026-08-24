/**
 * Frontend-only types for the UI foundation pass. These mirror the shapes described in
 * docs/ARCHITECTURE.md (§8 tool registry, §9 agent events, §10 conversation state) but are
 * NOT wired to a real backend yet — see docs/active-context.md for what's mocked vs. real.
 */

export type ViewId = "dashboard" | "resolution-center" | "chat";

/**
 * One native source (Commas) plus the external connected sources named by Commas' CPO for
 * off-platform fulfillment: Google Calendar, Zoom, Fathom, Gmail, GoHighLevel. Internal id
 * stays "crm" (see SOURCES in mockData.ts for the user-facing "GoHighLevel" name/icon).
 * Do not add integrations beyond this list.
 */
export type SourceId = "commas" | "google-calendar" | "zoom" | "fathom" | "gmail" | "crm";

export type SourceConnectionState = "connected" | "not_connected" | "connecting";

export interface SourceInfo {
  id: SourceId;
  name: string;
  description: string;
  connection: SourceConnectionState;
  /** Commas is the primary platform source and can't be disconnected, only scoped off per-chat. */
  isPrimary?: boolean;
}

export type ToolClassification = "read" | "write";

/** A single simulated tool-activity line shown while a mock run is "in progress". */
export interface ProgressStep {
  id: string;
  sourceId: SourceId;
  classification: ToolClassification;
  label: string;
  /** Only used for write-classified steps that render an approval card. */
  approvalSummary?: string;
  /** Result-aware, past-tense label shown once this step completes (e.g. "Found completed
   * coaching calls") — real, tool-grounded, never a static rephrasing of `label`. Falls back to
   * `label` when absent. */
  doneLabel?: string;
}

export type RunPhase = "idle" | "running" | "awaiting_approval" | "done" | "cancelled";

export interface ToolSummaryItem {
  sourceId: SourceId;
  label: string;
  ok: boolean;
  /** Same result-aware label as `ProgressStep.doneLabel`. */
  resultLabel?: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  ts: string;
  /** Present on assistant messages that ran tools; collapses into "Checked N sources". */
  toolSummary?: ToolSummaryItem[];
  /** True while this assistant message's text is still arriving from the shared agent runtime's
   * streamed response (docs/AI_ASSISTANT_ARCHITECTURE.md §2) — global-mode chats only; dispute
   * chats never set this (see src/hooks/useChatStore.tsx `sendMessage`). Purely a rendering hint
   * (used to suppress the redundant "Thinking…" indicator once real text has started arriving —
   * see ChatMessageList.tsx); absent/false renders identically to a normal message. */
  streaming?: boolean;
  /** Zero or more agent-proposed actions attached to this specific message
   * (docs/AI_ASSISTANT_ARCHITECTURE.md §7) — rendered inline as approve/decline controls
   * (ProposedActionCard.tsx). `status` starts "pending" and is advanced in place, client-side
   * only, the moment the seller clicks approve/decline (useChatStore's `resolveProposedAction`)
   * — never round-tripped back to the server, unlike the write-tool `pendingApproval` flow. */
  proposedActions?: ProposedAction[];
  /** Set only by a full multi-source dispute investigation — rendered by
   * `InvestigationReportCard.tsx` in place of parsing `text`'s prose. */
  investigationReport?: InvestigationReport;
}

export type ProposedActionStatus = "pending" | "approved" | "declined";

/** A candidate evidence item the agent found grounds for — never added to the case itself until
 * approved (server/agent/actions/index.ts). `sourceType` mirrors src/lib/disputeData.ts's
 * `EvidenceSourceType` (kept as a plain string on the wire so the server doesn't need to import
 * a frontend type — narrowed back to `EvidenceSourceType` only at the point of actually
 * constructing an `AIEvidenceItem`, in useChatStore's `resolveProposedAction`). */
export interface ProposedEvidenceCandidate {
  category: string;
  title: string;
  record: string;
  why: string;
  sourceType: string;
  sourceLabel: string;
}

export type ProposedAction =
  | {
      id: string;
      type: "add_evidence";
      disputeId: string;
      summary: string;
      items: ProposedEvidenceCandidate[];
      status: ProposedActionStatus;
      /** How many of `items` were actually kept checked at approval time — set only once
       * `status` becomes "approved" (useChatStore's `resolveProposedAction`). Not derivable
       * from any live UI state at render time (the checkbox selection is ephemeral, per-mount
       * local state that would silently reset to "all checked" on a later remount), so the
       * approved count has to be recorded on the action itself to render correctly afterward. */
      approvedCount?: number;
    }
  | { id: string; type: "draft_response"; disputeId: string; summary: string; draftText: string; status: ProposedActionStatus };

/** One concrete fact the investigation found, grounded in a real tool result this turn —
 * read-only/informational (rendered in `InvestigationReportCard`'s "Evidence found" section).
 * Distinct from `ProposedEvidenceCandidate` above, which is a candidate for the evidence
 * checklist and goes through the existing propose/approve pipeline. `raw` is the underlying
 * source record (a Fathom call, a Gmail thread, …), letting "Inspect" show the real source
 * detail instead of only repeating `record`'s prose. */
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

/** The structured result of a full multi-source dispute investigation — every field is derived
 * from tool results actually returned this turn, or the dispute's own authored facts, never
 * fabricated. */
export interface InvestigationReport {
  disputeId: string;
  caseSummary: string;
  evidenceFound: EvidenceFinding[];
  /** Empty when nothing is missing. */
  missingInformation: string[];
  /** Empty (never a fabricated one) when the investigation found none. */
  potentialContradictions: string[];
  recommendedNextAction: string;
  /** `label` is a short, dispute-grounded strength read (e.g. "Strong", "Weak") — never a
   * numeric score. `explanation` is always the dispute's own authored reasoning. */
  caseStrength: { label: string; explanation: string };
}

/** Structured dispute facts, attached to dispute-context chats so the agent has them without
 * a tool call or the user copy/pasting anything (PROTOTYPE_SPEC.md §2.11). */
export interface DisputeContextDetail {
  customerName: string;
  customerEmail: string;
  transactionId: string;
  amountCents: number;
  reason: string;
  openedAt: string;
  evidenceDueAt: string;
  evidenceStatus: "not_started" | "in_progress" | "ready";
  /** The dispute's lifecycle status (src/lib/disputeData.ts's DisputeStatus) — distinct from
   * evidenceStatus above, which tracks response readiness, not the dispute's own outcome. */
  status: "Needs response" | "Won";
  /** Seller-gathered evidence, summarized by checklist category (title/full record never
   * sent — see src/lib/mockData.ts's buildDisputeContext) so the agent can answer "what
   * evidence do we have" without a tool call, without inflating the request payload. */
  evidenceSummary: { category: string; count: number }[];
}

export interface PageContext {
  kind: "dispute" | "dashboard";
  id: string;
  label: string;
  dispute?: DisputeContextDetail;
}

export type ChatStatus = "idle" | "running" | "error";

export interface Chat {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  status: ChatStatus;
  enabledSources: SourceId[];
  context?: PageContext;
  messages: ChatMessage[];
}

/** A tool call awaiting seller approval before it executes (write actions only). */
export interface PendingApproval {
  toolCallId: string;
  toolName: string;
  summary: string;
  input: Record<string, unknown>;
}

/** remainingCredits is always derived as totalCredits - usedCredits, never stored — see
 * useChatStore.tsx's `remainingCredits()` helper. Purchasing credits increases totalCredits;
 * it never resets or decreases usedCredits. */
export interface CreditsState {
  totalCredits: number;
  usedCredits: number;
}

export interface SuggestedCapability {
  id: string;
  label: string;
  prompt: string;
}
