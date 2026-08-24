import type { SourceAdapter } from "../adapters/types.js";
import type { RegisteredTool } from "./registry.js";
import type { LlmClient, LlmToolDef, ToolCallRecord } from "../llm/types.js";
import { AgentError, classifyError } from "./errors.js";
import { agentContextFromPageContext } from "./context/model.js";
import { buildContextPrompt } from "./context/buildContext.js";
import type {
  AgentRunResponse,
  ConversationTurn,
  PageContext,
  ProgressStep,
  SourceId,
  ToolSummaryItem,
} from "../types.js";

/**
 * The Agent runtime: User → Agent → LLM → source adapter → source → tool result → LLM →
 * next tool or final answer (docs/ARCHITECTURE.md §15, extended for multiple sources). The
 * Agent never talks to a source directly — every data access goes through the `SourceAdapter`
 * registered for that tool's sourceId (server/adapters/), never a hardcoded per-source branch
 * here. Write-classified tools always pause for approval (`pendingApproval`) instead of
 * executing — `runAgentTurn` starts a run, `resumeAfterApproval` continues one past that pause.
 */

const MAX_ITERATIONS = 6;
const TOOL_TIMEOUT_MS = 10_000;

export interface RunAgentTurnArgs {
  prompt: string;
  enabledSources: SourceId[];
  context?: PageContext;
  conversationHistory: ConversationTurn[];
  llmClient: LlmClient;
  adapters: SourceAdapter[];
  registry: Map<string, RegisteredTool>;
}

export interface ResumeAfterApprovalArgs {
  decision: "approve" | "decline";
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
  /** The prompt that originally led to this pending approval — replayed so the LLM has the
   * same question in view when it's asked to continue. */
  prompt: string;
  enabledSources: SourceId[];
  context?: PageContext;
  conversationHistory: ConversationTurn[];
  llmClient: LlmClient;
  adapters: SourceAdapter[];
  registry: Map<string, RegisteredTool>;
}

export async function runAgentTurn(args: RunAgentTurnArgs): Promise<AgentRunResponse> {
  const { prompt, enabledSources, context, conversationHistory, llmClient, adapters, registry } = args;
  return runLoop({
    prompt,
    context,
    conversationHistory,
    llmClient,
    adapters,
    registry,
    availableTools: availableToolsFor(enabledSources, registry),
    systemPrompt: buildSystemPrompt(context),
    toolHistory: [],
    steps: [],
    toolSummary: [],
    startIteration: 0,
  });
}

export async function resumeAfterApproval(args: ResumeAfterApprovalArgs): Promise<AgentRunResponse> {
  const { decision, toolCallId, toolName, input, prompt, enabledSources, context, conversationHistory, llmClient, adapters, registry } = args;

  const steps: ProgressStep[] = [];
  const toolSummary: ToolSummaryItem[] = [];
  const toolHistory: ToolCallRecord[] = [];

  const registered = registry.get(toolName);
  const sourceId: SourceId = registered?.sourceId ?? "commas";
  const label = registered?.progressLabel ?? `Running ${toolName}…`;

  if (decision === "decline") {
    steps.push({ id: `${sourceId}-${toolName}-declined`, sourceId, classification: "write", label: `Declined: ${registered?.displayName ?? toolName}` });
    toolSummary.push({ sourceId, label: registered?.displayName ?? toolName, ok: false });
    toolHistory.push({ toolCallId, toolName, input, result: { ok: false, data: "The user declined this action." } });
  } else {
    let ok = true;
    let resultData: unknown = null;
    try {
      const adapter = findAdapter(adapters, sourceId);
      if (!adapter) throw new AgentError("server_unavailable", `No adapter connected for ${sourceId}.`);
      const toolResult = await withTimeout(adapter.callTool(toolName, input), TOOL_TIMEOUT_MS);
      ok = !toolResult.isError;
      resultData = toolResult.data;
    } catch (err) {
      ok = false;
      resultData = classifyError(err).message;
    }
    steps.push({ id: `${sourceId}-${toolName}-approved`, sourceId, classification: "write", label });
    toolSummary.push({ sourceId, label: registered?.displayName ?? toolName, ok });
    toolHistory.push({ toolCallId, toolName, input, result: { ok, data: resultData } });
  }

  return runLoop({
    prompt,
    context,
    conversationHistory,
    llmClient,
    adapters,
    registry,
    availableTools: availableToolsFor(enabledSources, registry),
    systemPrompt: buildSystemPrompt(context),
    toolHistory,
    steps,
    toolSummary,
    startIteration: 1,
  });
}

