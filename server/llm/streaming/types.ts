/**
 * The shared agent's LLM abstraction (docs/AI_ASSISTANT_ARCHITECTURE.md §2, "LLM REASONING").
 * Deliberately separate from `server/llm/types.ts`'s `LlmClient` — that interface is
 * request/response shaped (`nextStep()` returns once per turn) and continues to back the legacy
 * runtime unchanged. `StreamingLlmClient` is delta-shaped: it resolves once the full reply has
 * been delivered, but calls `onDelta` as text actually arrives, which is what lets
 * `server/agent/runtime/sharedAgent.ts` forward real incremental text to the SSE endpoint instead
 * of waiting for one big response.
 */

export interface StreamingTranscriptEntry {
  role: "user" | "assistant";
  text: string;
}

export interface StreamReplyArgs {
  systemPrompt: string;
  /** The full transcript to answer, INCLUDING the just-added user turn as the last entry —
   * everything before it is genuine prior memory the session already holds. */
  transcript: StreamingTranscriptEntry[];
  onDelta: (delta: string) => void | Promise<void>;
  signal?: AbortSignal;
}

export interface StreamingLlmClient {
  /** Streams a reply to the last (user) entry in `transcript`. Resolves once the full reply has
   * been delivered via `onDelta`; rejects on failure (auth, network, or an aborted signal). */
  streamReply(args: StreamReplyArgs): Promise<void>;
}
