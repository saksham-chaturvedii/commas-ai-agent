import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { CommasAdapter } from "./adapters/commasAdapter.js";
import { createFathomAdapter, createZoomAdapter } from "./adapters/meetingsAdapters.js";
import { GmailAdapter } from "./adapters/gmailAdapter.js";
import { CalendarAdapter } from "./adapters/calendarAdapter.js";
import { CrmAdapter } from "./adapters/crmAdapter.js";
import type { SourceAdapter } from "./adapters/types.js";
import { buildToolRegistry, listAvailableTools, type RegisteredTool } from "./agent/registry.js";
import { runAgentTurn, resumeAfterApproval } from "./agent/runtime.js";
import { AgentError, classifyError } from "./agent/errors.js";
import { StubLlmClient } from "./llm/stubClient.js";
import { AnthropicLlmClient } from "./llm/anthropicClient.js";
import type { LlmClient } from "./llm/types.js";
import type { AgentApproveRequest, AgentRunRequest, AgentRunResponse, ConversationTurn } from "./types.js";
// --- shared agent runtime (docs/AI_ASSISTANT_ARCHITECTURE.md) — additive, alongside the legacy
// runtime/LLM client imports above, which remain exactly as they were.
import { SessionStore, type SessionConfig } from "./agent/sessions/store.js";
import { runSharedAgent } from "./agent/runtime/sharedAgent.js";
import { AnthropicStreamClient } from "./llm/streaming/anthropicStreamClient.js";
import { StubStreamClient } from "./llm/streaming/stubStreamClient.js";
import type { StreamingLlmClient } from "./llm/streaming/types.js";

/** A capped conversation window sent to the LLM per turn — enough for real continuity
 * without unbounded payload growth on a long-running chat. */
const HISTORY_TURN_LIMIT = 20;

/** Request body for POST /api/agent/stream — the shared agent's own contract, distinct from
 * `AgentRunRequest` (which stays exactly as the legacy /api/agent/run expects it). */
interface SharedAgentStreamRequest {
  sessionId: string;
  mode?: "global" | "dispute";
  disputeId?: string;
  message: string;
  /** Only used to bootstrap a brand-new server-side session — see `SessionStore.resolve`. */
  history?: ConversationTurn[];
}

/**
 * Builds the Hono app (endpoints, source adapters, LLM client selection) without binding a
 * port — server/index.ts calls this and then serves it; tests call it directly and drive it
 * with Hono's in-memory `app.request()`, so the HTTP layer is tested for real without a
 * network listener. See docs/ARCHITECTURE.md §15 for the request/response loop this exposes.
 */
