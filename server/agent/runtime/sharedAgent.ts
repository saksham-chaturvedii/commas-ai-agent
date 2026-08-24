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
import type { StreamingLlmClient } from "../../llm/streaming/types.js";

export type AgentStreamEvent =
  | { type: "delta"; text: string }
  | { type: "done"; text: string }
  | { type: "error"; message: string };

export interface RunSharedAgentArgs {
  sessionId: string;
  config: SessionConfig;
  userMessage: string;
  /** Bootstraps a brand-new session's memory from client-sent text history — see
   * `SessionStore.resolve`'s doc comment for exactly when this applies. */
  bootstrapHistory?: SessionTranscriptEntry[];
  llmClient: StreamingLlmClient;
  sessionStore: SessionStore;
  onEvent: (event: AgentStreamEvent) => void | Promise<void>;
  signal?: AbortSignal;
}

export async function runSharedAgent(args: RunSharedAgentArgs): Promise<void> {
  const { sessionId, config, userMessage, bootstrapHistory, llmClient, sessionStore, onEvent, signal } = args;

  try {
    // Serialized per sessionId: two overlapping requests for the same session (same chat open in
    // two tabs/devices) must not both snapshot the transcript before either writes back — see
    // `SessionStore.runExclusive`'s doc comment. Different sessions run fully concurrently.
    await sessionStore.runExclusive(sessionId, async () => {
      const session = sessionStore.resolve(sessionId, config, bootstrapHistory);
      const systemPrompt = buildContextPrompt(session);

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
        signal,
        onDelta: async (delta) => {
          fullText += delta;
          await onEvent({ type: "delta", text: delta });
        },
      });

      session.transcript.push({ role: "user", text: userMessage }, { role: "assistant", text: fullText });
      session.updatedAt = new Date().toISOString();
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
