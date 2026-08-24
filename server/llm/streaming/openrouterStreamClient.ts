import { AgentError } from "../../agent/errors.js";
import { classifyOpenRouterError } from "../openrouterClient.js";
import type { ToolCallRecord } from "../types.js";
import type { StreamStepArgs, StreamStepResult, StreamingLlmClient } from "./types.js";

const DEFAULT_MODEL = "meta-llama/llama-3.3-70b-instruct:free";
const API_URL = "https://openrouter.ai/api/v1/chat/completions";

/**
 * Real streaming LLM client for the shared agent, backed by OpenRouter — see
 * server/llm/openrouterClient.ts's doc comment for why. Uses OpenAI-shaped SSE streaming:
 * `choices[0].delta.content` for incremental text (forwarded via `onDelta`), and
 * `choices[0].delta.tool_calls[].function.arguments` for a tool call's arguments, which arrive
 * as successive string FRAGMENTS keyed by `index` that must be concatenated — unlike
 * Anthropic/Gemini, where a tool call arrives as one complete block. Never partially resolves a
 * tool call: accumulates every fragment until the stream ends, then parses the full JSON once.
 */
export class OpenRouterStreamClient implements StreamingLlmClient {
  constructor(
    private apiKey: string,
    private model: string = process.env.OPENROUTER_MODEL || DEFAULT_MODEL,
  ) {}

  async streamStep({ systemPrompt, transcript, availableTools, toolHistory, onDelta, signal }: StreamStepArgs): Promise<StreamStepResult> {
    const messages: Record<string, unknown>[] = [
      { role: "system", content: systemPrompt },
      ...transcript.map((t) => ({ role: t.role, content: t.text })),
      ...toolHistoryToMessages(toolHistory),
    ];

    const body: Record<string, unknown> = { model: this.model, messages, stream: true };
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
        signal,
      });
    } catch (err) {
      console.error("[openrouter-stream] request failed:", err instanceof Error ? err.message : err);
      throw new AgentError("server_unavailable", "Could not reach the LLM.", err);
    }

    if (!res.ok || !res.body) {
      const raw = await res.text().catch(() => "");
      console.error(`[openrouter-stream] request failed: ${res.status} ${raw}`);
      throw classifyOpenRouterError(res.status, raw);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let fullText = "";
    // Keyed by the delta's `index` — OpenAI-shaped streaming can interleave multiple tool
    // calls, each accumulating its own id/name/arguments fragments independently.
    const toolCallAccum = new Map<number, { id: string; name: string; args: string }>();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice("data:".length).trim();
        if (!payload || payload === "[DONE]") continue;

        let chunk: OpenRouterStreamChunk;
        try {
          chunk = JSON.parse(payload);
        } catch {
          continue; // a partial/malformed frame — skip rather than crash the stream
        }

        const delta = chunk.choices?.[0]?.delta;
        if (!delta) continue;

        if (delta.content) {
          fullText += delta.content;
          await onDelta(delta.content);
        }
        for (const toolCallDelta of delta.tool_calls ?? []) {
          const existing = toolCallAccum.get(toolCallDelta.index) ?? { id: "", name: "", args: "" };
          if (toolCallDelta.id) existing.id = toolCallDelta.id;
          if (toolCallDelta.function?.name) existing.name = toolCallDelta.function.name;
          if (toolCallDelta.function?.arguments) existing.args += toolCallDelta.function.arguments;
          toolCallAccum.set(toolCallDelta.index, existing);
        }
      }
    }

    const firstToolCall = [...toolCallAccum.values()][0];
    if (firstToolCall) {
      let parsedInput: Record<string, unknown> = {};
      try {
        parsedInput = JSON.parse(firstToolCall.args || "{}");
      } catch {
        // malformed arguments JSON — fall back to an empty input rather than crash the turn
      }
      return { type: "tool_call", toolCallId: firstToolCall.id, toolName: firstToolCall.name, input: parsedInput };
    }

    return { type: "final", text: fullText };
  }
}

interface OpenRouterStreamChunk {
  choices?: {
    delta?: {
      content?: string;
      tool_calls?: { index: number; id?: string; function?: { name?: string; arguments?: string } }[];
    };
  }[];
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
