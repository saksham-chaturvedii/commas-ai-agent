/**
 * Server-side types. Deliberately NOT importing from src/lib/types.ts — that file belongs to
 * the frontend's tsc project (tsconfig.app.json) and TypeScript project references don't allow
 * one source file to be included by two sibling projects. These mirror the shapes the frontend
 * expects on the wire (see src/lib/types.ts); keep them in sync by hand.
 */

export type SourceId = "commas" | "google-calendar" | "zoom" | "fathom" | "gmail" | "crm";

export interface PageContext {
  kind: "dispute" | "dashboard";
  id: string;
  label: string;
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

/** Request body for POST /api/agent/run. */
export interface AgentRunRequest {
  prompt: string;
  enabledSources: SourceId[];
  context?: PageContext;
}

export type AgentErrorCode =
  | "auth_failed"
  | "server_unavailable"
  | "malformed_result"
  | "tool_error"
  | "timeout"
  | "empty_result"
  | "unknown";

/** Response body for POST /api/agent/run. On failure, `error` is set and steps/answer describe what happened up to that point. */
export interface AgentRunResponse {
  steps: ProgressStep[];
  answer: string;
  toolSummary: ToolSummaryItem[];
  error?: { code: AgentErrorCode; message: string };
}
