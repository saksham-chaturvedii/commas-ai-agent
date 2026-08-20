import type { ConversationTurn, PageContext } from "../types.js";

/** A tool as the LLM sees it — name/description/JSON-schema input, nothing else. */
export interface LlmToolDef {
  name: string;
  description?: string;
  inputSchema: unknown;
}

/** One tool call this turn, with its result once executed. */
export interface ToolCallRecord {
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
  result?: { ok: boolean; data: unknown };
}

export interface LlmStepInput {
  systemPrompt: string;
  userPrompt: string;
  context?: PageContext;
  availableTools: LlmToolDef[];
  /** Prior turns of this conversation (earlier messages), for real multi-turn memory —
   * does NOT include the current userPrompt. Capped by the caller (runtime.ts). */
  conversationHistory: ConversationTurn[];
  /** Tool calls already made (and resolved) earlier in THIS turn only. */
  toolHistory: ToolCallRecord[];
}

export type LlmStepResult =
  | { type: "tool_call"; toolCallId: string; toolName: string; input: Record<string, unknown> }
  | { type: "final"; text: string };

/**
 * The Agent's LLM abstraction. `AnthropicLlmClient` (real) and `StubLlmClient` (deterministic,
 * used when no ANTHROPIC_API_KEY is configured — see docs/active-context.md) both implement
 * this; the agent runtime (server/agent/runtime.ts) never knows which one it's talking to.
 */
export interface LlmClient {
  nextStep(input: LlmStepInput): Promise<LlmStepResult>;
}
