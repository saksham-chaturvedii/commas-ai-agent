import Anthropic from "@anthropic-ai/sdk";
import type { StreamReplyArgs, StreamingLlmClient } from "./types.js";

const DEFAULT_MODEL = "claude-opus-5";

/**
 * Real streaming LLM client for the shared agent — only constructed when ANTHROPIC_API_KEY is
 * set (server/app.ts). This is the first component in the pipeline to actually call
 * `@anthropic-ai/sdk`'s streaming API (`client.messages.stream()`); the legacy `AnthropicLlmClient`
 * (server/llm/anthropicClient.ts) uses the non-streaming `messages.create()` and has never been
 * exercised live in any recorded session (docs/AI_ASSISTANT_BASELINE.md §7.3) — this file is
 * deliberately new and separate rather than a rewrite of that one, so the legacy request/response
 * path used by dispute-context chats is untouched.
 *
 * Model is configurable via `AGENT_MODEL` (falls back to `claude-opus-5`) so a faster/cheaper
 * model can be swapped in for live verification without a code change.
 */
export class AnthropicStreamClient implements StreamingLlmClient {
  private client: Anthropic;
  private model: string;

  constructor(apiKey: string, model: string = process.env.AGENT_MODEL || DEFAULT_MODEL) {
    this.client = new Anthropic({ apiKey });
    this.model = model;
  }

  async streamReply({ systemPrompt, transcript, onDelta, signal }: StreamReplyArgs): Promise<void> {
    const messages: Anthropic.MessageParam[] = transcript.map((t) => ({ role: t.role, content: t.text }));

    const stream = this.client.messages.stream(
      {
        model: this.model,
        max_tokens: 2048,
        system: systemPrompt,
        thinking: { type: "adaptive" },
        messages,
      },
      { signal },
    );

    stream.on("text", (delta) => {
      void onDelta(delta);
    });

    // Resolves once the model's turn is fully complete; text deltas have already been forwarded
    // via the "text" listener above by the time this returns. Propagates auth/network/abort
    // errors to the caller (server/agent/runtime/sharedAgent.ts), which maps them to a
    // `{type:"error"}` stream event rather than letting a raw SDK error reach the client.
    await stream.finalMessage();
  }
}
