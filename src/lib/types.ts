/**
 * Frontend-only types for the UI foundation pass. These mirror the shapes described in
 * docs/ARCHITECTURE.md (§8 tool registry, §9 agent events, §10 conversation state) but are
 * NOT wired to a real backend yet — see docs/active-context.md for what's mocked vs. real.
 */

export type ViewId = "dashboard" | "resolution-center" | "chat";

/**
 * One native source (Commas) plus the external connected sources named by Commas' CPO for
 * off-platform fulfillment: Google Calendar, Zoom, Fathom, Gmail, CRM (vendor-neutral).
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
}

export interface PageContext {
  kind: "dispute" | "dashboard";
  id: string;
  label: string;
}

export interface Chat {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  enabledSources: SourceId[];
  context?: PageContext;
  messages: ChatMessage[];
}

export interface CreditsState {
  balance: number;
  startingBalance: number;
}

export interface SuggestedCapability {
  id: string;
  label: string;
  prompt: string;
}
