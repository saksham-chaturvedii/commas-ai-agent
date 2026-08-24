/**
 * The shared agent runtime (docs/AI_ASSISTANT_ARCHITECTURE.md §2–§4) — one runtime for both
 * GLOBAL and DISPUTE session modes, driven entirely by the `SessionConfig` on the request. There
 * is no `DisputeAgent` class and no second code path: mode only changes what
 * `server/agent/context/buildContext.ts` puts in the system prompt.
 *
 * This is the "minimal shared agent capable of receiving a message and returning a streamed
 * response" for this phase: conversation-only (no tool calls — see server/agent/tools/index.ts),
 * backed by a real server-side session (server/agent/sessions/store.ts) so multi-turn memory is a
 * genuine server-side fact instead of client-resent text, and delivered as real incremental
 * deltas via `StreamingLlmClient` (server/llm/streaming/) rather than one blocking response.
 *
 * Deliberately does NOT replace `server/agent/runtime.ts` (the legacy loop): that runtime keeps
 * powering dispute-context chats — and therefore the Resolution Center's "Investigate with AI"
 * flow, tool calls, and the write-approval pause — completely unchanged. This runtime is
 * currently reachable only from POST /api/agent/stream, used by the frontend for global-mode
 * chats (src/hooks/useChatStore.tsx).
 */
import type { SessionConfig, SessionTranscriptEntry } from "../sessions/store.js";
import { SessionStore } from "../sessions/store.js";
import { buildContextPrompt } from "../context/buildContext.js";
import { buildAgentContext, type DisputeFacts, type WorkspaceDisputeSummary } from "../context/model.js";
import type { StreamingLlmClient } from "../../llm/streaming/types.js";
import type { SourceId } from "../../types.js";

export type AgentStreamEvent =
  | { type: "delta"; text: string }
  | { type: "done"; text: string }
  | { type: "error"; message: string };

/** Per-request facts the caller supplies to keep this session's stored `AgentContext` current —
 * see server/agent/context/model.ts. Optional: a request with none of these just gets whatever
 * the session already knew (or a bare context, for a brand-new session). */
export interface RunSharedAgentRequestContext {
  connectedSources?: SourceId[];
  dispute?: DisputeFacts;
  workspace?: { disputesNeedingAttention: WorkspaceDisputeSummary[] };
}

export interface RunSharedAgentArgs {
  sessionId: string;
  config: SessionConfig;
  userMessage: string;
  /** Bootstraps a brand-new session's memory from client-sent text history — see
   * `SessionStore.resolve`'s doc comment for exactly when this applies. */
  bootstrapHistory?: SessionTranscriptEntry[];
  requestContext?: RunSharedAgentRequestContext;
  llmClient: StreamingLlmClient;
  sessionStore: SessionStore;
  onEvent: (event: AgentStreamEvent) => void | Promise<void>;
  signal?: AbortSignal;
}

export async function runSharedAgent(args: RunSharedAgentArgs): Promise<void> {
  const { sessionId, config, userMessage, bootstrapHistory, requestContext, llmClient, sessionStore, onEvent, signal } =
    args;

  try {
    // Serialized per sessionId: two overlapping requests for the same session (same chat open in
    // two tabs/devices) must not both snapshot the transcript before either writes back — see
    // `SessionStore.runExclusive`'s doc comment. Different sessions run fully concurrently.
    await sessionStore.runExclusive(sessionId, async () => {
      const session = sessionStore.resolve(sessionId, config, bootstrapHistory);

      // Always a full replace, never a merge onto the session's *previous* context — see
      // `SessionStore.updateContext`'s doc comment. `priorTurnsCompleted` is the one thing this
      // session actually remembers about itself; everything else comes fresh from this request,
      // so a dispute whose facts changed (e.g. new evidence) or a session that's never seen
      // dispute/workspace facts at all can never end up holding stale ones.
      const freshContext = buildAgentContext({
        conversationId: sessionId,
        conversationType: config.mode,
        connectedSources: requestContext?.connectedSources,
        dispute: requestContext?.dispute,
        workspace: requestContext?.workspace,
        priorTurnsCompleted: session.context.investigation.turnsCompleted,
      });
      sessionStore.updateContext(sessionId, freshContext);
      // This runtime specifically (not the legacy one — see server/agent/runtime.ts's own
      // buildSystemPrompt, which has real tools) has no tool-calling loop yet, so it's the only
      // caller that needs to say so — buildContextPrompt itself stays tool-availability-agnostic.
      const noToolsCaveat =
        freshContext.conversationType === "dispute"
          ? " You do not have live investigation tools available in this conversation yet — if asked to look " +
            "up something not covered by the known facts above, say plainly that deeper investigation isn't " +
            "wired up in this mode yet rather than guessing at details."
          : "";
      const systemPrompt = buildContextPrompt(freshContext) + noToolsCaveat;

      // The model sees the session's real prior turns plus this new user message — never the
      // client's resent history for an already-known session; that accumulated transcript is what
      // makes server-side memory a fact rather than a claim (docs/AI_ASSISTANT_ARCHITECTURE.md §4).
      const transcriptForModel: SessionTranscriptEntry[] = [
        ...session.transcript,
        { role: "user", text: userMessage },
      ];

      let fullText = "";
      await llmClient.streamReply({
        systemPrompt,
        transcript: transcriptForModel,
        context: freshContext,
        signal,
        onDelta: async (delta) => {
          fullText += delta;
          await onEvent({ type: "delta", text: delta });
        },
      });

      session.transcript.push({ role: "user", text: userMessage }, { role: "assistant", text: fullText });
      session.updatedAt = new Date().toISOString();
      // A completed turn is what "investigation progress" tracks in this phase (no tools yet to
      // report richer signal — see server/agent/tools/index.ts) — advance it only now that the
      // turn genuinely finished, not in the pre-computed `freshContext` above.
      sessionStore.updateContext(sessionId, {
        ...freshContext,
        investigation: { status: "in_progress", turnsCompleted: freshContext.investigation.turnsCompleted + 1 },
      });
      await onEvent({ type: "done", text: fullText });
    });
  } catch (err) {
    // Client-initiated cancellation is detected via `signal.aborted` — the real Anthropic SDK
    // throws `APIUserAbortError` on an aborted stream, whose `.name` is the generic "Error", not
    // "AbortError" (only StubStreamClient's synthetic DOMException happens to set that name), so
    // checking the error's name/class is unreliable. The signal itself is the source of truth.
    if (signal?.aborted) {
      // Cancelled by the client mid-stream — no error event needed, the caller already knows.
      return;
    }
    const message = err instanceof Error ? err.message : "The shared agent failed unexpectedly.";
    await onEvent({ type: "error", message });
  }
}
