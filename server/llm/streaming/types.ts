/**
 * The shared agent's LLM abstraction (docs/AI_ASSISTANT_ARCHITECTURE.md §2, "LLM REASONING").
 * Deliberately separate from `server/llm/types.ts`'s `LlmClient` — that interface is
 * request/response shaped (`nextStep()` returns once per turn) and continues to back the legacy
 * runtime unchanged. `StreamingLlmClient` is delta-shaped: `streamStep()` calls `onDelta` as
 * final-answer text actually arrives, which is what lets `server/agent/runtime/sharedAgent.ts`
 * forward real incremental text to the SSE endpoint instead of waiting for one big response.
 *
 * `streamStep()` (not `streamReply()` — renamed this phase) returns one step at a time, exactly
 * like `LlmClient.nextStep()`: either a tool call to execute, or the final answer. Reusing that
 * same one-step-at-a-time shape (and the same `LlmToolDef`/`ToolCallRecord` types) means the tool-
 * calling LOOP itself (server/agent/runtime/sharedAgent.ts) is structurally the same loop
 * server/agent/runtime.ts already runs — only the LLM-call primitive underneath differs (streamed
 * vs. atomic), not the agent's own control flow. A tool-call decision is never streamed
 * token-by-token (per Anthropic's own API, `tool_use` blocks arrive as a discrete unit); only
 * text the model is producing as a reply streams via `onDelta`.
 */
import type { AgentContext } from "../../agent/context/model.js";
import type { LlmToolDef, ToolCallRecord } from "../types.js";

export interface StreamingTranscriptEntry {
  role: "user" | "assistant";
  text: string;
}

export interface StreamStepArgs {
  systemPrompt: string;
  /** The full transcript to answer, INCLUDING the just-added user turn as the last entry —
   * everything before it is genuine prior memory the session already holds. */
  transcript: StreamingTranscriptEntry[];
  /** Tools available this turn. Empty when no tools are registered/enabled for this session —
   * a well-behaved implementation must then always return `{type:"final"}` immediately. */
  availableTools: LlmToolDef[];
  /** Tool calls already made (and resolved) earlier in THIS turn only — never carried over from
   * a prior turn, matching `LlmStepInput.toolHistory`'s exact semantics. */
  toolHistory: ToolCallRecord[];
  /** The same structured context `systemPrompt` was rendered from (server/agent/context/
   * model.ts) — passed alongside the prose, not instead of it, mirroring the legacy
   * `LlmClient.nextStep()`'s own `context` field (server/llm/types.ts). A real model only needs
   * the prose; `StubStreamClient` uses this to give genuinely data-grounded scripted answers. */
  context?: AgentContext;
  onDelta: (delta: string) => void | Promise<void>;
  signal?: AbortSignal;
}

export type StreamStepResult =
  | { type: "tool_call"; toolCallId: string; toolName: string; input: Record<string, unknown> }
  | { type: "final"; text: string };

export interface StreamingLlmClient {
  /**
   * Resolves once this step is fully decided: either a tool call to execute (`onDelta` will not
   * have fired — nothing to stream yet), or the final answer (`onDelta` fires as its text
   * streams in; the returned `text` is the same full text summed from those deltas). Rejects on
   * failure (auth, network, or an aborted signal) — never resolves with a fabricated answer.
   */
  streamStep(args: StreamStepArgs): Promise<StreamStepResult>;
}