export async function createApp() {
  const adapters: SourceAdapter[] = [];
  let commasInitError: AgentError | null = null;

  try {
    const mode = process.env.COMMAS_MCP_MODE ?? "mock";
    if (mode === "real") {
      const url = process.env.COMMAS_MCP_URL;
      const key = process.env.COMMAS_API_KEY;
      if (!url || !key) {
        throw new AgentError("server_unavailable", "COMMAS_MCP_MODE=real requires COMMAS_MCP_URL and COMMAS_API_KEY to be set.");
      }
      adapters.push(await CommasAdapter.createReal(url, key));
    } else {
      adapters.push(await CommasAdapter.createMock());
    }
  } catch (err) {
    commasInitError = err instanceof AgentError ? err : classifyError(err);
    console.error(`[commas-adapter] failed to connect: ${commasInitError.message}`);
  }

  // Fathom/Zoom (MCP-backed) and Gmail/Calendar/GoHighLevel (API-backed) are always mock in this
  // prototype — no real OAuth integration exists for any of them yet (see
  // docs/active-context.md). Each still only fails its own source, never the whole app.
  adapters.push(await createFathomAdapter());
  adapters.push(await createZoomAdapter());
  adapters.push(new GmailAdapter());
  adapters.push(new CalendarAdapter());
  adapters.push(new CrmAdapter());

  const registry: Map<string, RegisteredTool> = await buildToolRegistry(adapters);

  const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
  const llmClient: LlmClient = anthropicApiKey ? new AnthropicLlmClient(anthropicApiKey) : new StubLlmClient();
  const llmMode = anthropicApiKey ? "anthropic" : "stub";
  if (!anthropicApiKey) {
    console.warn(
      "[llm] ANTHROPIC_API_KEY is not set — using the deterministic stub LLM. Real tool calls " +
        "still run for real against connected sources; only the reasoning step is scripted.",
    );
  }

  // Shared agent runtime (docs/AI_ASSISTANT_ARCHITECTURE.md §4) — its own streaming LLM client
  // and its own session store, both created fresh per createApp() call exactly like the legacy
  // llmClient/registry above, so tests (and separate server processes) never share state.
  const streamingLlmClient: StreamingLlmClient = anthropicApiKey
    ? new AnthropicStreamClient(anthropicApiKey)
    : new StubStreamClient();
  const sessionStore = new SessionStore();

  const app = new Hono();

  app.get("/api/health", (c) =>
    c.json({
      ok: true,
      commasConnected: !commasInitError,
      commasError: commasInitError ? { code: commasInitError.code, message: commasInitError.message } : null,
      sources: adapters.map((a) => ({ sourceId: a.sourceId, kind: a.kind })),
      llmMode,
    }),
  );

  app.get("/api/tools", (c) => c.json({ tools: listAvailableTools(registry) }));

  app.post("/api/agent/run", async (c) => {
    let body: AgentRunRequest;
    try {
      body = await c.req.json();
    } catch {
      return c.json(errorResponse("malformed_result", "Invalid request body."), 400);
    }

    if (!body || typeof body.prompt !== "string" || body.prompt.trim().length === 0) {
      return c.json(errorResponse("malformed_result", "A non-empty prompt is required."), 400);
    }

    const result = await runAgentTurn({
      prompt: body.prompt,
      enabledSources: Array.isArray(body.enabledSources) ? body.enabledSources : [],
      context: body.context,
      conversationHistory: capHistory(body.history),
      llmClient,
      adapters,
      registry,
    });
    return c.json(result);
  });

  app.post("/api/agent/approve", async (c) => {
    let body: AgentApproveRequest;
    try {
      body = await c.req.json();
    } catch {
      return c.json(errorResponse("malformed_result", "Invalid request body."), 400);
    }

    if (!body || (body.decision !== "approve" && body.decision !== "decline") || typeof body.toolCallId !== "string" || typeof body.toolName !== "string") {
      return c.json(errorResponse("malformed_result", "decision, toolCallId, and toolName are required."), 400);
    }

    const result = await resumeAfterApproval({
      decision: body.decision,
      toolCallId: body.toolCallId,
      toolName: body.toolName,
      input: body.input ?? {},
      prompt: body.prompt ?? "",
      enabledSources: Array.isArray(body.enabledSources) ? body.enabledSources : [],
      context: body.context,
      conversationHistory: capHistory(body.history),
      llmClient,
      adapters,
      registry,
    });
    return c.json(result);
  });

  // --- Shared agent runtime (docs/AI_ASSISTANT_ARCHITECTURE.md) ---
  //
  // POST /api/agent/stream: the shared agent's own endpoint. Additive — /api/agent/run and
  // /api/agent/approve above are completely untouched and keep backing dispute-context chats
  // (and therefore the Resolution Center) exactly as before this phase. This route currently
  // only serves global-mode chats from the frontend (src/hooks/useChatStore.tsx), but genuinely
  // supports both session configs — see tests/server/sharedAgent.test.ts for a direct dispute-
  // mode exercise of this same route.
  //
  // Response is a real SSE stream (`hono/streaming`'s streamSSE — no new dependency), not JSON:
  // repeated `event: delta` frames as the model's reply arrives, followed by one `event: done`
  // (or `event: error`) frame. See src/lib/agentApi.ts's `streamAgentMessage` for the client-side
  // parser.
  app.post("/api/agent/stream", async (c) => {
    let body: SharedAgentStreamRequest;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "malformed_result" }, 400);
    }

    if (!body || typeof body.sessionId !== "string" || body.sessionId.length === 0) {
      return c.json({ error: "malformed_result", message: "sessionId is required." }, 400);
    }
    if (typeof body.message !== "string" || body.message.trim().length === 0) {
      return c.json({ error: "malformed_result", message: "A non-empty message is required." }, 400);
    }

    if (
      body.history !== undefined &&
      (!Array.isArray(body.history) ||
        body.history.some(
          (t) =>
            typeof t !== "object" ||
            t === null ||
            (t.role !== "user" && t.role !== "assistant") ||
            typeof t.text !== "string",
        ))
    ) {
      return c.json({ error: "malformed_result", message: "history entries must be {role, text} turns." }, 400);
    }

    const config: SessionConfig =
      body.mode === "dispute" && typeof body.disputeId === "string" && body.disputeId.length > 0
        ? { mode: "dispute", disputeId: body.disputeId }
        : { mode: "global" };
    const bootstrapHistory = capHistory(body.history).map((t) => ({ role: t.role, text: t.text }));

    return streamSSE(c, async (stream) => {
      await runSharedAgent({
        sessionId: body.sessionId,
        config,
        userMessage: body.message,
        bootstrapHistory,
        llmClient: streamingLlmClient,
        sessionStore,
        signal: c.req.raw.signal,
        onEvent: async (event) => {
          if (event.type === "delta") {
            await stream.writeSSE({ event: "delta", data: JSON.stringify({ text: event.text }) });
          } else if (event.type === "done") {
            await stream.writeSSE({ event: "done", data: JSON.stringify({ text: event.text }) });
          } else {
            await stream.writeSSE({ event: "error", data: JSON.stringify({ message: event.message }) });
          }
        },
      });
    });
  });

  return app;
}

function capHistory(history: ConversationTurn[] | undefined): ConversationTurn[] {
  if (!Array.isArray(history)) return [];
  return history.slice(-HISTORY_TURN_LIMIT);
}

function errorResponse(code: "malformed_result", message: string): AgentRunResponse {
  return { steps: [], answer: "", toolSummary: [], error: { code, message } };
}
