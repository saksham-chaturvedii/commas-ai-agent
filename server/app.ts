import { Hono } from "hono";
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

/** A capped conversation window sent to the LLM per turn — enough for real continuity
 * without unbounded payload growth on a long-running chat. */
const HISTORY_TURN_LIMIT = 20;

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

  return app;
}

function capHistory(history: ConversationTurn[] | undefined): ConversationTurn[] {
  if (!Array.isArray(history)) return [];
  return history.slice(-HISTORY_TURN_LIMIT);
}

function errorResponse(code: "malformed_result", message: string): AgentRunResponse {
  return { steps: [], answer: "", toolSummary: [], error: { code, message } };
}
