import type { PageContext, ProgressStep, SourceId, ToolSummaryItem } from "./types";

/**
 * Thin client for POST /api/agent/run — the only bridge between the UI and the real agent
 * backend (server/index.ts). No secrets live here; the request carries only the prompt,
 * which sources are enabled, and page context.
 */

export interface AgentRunPlan {
  steps: ProgressStep[];
  answer: string;
  toolSummary: ToolSummaryItem[];
  error?: { code: string; message: string };
}

export async function runAgentTurn(
  args: { prompt: string; enabledSources: SourceId[]; context?: PageContext },
  signal?: AbortSignal,
): Promise<AgentRunPlan> {
  const res = await fetch("/api/agent/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args),
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
