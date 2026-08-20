import type { PageContext, PendingApproval, ProgressStep, SourceId, ToolSummaryItem } from "./types";

/**
 * Thin client for the agent backend (server/index.ts) — the only bridge between the UI and
 * the real agent. No secrets live here; requests carry only the prompt, conversation history
 * (text only), which sources are enabled, and page context.
 */

export interface ConversationTurn {
  role: "user" | "assistant";
  text: string;
}

export interface AgentRunPlan {
  steps: ProgressStep[];
  answer: string;
  toolSummary: ToolSummaryItem[];
  error?: { code: string; message: string };
  pendingApproval?: PendingApproval;
}

async function postJson(path: string, body: unknown, signal?: AbortSignal): Promise<AgentRunPlan> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  try {
    return await res.json();
  } catch {
    return {
      steps: [],
      answer: "",
      toolSummary: [],
      error: { code: "malformed_result", message: "The agent returned an unreadable response." },
    };
  }
}

export function runAgentTurn(
  args: { prompt: string; enabledSources: SourceId[]; context?: PageContext; history: ConversationTurn[] },
  signal?: AbortSignal,
): Promise<AgentRunPlan> {
  return postJson("/api/agent/run", args, signal);
}

export function approveAgentAction(
  args: {
    decision: "approve" | "decline";
    toolCallId: string;
    toolName: string;
    input: Record<string, unknown>;
    prompt: string;
    enabledSources: SourceId[];
    context?: PageContext;
    history: ConversationTurn[];
  },
  signal?: AbortSignal,
): Promise<AgentRunPlan> {
  return postJson("/api/agent/approve", args, signal);
}
