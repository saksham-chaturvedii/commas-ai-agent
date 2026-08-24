import { AgentError } from "../agent/errors.js";
import { sanitizeSchemaForGemini } from "./geminiSchema.js";
import type { LlmClient, LlmStepInput, LlmStepResult, ToolCallRecord } from "./types.js";

const DEFAULT_MODEL = "gemini-2.5-flash";
const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

/**
 * Real LLM client backed by Google's Gemini API — the genuinely-free alternative to
 * AnthropicLlmClient (the Anthropic API has no free tier; Gemini's AI Studio keys do, with
 * published rate limits, no credit card required). Implements the exact same `LlmClient`
 * interface `StubLlmClient`/`AnthropicLlmClient` do, so the agent runtime (server/agent/
 * runtime.ts) never knows which provider it's talking to — same tool-calling loop, same
 * approval flow, same error shape.
 *
 * Uses plain `fetch` against the REST API directly rather than adding a new SDK dependency —
 * Gemini's request/response shape is simple enough (functionDeclarations / functionCall /
 * functionResponse) that a dedicated client library isn't needed here.
 */
export class GeminiLlmClient implements LlmClient {
  constructor(
    private apiKey: string,
    private model: string = process.env.GEMINI_MODEL || DEFAULT_MODEL,
  ) {}

  async nextStep(input: LlmStepInput): Promise<LlmStepResult> {
    const { systemPrompt, userPrompt, availableTools, toolHistory, conversationHistory } = input;

    const contents = [
      ...conversationHistory.map((turn) => ({
        role: turn.role === "assistant" ? "model" : "user",
        parts: [{ text: turn.text }],
      })),
      ...toolHistoryToContents(toolHistory),
      { role: "user", parts: [{ text: userPrompt }] },
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
      res = await fetch(`${API_BASE}/${this.model}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": this.apiKey },
        body: JSON.stringify(body),
      });
    } catch (err) {
      console.error("[gemini] request failed:", err instanceof Error ? err.message : err);
      throw new AgentError("server_unavailable", "Could not reach the LLM.", err);
    }

    if (!res.ok) {
      const raw = await res.text();
      console.error(`[gemini] request failed: ${res.status} ${raw}`);
      throw classifyGeminiError(res.status, raw);
    }

    const json = (await res.json()) as GeminiGenerateContentResponse;
    return parseGeminiResponse(json);
  }
}

interface GeminiGenerateContentResponse {
  candidates?: {
    content?: {
      parts?: { text?: string; functionCall?: { name: string; args?: Record<string, unknown> } }[];
    };
    finishReason?: string;
  }[];
  promptFeedback?: { blockReason?: string };
}

function toolHistoryToContents(toolHistory: ToolCallRecord[]) {
  const contents: { role: string; parts: unknown[] }[] = [];
  for (const record of toolHistory) {
    contents.push({
      role: "model",
      parts: [{ functionCall: { name: record.toolName, args: record.input } }],
    });
    contents.push({
      role: "user",
      parts: [
        {
          functionResponse: {
            name: record.toolName,
            response: { ok: record.result?.ok ?? true, result: record.result?.data ?? null },
          },
        },
      ],
    });
  }
  return contents;
}

function parseGeminiResponse(json: GeminiGenerateContentResponse): LlmStepResult {
  if (json.promptFeedback?.blockReason) {
    throw new AgentError("tool_error", "The model declined to answer that.");
  }
  const parts = json.candidates?.[0]?.content?.parts ?? [];
  const functionCallPart = parts.find((p) => p.functionCall);
  if (functionCallPart?.functionCall) {
    return {
      type: "tool_call",
      toolCallId: `gemini-${crypto.randomUUID()}`,
      toolName: functionCallPart.functionCall.name,
      input: functionCallPart.functionCall.args ?? {},
    };
  }
  const text = parts
    .map((p) => p.text ?? "")
    .join("")
    .trim();
  return { type: "final", text };
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
