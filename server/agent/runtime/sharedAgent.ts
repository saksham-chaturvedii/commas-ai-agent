/**
 * The shared agent runtime (docs/AI_ASSISTANT_ARCHITECTURE.md §2–§4) — one runtime for both
 * GLOBAL and DISPUTE session modes, driven entirely by the `SessionConfig` on the request. There
 * is no `DisputeAgent` class and no second code path: mode only changes what
 * `server/agent/context/buildContext.ts` puts in the system prompt.
 *
 * Now a real tool-calling loop: User request → LLM decides next step → either a tool call
 * (executed via the SAME `SourceAdapter`/registry the legacy runtime uses — see
 * server/agent/tools/index.ts for which tools this runtime is scoped to) or the final answer,
 * streamed incrementally via `StreamingLlmClient` (server/llm/streaming/). Structurally the same
 * loop as `server/agent/runtime.ts`'s `runLoop` — same `ToolCallRecord`/timeout/error-recovery
 * shape — because the loop's CONTROL FLOW doesn't depend on whether the LLM call underneath is
 * streamed or atomic; only the primitive differs.
 *
 * Deliberately does NOT replace `server/agent/runtime.ts` (the legacy loop): that runtime keeps
 * powering dispute-context chats — and therefore the Resolution Center's "Investigate with AI"
 * flow, the full 6-source tool set, and the write-approval pause — completely unchanged. This
 * runtime is currently reachable only from POST /api/agent/stream, used by the frontend for
 * global-mode chats (src/hooks/useChatStore.tsx).
 */
import type { SessionConfig, SessionTranscriptEntry } from "../sessions/store.js";
import { SessionStore } from "../sessions/store.js";
import { buildContextPrompt } from "../context/buildContext.js";
import { buildAgentContext, type DisputeFacts, type WorkspaceDisputeSummary } from "../context/model.js";
import { sharedAgentToolsFor } from "../tools/index.js";
import type { RegisteredTool } from "../registry.js";
import { AgentError, classifyError } from "../errors.js";
import type { SourceAdapter } from "../../adapters/types.js";
import type { StreamingLlmClient } from "../../llm/streaming/types.js";
import type { ToolCallRecord } from "../../llm/types.js";
import type { SourceId } from "../../types.js";

const MAX_ITERATIONS = 6;
const TOOL_TIMEOUT_MS = 10_000;

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
  /** The same adapters/registry server/app.ts already builds once for the legacy runtime —
   * passed straight through, never rebuilt here (server/agent/tools/index.ts decides which of
   * the registry's tools this runtime is actually allowed to see). */
  adapters: SourceAdapter[];
  registry: Map<string, RegisteredTool>;
  onEvent: (event: AgentStreamEvent) => void | Promise<void>;
  signal?: AbortSignal;
}

export async function runSharedAgent(args: RunSharedAgentArgs): Promise<void> {
  const {
    sessionId,
    config,
    userMessage,
    bootstrapHistory,
    requestContext,
    llmClient,
    sessionStore,
    adapters,
    registry,
    onEvent,
    signal,
  } = args;

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
      const enabledSources = requestContext?.connectedSources ?? [];
      const freshContext = buildAgentContext({
        conversationId: sessionId,
        conversationType: config.mode,
        connectedSources: enabledSources,
        dispute: requestContext?.dispute,
        workspace: requestContext?.workspace,
        priorTurnsCompleted: session.context.investigation.turnsCompleted,
      });
      sessionStore.updateContext(sessionId, freshContext);
      const systemPrompt = buildContextPrompt(freshContext);
      const availableTools = sharedAgentToolsFor(enabledSources, registry);

      // The model sees the session's real prior turns plus this new user message — never the
      // client's resent history for an already-known session; that accumulated transcript is what
      // makes server-side memory a fact rather than a claim (docs/AI_ASSISTANT_ARCHITECTURE.md §4).
      const transcriptForModel: SessionTranscriptEntry[] = [
        ...session.transcript,
        { role: "user", text: userMessage },
      ];

      let fullText = "";
      const toolHistory: ToolCallRecord[] = [];
      let finished = false;

      for (let i = 0; i < MAX_ITERATIONS && !finished; i++) {
        const step = await llmClient.streamStep({
          systemPrompt,
          transcript: transcriptForModel,
          availableTools,
          toolHistory,
          context: freshContext,
          signal,
          onDelta: async (delta) => {
            fullText += delta;
            await onEvent({ type: "delta", text: delta });
          },
        });

        if (step.type === "final") {
          // A tool-calling step can also stream preamble text before deciding to call a tool
          // (see AnthropicStreamClient's doc comment) — `fullText` already has everything from
          // every iteration's deltas, so nothing further to append here.
          finished = true;
          continue;
        }

        const registered = registry.get(step.toolName);
        const sourceId: SourceId = registered?.sourceId ?? "commas";

        let ok = true;
        let resultData: unknown = null;
        try {
          const adapter = adapters.find((a) => a.sourceId === sourceId);
          if (!adapter) throw new AgentError("server_unavailable", `No adapter connected for ${sourceId}.`);
          const toolResult = await withTimeout(adapter.callTool(step.toolName, step.input), TOOL_TIMEOUT_MS);
          ok = !toolResult.isError;
          resultData = toolResult.data;
        } catch (err) {
          // A tool-level failure is recoverable — hand it back to the LLM so it can explain what
          // it couldn't do, rather than aborting the whole turn (matches server/agent/runtime.ts).
          ok = false;
          resultData = classifyError(err).message;
        }
        toolHistory.push({ toolCallId: step.toolCallId, toolName: step.toolName, input: step.input, result: { ok, data: resultData } });
      }

      if (!finished) {
        const limitMessage = "I couldn't finish that within the step limit — try asking a narrower question.";
        fullText += limitMessage;
        await onEvent({ type: "delta", text: limitMessage });
      }

      session.transcript.push({ role: "user", text: userMessage }, { role: "assistant", text: fullText });
      session.updatedAt = new Date().toISOString();
      // A completed turn is what "investigation progress" tracks in this phase — advance it only
      // now that the turn genuinely finished, not in the pre-computed `freshContext` above.
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

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new AgentError("timeout", `Timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}
