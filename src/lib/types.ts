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
}

export type RunPhase = "idle" | "running" | "awaiting_approval" | "done" | "cancelled";

export interface ToolSummaryItem {
  sourceId: SourceId;
  label: string;
  ok: boolean;
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
