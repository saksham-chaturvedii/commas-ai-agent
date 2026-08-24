/**
 * Tool layer for the shared agent runtime (server/agent/runtime/). Deliberately empty in this
 * foundational phase — the task scope for this pass is explicit: "do not implement all real
 * tools yet." The shared agent (server/agent/runtime/sharedAgent.ts) runs conversation-only, with
 * no tool calls, in both GLOBAL and DISPUTE session modes.
 *
 * The existing, fully-functional tool layer is NOT duplicated here — it already exists and
 * continues to back the legacy runtime (server/agent/runtime.ts, used by dispute-context chats
 * via POST /api/agent/run) exactly as before this phase:
 *   - server/adapters/*        — the SourceAdapter abstraction + 6 adapters (Commas/Fathom/Zoom
 *                                 over MCP, Gmail/Calendar/GoHighLevel over mock APIs)
 *   - server/agent/registry.ts — tool discovery + read/write classification
 *
 * A later phase wires that same registry (widened per
 * docs/AI_ASSISTANT_ARCHITECTURE.md §6 — read/propose/write classification, one shared dataset,
 * citations) into the shared agent's own tool-calling loop, rather than reinventing it here. This
 * file is the placeholder that marks where that wiring lands.
 */
export {};
