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
 * Scope: read tools only, from every source the shared agent can reach.
 *   - Commas: `commas_mark_dispute_response_ready` (the one write tool on this source) is
 *     excluded — approving a write action mid-stream has no established UX yet (the legacy
 *     runtime's `pendingApproval` pause is a JSON round-trip; SSE has no equivalent today), so
 *     it stays exclusively the legacy dispute-chat runtime's job.
 *   - Fathom/Zoom/Gmail/Google Calendar/GoHighLevel: widened to include these (audit P1-2) — the
 *     global chat's own "Find information across my connected apps" suggestion chip, and any
 *     request naming one of these sources, previously always failed on the route the real
 *     frontend uses (`POST /api/agent/stream`) even with every source connected and enabled,
 *     because this list only ever named "commas". These are still simulated connectors, not real
 *     OAuth — nothing about that changed, only which of the ALREADY-simulated read tools this
 *     runtime is allowed to see.
 */
import type { RegisteredTool } from "../registry.js";
import type { LlmToolDef } from "../../llm/types.js";
import type { SourceId } from "../../types.js";

/** The sources the shared agent may call read tools from. */
export const SHARED_AGENT_TOOL_SOURCES: readonly SourceId[] = ["commas", "google-calendar", "zoom", "fathom", "gmail", "crm"];

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
