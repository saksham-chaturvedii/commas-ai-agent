import type { PageContext, PendingApproval, ProgressStep, ProposedAction, SourceId, ToolSummaryItem } from "./types";

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
  /** Wire shape matches server/types.ts's `ProposedAction` (server `status` is always
   * "pending" — this client type reuses the richer `ProposedActionStatus` union since a message
   * carrying this plan advances it locally afterward). */
  proposedActions?: ProposedAction[];
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

/**
 * Client for the shared agent runtime's streaming endpoint (docs/AI_ASSISTANT_ARCHITECTURE.md
 * §2/§4) — POST /api/agent/stream, a real Server-Sent-Events response (not JSON). Deliberately
 * separate from `postJson`/`runAgentTurn` above, which remain untouched and still back dispute-
 * context chats via /api/agent/run.
 *
 * Not `EventSource` (which only supports GET and can't send a JSON body or an AbortSignal) —
 * plain `fetch` + a hand-rolled SSE frame parser, split on the blank-line frame separator per the
 * SSE wire format. No new dependency.
 */
/** Thrown ONLY when the server itself sent an `event: error` frame — the message is
 * server-authored and safe to show verbatim, exactly like the legacy JSON path's
 * `plan.error.message` (see ChatMessageList's error rendering). Any OTHER failure (the network
 * request itself rejecting, a non-2xx status, an unreadable response) throws a plain `Error`
 * instead, so callers can tell "the agent told us something went wrong" apart from "we couldn't
 * even talk to the agent" and show the fixed, product-voiced fallback for the latter — never a
 * raw fetch/browser error message (PRODUCT_READINESS_AUDIT.md P1-4: no dev-facing text). */
export class AgentStreamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentStreamError";
  }
}

export interface StreamAgentMessageArgs {
  sessionId: string;
  mode: "global" | "dispute";
  disputeId?: string;
  message: string;
  history: ConversationTurn[];
  /** Kept the server-side session's context current (docs/AI_ASSISTANT_ARCHITECTURE.md §5) —
   * see server/app.ts's `SharedAgentStreamRequest` / server/agent/context/model.ts's
   * `DisputeFacts`. Wire shape mirrored by hand, same as every other server/types.ts type. */
  enabledSources?: SourceId[];
  dispute?: {
    disputeId: string;
    customerId: string;
    customerName: string;
    transactionId: string;
    reason: string;
    status: string;
    evidenceStatus: "not_started" | "in_progress" | "ready";
    evidenceSummary: { category: string; count: number }[];
  };
  workspace?: { disputesNeedingAttention: WorkspaceDisputeSummary[] };
}

export interface WorkspaceDisputeSummary {
  disputeId: string;
  customerName: string;
  reason: string;
  amountCents: number;
  evidenceDueAt: string;
}

function parseSSEFrame(raw: string): { event: string; data: string } {
  let event = "message";
  const dataLines: string[] = [];
  for (const line of raw.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
  }
  return { event, data: dataLines.join("\n") };
}

export async function streamAgentMessage(
  args: StreamAgentMessageArgs,
  onDelta: (delta: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch("/api/agent/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args),
    signal,
  });
  if (!res.ok || !res.body) {
    throw new Error(`The agent stream request failed (${res.status}).`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let streamError: string | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let sep: number;
    while ((sep = buffer.indexOf("\n\n")) !== -1) {
      const raw = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      const { event, data } = parseSSEFrame(raw);
      if (event === "delta") {
        try {
          onDelta((JSON.parse(data) as { text: string }).text);
        } catch {
          // A malformed delta frame is skippable — the "done" frame carries the full text
          // regardless, so nothing is silently lost, only one intermediate render tick.
        }
      } else if (event === "error") {
        try {
          streamError = (JSON.parse(data) as { message: string }).message;
        } catch {
          streamError = data || "The agent stream failed.";
        }
      }
      // "done" frames carry the full final text, which the caller already has by summing deltas
      // — nothing further to do here but let the read loop end when the server closes the stream.
    }
  }

  if (streamError) throw new AgentStreamError(streamError);
}
