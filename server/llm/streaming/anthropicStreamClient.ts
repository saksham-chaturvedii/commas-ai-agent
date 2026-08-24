import Anthropic from "@anthropic-ai/sdk";
import { AgentError } from "../../agent/errors.js";
import type { StreamStepArgs, StreamStepResult, StreamingLlmClient } from "./types.js";

const DEFAULT_MODEL = "claude-opus-5";

/**
 * Real streaming LLM client for the shared agent — only constructed when ANTHROPIC_API_KEY is
 * set (server/app.ts). Uses `@anthropic-ai/sdk`'s streaming API (`client.messages.stream()`)
 * with `tools` attached, so a single call can both stream reply text AND signal a tool_use
 * request — the same request/response shape as the legacy `AnthropicLlmClient.nextStep()`
 * (server/llm/anthropicClient.ts), just decided over a stream instead of one blocking call. Text
 * the model produces streams via `onDelta` as it arrives, whether or not this step ultimately
 * resolves as a tool call — a model that writes a line of preamble before calling a tool (real,
 * common Anthropic behavior) is expected to have that preamble visible immediately, exactly as a
 * real assistant UI would show it.
 */
export class AnthropicStreamClient implements StreamingLlmClient {
  private client: Anthropic;
  private model: string;

  constructor(apiKey: string, model: string = process.env.AGENT_MODEL || DEFAULT_MODEL) {
    this.client = new Anthropic({ apiKey });
    this.model = model;
  }

  async streamStep({ systemPrompt, transcript, availableTools, toolHistory, onDelta, signal }: StreamStepArgs): Promise<StreamStepResult> {
    const messages: Anthropic.MessageParam[] = transcript.map((t) => ({ role: t.role, content: t.text }));
    for (const record of toolHistory) {
      messages.push({
        role: "assistant",
        content: [{ type: "tool_use", id: record.toolCallId, name: record.toolName, input: record.input }],
      });
      messages.push({
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: record.toolCallId,
            content: JSON.stringify(record.result?.data ?? null),
            is_error: record.result?.ok === false,
          },
        ],
      });
    }

    const tools: Anthropic.Tool[] = availableTools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: (t.inputSchema as Anthropic.Tool.InputSchema) ?? { type: "object" },
    }));

    const stream = this.client.messages.stream(
      {
        model: this.model,
        max_tokens: 2048,
        system: systemPrompt,
        thinking: { type: "adaptive" },
        tools: tools.length > 0 ? tools : undefined,
        messages,
      },
      { signal },
    );

    stream.on("text", (delta) => {
      void onDelta(delta);
    });

    let response: Anthropic.Message;
    try {
      response = await stream.finalMessage();
    } catch (err) {
      throw classifyAnthropicError(err);
    }

    if (response.stop_reason === "refusal") {
      throw new AgentError("tool_error", "The model declined to answer that.");
    }

    if (response.stop_reason === "tool_use") {
      const block = response.content.find((b) => b.type === "tool_use");
      if (!block) throw new AgentError("malformed_result", "The model signaled a tool call but didn't include one.");
      return {
        type: "tool_call",
        toolCallId: block.id,
        toolName: block.name,
        input: (block.input as Record<string, unknown>) ?? {},
      };
    }

    const textBlock = response.content.find((b) => b.type === "text");
    return { type: "final", text: textBlock?.text ?? "" };
  }
}

function classifyAnthropicError(err: unknown): AgentError {
  // Same reasoning as server/llm/anthropicClient.ts's classifier — the client-facing message is
  // always generic, so log the real one here or a failure is undiagnosable from the outside.
  console.error("[anthropic-stream] request failed:", err instanceof Error ? err.message : err);
  if (err instanceof Anthropic.AuthenticationError) {
    return new AgentError("auth_failed", "The Anthropic API key is invalid.", err);
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return new AgentError("server_unavailable", "Could not reach the LLM.", err);
  }
  if (err instanceof Anthropic.APIError) {
    return new AgentError("tool_error", "The LLM request failed.", err);
  }
  return new AgentError("unknown", "The LLM request failed unexpectedly.", err);
}
