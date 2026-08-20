import { Hono } from "hono";
import { CommasMcpClient } from "./mcp/client.js";
import { buildToolRegistry, listAvailableTools, type RegisteredTool } from "./agent/registry.js";
import { runAgentTurn } from "./agent/runtime.js";
import { AgentError, classifyError } from "./agent/errors.js";
import { StubLlmClient } from "./llm/stubClient.js";
import { AnthropicLlmClient } from "./llm/anthropicClient.js";
import type { LlmClient } from "./llm/types.js";
import type { AgentRunRequest, AgentRunResponse } from "./types.js";

/**
 * Builds the Hono app (endpoints, MCP connection, LLM client selection) without binding a
 * port — server/index.ts calls this and then serves it; tests call it directly and drive it
 * with Hono's in-memory `app.request()`, so the HTTP layer is tested for real without a
 * network listener. See docs/ARCHITECTURE.md §15 for the request/response loop this exposes.
 */
export async function createApp() {
  let mcpClient: CommasMcpClient | null = null;
  let mcpInitError: AgentError | null = null;
  let registry: Map<string, RegisteredTool> = new Map();

  const mode = process.env.COMMAS_MCP_MODE ?? "mock";
  try {
    if (mode === "real") {
      const url = process.env.COMMAS_MCP_URL;
      const key = process.env.COMMAS_API_KEY;
      if (!url || !key) {
        throw new AgentError(
          "server_unavailable",
          "COMMAS_MCP_MODE=real requires COMMAS_MCP_URL and COMMAS_API_KEY to be set.",
        );
      }
      mcpClient = await CommasMcpClient.connectReal(url, key);
    } else {
      mcpClient = await CommasMcpClient.connectMock();
    }
    registry = await buildToolRegistry(mcpClient);
  } catch (err) {
    mcpInitError = err instanceof AgentError ? err : classifyError(err);
    console.error(`[commas-mcp] failed to connect: ${mcpInitError.message}`);
  }

  const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
  const llmClient: LlmClient = anthropicApiKey ? new AnthropicLlmClient(anthropicApiKey) : new StubLlmClient();
  const llmMode = anthropicApiKey ? "anthropic" : "stub";
  if (!anthropicApiKey) {
    console.warn(
      "[llm] ANTHROPIC_API_KEY is not set — using the deterministic stub LLM. Real tool calls " +
        "still run for real against the Commas MCP connection; only the reasoning step is scripted.",
    );
  }

  const app = new Hono();

  app.get("/api/health", (c) =>
    c.json({
      ok: true,
      mcpConnected: mcpClient !== null,
      mcpError: mcpInitError ? { code: mcpInitError.code, message: mcpInitError.message } : null,
      llmMode,
    }),
  );

  app.get("/api/tools", (c) => c.json({ tools: listAvailableTools(registry) }));

  app.post("/api/agent/run", async (c) => {
    if (!mcpClient) {
      const err = mcpInitError ?? new AgentError("server_unavailable", "The Commas connection isn't available.");
      const response: AgentRunResponse = { steps: [], answer: "", toolSummary: [], error: { code: err.code, message: err.message } };
      return c.json(response);
    }

    let body: AgentRunRequest;
    try {
      body = await c.req.json();
    } catch {
      const response: AgentRunResponse = {
        steps: [],
        answer: "",
        toolSummary: [],
        error: { code: "malformed_result", message: "Invalid request body." },
      };
      return c.json(response, 400);
    }

    if (!body || typeof body.prompt !== "string" || body.prompt.trim().length === 0) {
      const response: AgentRunResponse = {
        steps: [],
        answer: "",
        toolSummary: [],
        error: { code: "malformed_result", message: "A non-empty prompt is required." },
      };
      return c.json(response, 400);
    }

    const result = await runAgentTurn({
      prompt: body.prompt,
      enabledSources: Array.isArray(body.enabledSources) ? body.enabledSources : [],
      context: body.context,
      llmClient,
      mcpClient,
      registry,
    });
    return c.json(result);
  });

  return app;
}
