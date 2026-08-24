/**
 * Tool layer for the shared agent runtime (server/agent/runtime/sharedAgent.ts). Does NOT
 * duplicate the existing tool infrastructure — the same `SourceAdapter`s and the same
 * `RegisteredTool` registry (server/adapters/*, server/agent/registry.ts) that already back the
 * legacy runtime's real tool calls are reused here as-is, adapters and registry passed straight
 * through from server/app.ts. This file's only job is deciding WHICH of the registry's tools the
 * shared agent is allowed to see for a given request — the actual lookup/execution machinery
 * (`SourceAdapter.callTool`, `AgentError`/`classifyError`, the timeout race) is reused directly
 * from server/agent/runtime.ts's pattern inside sharedAgent.ts, not reimplemented here either.
 *
 * Scope for this phase, explicit and temporary: Commas only, read tools only.
 *   - Commas: "First expose the existing Commas demo/mock data through structured agent tools" —
 *     this phase's own instruction. `commas_mark_dispute_response_ready` (the one write tool on
 *     this source) is excluded — approving a write action mid-stream has no established UX yet
 *     (the legacy runtime's `pendingApproval` pause is a JSON round-trip; SSE has no equivalent
 *     today), so it stays exclusively the legacy dispute-chat runtime's job.
 *   - Everything else (Fathom, Zoom, Gmail, Google Calendar, GoHighLevel): explicitly excluded —
 *     "Do not implement OAuth connectors yet." Their adapters and registry entries already exist
 *     and keep serving the legacy runtime unchanged; nothing about their code needs to change to
 *     add them here later — see `SHARED_AGENT_TOOL_SOURCES` below, the one line that scopes this.
 */
import type { RegisteredTool } from "../registry.js";
import type { LlmToolDef } from "../../llm/types.js";
import type { SourceId } from "../../types.js";

/** The only sources the shared agent may call tools from this phase. Widening this (adding
 * "fathom", "zoom", etc.) is the entire change needed to extend the shared agent to a new
 * source once its OAuth/live-connection story exists — nothing else in this file, the loop
 * (sharedAgent.ts), or the adapters themselves needs to change. */
export const SHARED_AGENT_TOOL_SOURCES: readonly SourceId[] = ["commas"];

/**
 * Read-only tools from `SHARED_AGENT_TOOL_SOURCES`, further narrowed to whatever this specific
 * conversation actually has enabled (`enabledSources`, from `chat.enabledSources` on the wire) —
 * the same two-level narrowing `server/agent/runtime.ts`'s `availableToolsFor` already does for
 * the legacy runtime, so a seller who's turned Commas off for a chat gets the same "no sources
 * enabled" behavior here, not a silent bypass.
 */
export function sharedAgentToolsFor(enabledSources: SourceId[], registry: Map<string, RegisteredTool>): LlmToolDef[] {
  return Array.from(registry.values())
    .filter(
      (t) =>
        SHARED_AGENT_TOOL_SOURCES.includes(t.sourceId) &&
        enabledSources.includes(t.sourceId) &&
        t.classification === "read",
    )
    .map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }));
}
