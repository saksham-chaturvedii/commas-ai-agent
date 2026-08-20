import type { CommasMcpClient } from "../mcp/client.js";
import type { RegisteredTool } from "./registry.js";
import type { LlmClient, LlmToolDef, ToolCallRecord } from "../llm/types.js";
import { AgentError, classifyError } from "./errors.js";
import type { AgentRunResponse, PageContext, ProgressStep, SourceId, ToolSummaryItem } from "../types.js";

/**
 * The Agent runtime: User → Agent → LLM → MCP client → Commas MCP server → tool result →
 * LLM → next tool or final answer (docs/ARCHITECTURE.md §15). The Agent never calls Commas
 * directly — every data access goes through `mcpClient`, which speaks the MCP protocol to
 * whatever server it's connected to (mock or real, see server/mcp/client.ts). Swapping
 * `llmClient` for AnthropicLlmClient doesn't change a line of this file.
 */

const MAX_ITERATIONS = 6;
const TOOL_TIMEOUT_MS = 10_000;

export interface RunAgentTurnArgs {
  prompt: string;
  enabledSources: SourceId[];
  context?: PageContext;
  llmClient: LlmClient;
  mcpClient: CommasMcpClient;
  registry: Map<string, RegisteredTool>;
}

export async function runAgentTurn(args: RunAgentTurnArgs): Promise<AgentRunResponse> {
  const { prompt, enabledSources, context, llmClient, mcpClient, registry } = args;

  const steps: ProgressStep[] = [];
  const toolSummary: ToolSummaryItem[] = [];
  const history: ToolCallRecord[] = [];

  // Disabled sources are excluded from the tool set entirely (PROTOTYPE_SPEC.md §4.2) — every
  // registered tool today is Commas-sourced, so this is the single gate for all of them.
  const commasEnabled = enabledSources.includes("commas");
  const availableTools: LlmToolDef[] = commasEnabled
    ? Array.from(registry.values())
        .filter((t) => t.classification === "read")
        .map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }))
    : [];

  const systemPrompt = buildSystemPrompt(context);

  try {
    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const step = await llmClient.nextStep({ systemPrompt, userPrompt: prompt, context, availableTools, history });

      if (step.type === "final") {
        return { steps, answer: step.text, toolSummary };
      }

      const registered = registry.get(step.toolName);
      const sourceId: SourceId = registered?.sourceId ?? "commas";
      const label = registered?.progressLabel ?? `Running ${step.toolName}…`;

      let ok = true;
      let resultData: unknown = null;
      try {
        const toolResult = await withTimeout(mcpClient.callTool(step.toolName, step.input), TOOL_TIMEOUT_MS);
        ok = !toolResult.isError;
        resultData = toolResult.data;
      } catch (err) {
        // A tool-level failure is recoverable — hand it back to the LLM so it can explain
        // what it couldn't do (PROTOTYPE_SPEC.md §4.7), rather than aborting the whole run.
        ok = false;
        resultData = classifyError(err).message;
      }

      steps.push({
        id: `${sourceId}-${step.toolName}-${i}`,
        sourceId,
        classification: registered?.classification ?? "write",
        label,
      });
      toolSummary.push({ sourceId, label: registered?.displayName ?? step.toolName, ok });
      history.push({ toolCallId: step.toolCallId, toolName: step.toolName, input: step.input, result: { ok, data: resultData } });
    }

    return {
      steps,
      answer: "I couldn't finish that within the step limit — try asking a narrower question.",
      toolSummary,
    };
  } catch (err) {
    // Unrecoverable: the LLM itself failed (auth, connectivity, malformed response) rather
    // than a single tool call. The UI gets a distinct error state, not a fabricated answer.
    const classified = err instanceof AgentError ? err : classifyError(err);
    return { steps, answer: "", toolSummary, error: { code: classified.code, message: classified.message } };
  }
}

function buildSystemPrompt(context?: PageContext): string {
  const base =
    "You are the Commas AI Agent. Help the seller by looking up customers, transactions, " +
    "and disputes in Commas using the available tools. Be concise and direct. Never state a " +
    "fact about their data that didn't come from a tool result.";
  if (context?.kind === "dispute") {
    return `${base} The seller is currently viewing ${context.label} — assume questions about "this dispute" refer to it.`;
  }
  return base;
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new AgentError("timeout", `Timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}
