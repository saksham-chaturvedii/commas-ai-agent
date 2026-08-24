import { AgentError } from "../agent/errors.js";
import type { LlmClient, LlmStepInput, LlmStepResult, ToolCallRecord } from "./types.js";

// meta-llama/llama-3.3-70b-instruct:free was pulled from the free tier (confirmed live), and
// google/gemma-4-31b-it:free routes through Google AI Studio's own congested shared free pool
// (confirmed live via a 429 "temporarily rate-limited upstream") — this one is Nvidia-hosted,
// a different provider pool, and confirmed free + tool-calling-capable via OpenRouter's own
// public /api/v1/models listing.
const DEFAULT_MODEL = "nvidia/nemotron-3-super-120b-a12b:free";
const API_URL = "https://openrouter.ai/api/v1/chat/completions";

/**
 * Real LLM client backed by OpenRouter — a third genuinely-free option alongside Gemini,
 * switched to after Gemini's real free-tier limit (5 requests/minute for gemini-3.6-flash,
 * confirmed live) proved too tight for a multi-step tool-calling investigation in one turn.
 * OpenRouter proxies many providers behind one OpenAI-compatible API and publishes `:free`
 * model variants at zero cost. Implements the same `LlmClient` interface every other provider
 * does — no agent architecture change.
 *
 * Unlike Gemini, OpenAI-shaped tool calling assigns a real `id` per call and expects that same
 * id echoed back on the `tool` role message — `ToolCallRecord.toolCallId` maps onto it directly,
 * no synthesized id or provider-specific continuation token needed (contrast with Gemini's
 * `thought_signature` issue — see server/llm/geminiClient.ts's doc comment).
 */
export class OpenRouterLlmClient implements LlmClient {
  constructor(
    private apiKey: string,
    private model: string = process.env.OPENROUTER_MODEL || DEFAULT_MODEL,
  ) {}

  async nextStep(input: LlmStepInput): Promise<LlmStepResult> {
    const { systemPrompt, userPrompt, availableTools, toolHistory, conversationHistory } = input;

    const messages: Record<string, unknown>[] = [
      { role: "system", content: systemPrompt },
      ...conversationHistory.map((turn) => ({ role: turn.role, content: turn.text })),
      ...toolHistoryToMessages(toolHistory),
      { role: "user", content: userPrompt },
    ];

    const body: Record<string, unknown> = { model: this.model, messages };
    if (availableTools.length > 0) {
      body.tools = availableTools.map((t) => ({
        type: "function",
        function: { name: t.name, description: t.description, parameters: t.inputSchema },
      }));
    }

    let res: Response;
    try {
      res = await fetch(API_URL, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify(body),
      });
    } catch (err) {
      console.error("[openrouter] request failed:", err instanceof Error ? err.message : err);
      throw new AgentError("server_unavailable", "Could not reach the LLM.", err);
    }

    if (!res.ok) {
      const raw = await res.text();
      console.error(`[openrouter] request failed: ${res.status} ${raw}`);
      throw classifyOpenRouterError(res.status, raw);
    }

    const json = (await res.json()) as OpenRouterResponse;
    return parseOpenRouterMessage(json.choices?.[0]?.message);
  }
}

interface OpenRouterToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

interface OpenRouterMessage {
  content?: string | null;
  tool_calls?: OpenRouterToolCall[];
}

interface OpenRouterResponse {
  choices?: { message?: OpenRouterMessage }[];
}

function toolHistoryToMessages(toolHistory: ToolCallRecord[]): Record<string, unknown>[] {
  const messages: Record<string, unknown>[] = [];
  for (const record of toolHistory) {
    messages.push({
      role: "assistant",
      content: null,
      tool_calls: [{ id: record.toolCallId, type: "function", function: { name: record.toolName, arguments: JSON.stringify(record.input) } }],
    });
    messages.push({
      role: "tool",
      tool_call_id: record.toolCallId,
      content: JSON.stringify({ ok: record.result?.ok ?? true, data: record.result?.data ?? null }),
    });
  }
  return messages;
}

export function parseOpenRouterMessage(message: OpenRouterMessage | undefined): LlmStepResult {
  const toolCall = message?.tool_calls?.[0];
  if (toolCall) {
    let parsedInput: Record<string, unknown> = {};
    try {
      parsedInput = JSON.parse(toolCall.function.arguments || "{}");
    } catch {
      // malformed arguments JSON — fall back to an empty input rather than crash the turn
    }
    return { type: "tool_call", toolCallId: toolCall.id, toolName: toolCall.function.name, input: parsedInput };
  }
  return { type: "final", text: message?.content ?? "" };
}

export function classifyOpenRouterError(status: number, rawBody: string): AgentError {
  if (status === 401 || status === 403) {
    return new AgentError("auth_failed", "The OpenRouter API key is invalid.", rawBody);
  }
  if (status === 429) {
    return new AgentError("tool_error", "The LLM is rate-limited right now — try again shortly.", rawBody);
  }
  if (status >= 500) {
    return new AgentError("server_unavailable", "Could not reach the LLM.", rawBody);
  }
  return new AgentError("tool_error", "The LLM request failed.", rawBody);
}
