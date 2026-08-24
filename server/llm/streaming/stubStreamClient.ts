import { StubLlmClient } from "../stubClient.js";
import { pageContextFromAgentContext } from "../../agent/context/model.js";
import type { ConversationTurn } from "../../types.js";
import type { StreamStepArgs, StreamStepResult, StreamingLlmClient } from "./types.js";

/**
 * Deterministic streaming stand-in for the shared agent, used whenever ANTHROPIC_API_KEY isn't
 * configured — the same reason `server/llm/stubClient.ts` exists for the legacy runtime. Reuses
 * that exact `StubLlmClient` for its reasoning (tool selection AND the scripted final answer)
 * instead of a second, separately-tuned scripted engine here — the same "one shared reasoning
 * engine, not two" principle already applied to the context model (server/agent/context/model.ts)
 * now applied to the LLM layer. `pageContextFromAgentContext` bridges this phase's `AgentContext`
 * into the `PageContext` shape `StubLlmClient` already understands.
 *
 * Only the DELIVERY is different from the legacy stub: once `StubLlmClient` decides on a final
 * answer, this streams it word-by-word with a small delay, so the streaming transport (SSE
 * endpoint → fetch reader → incremental UI update) is genuinely exercised end to end even with no
 * live model available. A tool-call decision streams nothing — it resolves immediately, exactly
 * like a real model's `tool_use` block (never token-by-token — see StreamingLlmClient's doc
 * comment).
 */

const CHUNK_DELAY_MS = 35;

/** Splits into word-sized deltas (each carrying its own leading space, except the first word) so
 * a client reassembling deltas in order reproduces the exact original text. */
function chunkText(text: string): string[] {
  const words = text.split(" ");
  return words.map((w, i) => (i === 0 ? w : ` ${w}`));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class StubStreamClient implements StreamingLlmClient {
  private inner = new StubLlmClient();

  async streamStep({ systemPrompt, transcript, availableTools, toolHistory, context, onDelta, signal }: StreamStepArgs): Promise<StreamStepResult> {
    const last = transcript[transcript.length - 1];
    const userPrompt = last?.role === "user" ? last.text : "";
    const conversationHistory: ConversationTurn[] = transcript.slice(0, -1).map((t) => ({ role: t.role, text: t.text }));

    const step = await this.inner.nextStep({
      systemPrompt,
      userPrompt,
      context: context ? pageContextFromAgentContext(context) : undefined,
      availableTools,
      conversationHistory,
      toolHistory,
    });

    if (step.type === "tool_call") return step;

    for (const chunk of chunkText(step.text)) {
      if (signal?.aborted) {
        throw new DOMException("The stream was aborted.", "AbortError");
      }
      await onDelta(chunk);
      await delay(CHUNK_DELAY_MS);
    }
    return { type: "final", text: step.text };
  }
}
