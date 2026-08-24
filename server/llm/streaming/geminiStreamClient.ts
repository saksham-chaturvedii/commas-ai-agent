import { AgentError } from "../../agent/errors.js";
import { sanitizeSchemaForGemini } from "../geminiSchema.js";
import type { ToolCallRecord } from "../types.js";
import type { StreamStepArgs, StreamStepResult, StreamingLlmClient } from "./types.js";

// See server/llm/geminiClient.ts's comment — gemini-2.5-flash was retired for new users,
// confirmed live via the API's own 404 pointing at gemini-3.6-flash.
const DEFAULT_MODEL = "gemini-3.6-flash";
const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

/**
 * Real streaming LLM client for the shared agent, backed by Google's Gemini API — the
 * genuinely-free counterpart to AnthropicStreamClient (see server/llm/geminiClient.ts's doc
 * comment for why Gemini, not Anthropic, is the free default). Uses Gemini's
 * `:streamGenerateContent?alt=sse` endpoint, which returns the same incremental-text-then-
 * optional-function-call shape as Anthropic's streaming API: text arrives as it's generated
 * (forwarded via `onDelta`), a function call arrives as one complete chunk, never streamed
 * token-by-token (matching StreamingLlmClient's documented contract).
 */
export class GeminiStreamClient implements StreamingLlmClient {
  constructor(
    private apiKey: string,
    private model: string = process.env.GEMINI_MODEL || DEFAULT_MODEL,
  ) {}

  async streamStep({ systemPrompt, transcript, availableTools, toolHistory, onDelta, signal }: StreamStepArgs): Promise<StreamStepResult> {
    const contents = [
      ...transcript.map((t) => ({ role: t.role === "assistant" ? "model" : "user", parts: [{ text: t.text }] })),
      ...toolHistoryToContents(toolHistory),
    ];

    const body: Record<string, unknown> = {
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents,
    };
    if (availableTools.length > 0) {
      body.tools = [
        {
          functionDeclarations: availableTools.map((t) => ({
            name: t.name,
            description: t.description,
            parameters: sanitizeSchemaForGemini(t.inputSchema),
          })),
        },
      ];
    }

    let res: Response;
    try {
      res = await fetch(`${API_BASE}/${this.model}:streamGenerateContent?alt=sse`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": this.apiKey },
        body: JSON.stringify(body),
        signal,
      });
    } catch (err) {
      console.error("[gemini-stream] request failed:", err instanceof Error ? err.message : err);
      throw new AgentError("server_unavailable", "Could not reach the LLM.", err);
    }

    if (!res.ok || !res.body) {
      const raw = await res.text().catch(() => "");
      console.error(`[gemini-stream] request failed: ${res.status} ${raw}`);
      throw classifyGeminiError(res.status, raw);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let fullText = "";

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

        let chunk: GeminiStreamChunk;
        try {
          chunk = JSON.parse(payload);
        } catch {
          continue; // a partial/malformed frame — skip rather than crash the stream
        }

        const parts = chunk.candidates?.[0]?.content?.parts ?? [];
        const functionCallPart = parts.find((p) => p.functionCall);
        if (functionCallPart?.functionCall) {
          return {
            type: "tool_call",
            toolCallId: `gemini-${crypto.randomUUID()}`,
            toolName: functionCallPart.functionCall.name,
            input: functionCallPart.functionCall.args ?? {},
          };
        }
        for (const part of parts) {
          if (part.text) {
            fullText += part.text;
            await onDelta(part.text);
          }
        }
      }
    }

    return { type: "final", text: fullText };
  }
}

interface GeminiStreamChunk {
  candidates?: {
    content?: {
      parts?: { text?: string; functionCall?: { name: string; args?: Record<string, unknown> } }[];
    };
  }[];
}

/** See server/llm/geminiClient.ts's identical helper for why this is plain text, not
 * structured functionCall/functionResponse parts (confirmed live: a 400 for a missing
 * thought_signature ToolCallRecord has no field to carry). */
function toolHistoryToContents(toolHistory: ToolCallRecord[]) {
  const contents: { role: string; parts: unknown[] }[] = [];
  for (const record of toolHistory) {
    contents.push({ role: "model", parts: [{ text: `Calling ${record.toolName}(${JSON.stringify(record.input)})` }] });
    contents.push({
      role: "user",
      parts: [{ text: `Tool result for ${record.toolName}: ${JSON.stringify({ ok: record.result?.ok ?? true, data: record.result?.data ?? null })}` }],
    });
  }
  return contents;
}

function classifyGeminiError(status: number, rawBody: string): AgentError {
  if (status === 401 || status === 403) {
    return new AgentError("auth_failed", "The Gemini API key is invalid.", rawBody);
  }
  if (status === 429) {
    return new AgentError("tool_error", "The LLM is rate-limited right now — try again shortly.", rawBody);
  }
  if (status >= 500) {
    return new AgentError("server_unavailable", "Could not reach the LLM.", rawBody);
  }
  return new AgentError("tool_error", "The LLM request failed.", rawBody);
}
