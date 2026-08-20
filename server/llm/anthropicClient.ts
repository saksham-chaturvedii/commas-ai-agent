import Anthropic from "@anthropic-ai/sdk";
import { AgentError } from "../agent/errors.js";
import type { LlmClient, LlmStepInput, LlmStepResult } from "./types.js";

/**
 * Real LLM client — only constructed when ANTHROPIC_API_KEY is set (server/index.ts). Not
 * exercised in this session's testing (no key available in this environment — see
 * docs/active-context.md), but this is production code, not a placeholder: it implements the
 * same LlmClient interface as StubLlmClient, so the agent runtime is identical either way.
 */
export class AnthropicLlmClient implements LlmClient {
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async nextStep(input: LlmStepInput): Promise<LlmStepResult> {
    const { systemPrompt, userPrompt, availableTools, history } = input;

    const messages: Anthropic.MessageParam[] = [{ role: "user", content: userPrompt }];
    for (const record of history) {
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

    let response: Anthropic.Message;
    try {
      response = await this.client.messages.create({
        model: "claude-opus-5",
        max_tokens: 4096,
        system: systemPrompt,
        thinking: { type: "adaptive" },
        tools: tools.length > 0 ? tools : undefined,
        messages,
      });
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