interface LoopState {
  prompt: string;
  context?: PageContext;
  conversationHistory: ConversationTurn[];
  llmClient: LlmClient;
  adapters: SourceAdapter[];
  registry: Map<string, RegisteredTool>;
  availableTools: LlmToolDef[];
  systemPrompt: string;
  toolHistory: ToolCallRecord[];
  steps: ProgressStep[];
  toolSummary: ToolSummaryItem[];
  startIteration: number;
}

async function runLoop(state: LoopState): Promise<AgentRunResponse> {
  const { prompt, context, conversationHistory, llmClient, adapters, registry, availableTools, systemPrompt, toolHistory, steps, toolSummary, startIteration } = state;

  try {
    for (let i = startIteration; i < MAX_ITERATIONS; i++) {
      const step = await llmClient.nextStep({ systemPrompt, userPrompt: prompt, context, availableTools, conversationHistory, toolHistory });

      if (step.type === "final") {
        return { steps, answer: step.text, toolSummary };
      }

      const registered = registry.get(step.toolName);
      const sourceId: SourceId = registered?.sourceId ?? "commas";
      const classification = registered?.classification ?? "write";
      const label = registered?.progressLabel ?? `Running ${step.toolName}…`;

      // Write tools never auto-execute — pause here and let the client round-trip through
      // POST /api/agent/approve (resumeAfterApproval) before anything runs.
      if (classification === "write") {
        return {
          steps,
          answer: "",
          toolSummary,
          pendingApproval: {
            toolCallId: step.toolCallId,
            toolName: step.toolName,
            input: step.input,
            summary: buildApprovalSummary(registered, step.input),
          },
        };
      }

      let ok = true;
      let resultData: unknown = null;
      try {
        const adapter = findAdapter(adapters, sourceId);
        if (!adapter) throw new AgentError("server_unavailable", `No adapter connected for ${sourceId}.`);
        const toolResult = await withTimeout(adapter.callTool(step.toolName, step.input), TOOL_TIMEOUT_MS);
        ok = !toolResult.isError;
        resultData = toolResult.data;
      } catch (err) {
        // A tool-level failure is recoverable — hand it back to the LLM so it can explain
        // what it couldn't do (PROTOTYPE_SPEC.md §4.7), rather than aborting the whole run.
        ok = false;
        resultData = classifyError(err).message;
      }

      steps.push({ id: `${sourceId}-${step.toolName}-${i}`, sourceId, classification, label });
      toolSummary.push({ sourceId, label: registered?.displayName ?? step.toolName, ok });
      toolHistory.push({ toolCallId: step.toolCallId, toolName: step.toolName, input: step.input, result: { ok, data: resultData } });
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

function findAdapter(adapters: SourceAdapter[], sourceId: SourceId) {
  return adapters.find((a) => a.sourceId === sourceId);
}

/** Tools from every source enabled for this chat — read AND write (the LLM must be able to
 * see a write tool exists to propose it; the runtime, not tool visibility, is what gates
 * execution). */
function availableToolsFor(enabledSources: SourceId[], registry: Map<string, RegisteredTool>): LlmToolDef[] {
  return Array.from(registry.values())
    .filter((t) => enabledSources.includes(t.sourceId))
    .map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }));
}

function buildApprovalSummary(registered: RegisteredTool | undefined, input: Record<string, unknown>): string {
  if (registered?.name === "commas_mark_dispute_response_ready") {
    const id = typeof input.dispute_id === "string" ? input.dispute_id : "this dispute";
    return `Mark the evidence response for Dispute #${id} as ready to submit. (Simulated — nothing is actually sent anywhere.)`;
  }
  return `Run ${registered?.displayName ?? "this action"}.`;
}

/**
 * Builds the tool-calling loop's system prompt from the shared context model
 * (server/agent/context/{model,buildContext}.ts) — the same representation and rendering the
 * shared agent runtime uses, so "GLOBAL vs DISPUTE, and which dispute" is decided in exactly one
 * place across both runtimes, not reimplemented here. This runtime stays stateless by design
 * (no session — see server/agent/README.md), so it builds a fresh `AgentContext` from this
 * request's own `PageContext` every call; there's nothing here for one call to leak into another.
 * The tool-availability prose (below) is a separate concern the shared context model doesn't
 * cover yet (it has no tool inventory — see server/agent/tools/index.ts), so it's appended here,
 * specific to this runtime's real tool-calling loop.
 */
function buildSystemPrompt(context?: PageContext): string {
  const toolsPrefix =
    "You are the Commas AI Agent. Help the seller by looking up customers, transactions, and " +
    "disputes in Commas, and by checking their connected apps (Google Calendar, Zoom, Fathom, " +
    "Gmail, GoHighLevel) when useful. Decide for yourself which tools you need and in what " +
    "order — don't assume a fixed sequence, and never state a fact about their data that didn't " +
    "come from a tool result.\n\n";
  return toolsPrefix + buildContextPrompt(agentContextFromPageContext(context?.id ?? "no-context", context));
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
