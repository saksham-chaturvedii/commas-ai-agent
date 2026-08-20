// @vitest-environment node
import { describe, expect, it, afterEach, beforeAll } from "vitest";
import { CommasMcpClient } from "../../server/mcp/client.js";
import { buildToolRegistry, type RegisteredTool } from "../../server/agent/registry.js";
import { runAgentTurn } from "../../server/agent/runtime.js";
import { StubLlmClient } from "../../server/llm/stubClient.js";

/**
 * End-to-end tests of the real request/response loop (docs/ARCHITECTURE.md §15):
 * Agent → LLM → MCP client → mock Commas MCP server → tool result → LLM → final answer.
 * Only the "LLM" is a deterministic stub (no ANTHROPIC_API_KEY in this environment — see
 * docs/active-context.md); the MCP client, the mock server, and the runtime loop are all the
 * real production code, exercised over the real MCP protocol.
 */
describe("runAgentTurn — the five required validation scenarios", () => {
  let client: CommasMcpClient;
  let registry: Map<string, RegisteredTool>;
  const llmClient = new StubLlmClient();

  beforeAll(async () => {
    client = await CommasMcpClient.connectMock();
    registry = await buildToolRegistry(client);
  });
  afterEach(() => {});

  it("1-4: a user query requiring Commas data triggers a successful tool call, the result is passed back to the agent, and it produces a final answer", async () => {
    const result = await runAgentTurn({
      prompt: "Look up customer sarah.johnson@email.com",
      enabledSources: ["commas"],
      llmClient,
      mcpClient: client,
      registry,
    });

    expect(result.error).toBeUndefined();
    // step 2: a successful tool call actually ran
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].sourceId).toBe("commas");
    expect(result.toolSummary).toEqual([{ sourceId: "commas", label: "Customer records", ok: true }]);
    // step 4: final answer, grounded in the real tool result (not fabricated)
    expect(result.answer).toContain("Sarah Johnson");
    expect(result.answer).toContain("sarah.johnson@email.com");
  });

  it("5: a tool failure produces a clean, non-crashing agent response (not an unhandled error)", async () => {
    const result = await runAgentTurn({
      prompt: "Look up transaction txn_doesnotexist",
      enabledSources: ["commas"],
      llmClient,
      mcpClient: client,
      registry,
    });

    expect(result.error).toBeUndefined(); // recoverable — the run still completes
    expect(result.toolSummary).toEqual([{ sourceId: "commas", label: "Transaction details", ok: false }]);
    expect(result.answer.toLowerCase()).toContain("couldn't complete");
    expect(result.answer).toContain("txn_doesnotexist");
  });

  it("handles an empty tool result gracefully (not an error, not a crash)", async () => {
    const result = await runAgentTurn({
      prompt: "Look up customer nobody-matches-this-search",
      enabledSources: ["commas"],
      llmClient,
      mcpClient: client,
      registry,
    });
    expect(result.error).toBeUndefined();
    expect(result.toolSummary[0].ok).toBe(true); // an empty list is a valid result, not a failure
    expect(result.answer).toBe("No customers matched that search.");
  });

  it("looks up the dispute via the real dispute tool, using page context when the prompt is generic", async () => {
    const result = await runAgentTurn({
      prompt: "help me resolve this dispute",
      enabledSources: ["commas"],
      context: { kind: "dispute", id: "2481", label: "Dispute #2481" },
      llmClient,
      mcpClient: client,
      registry,
    });
    expect(result.error).toBeUndefined();
    expect(result.answer).toContain("2481");
    expect(result.answer.toLowerCase()).toContain("product not received");
  });

  it("excludes Commas tools entirely when the source is disabled, and answers with no tool calls", async () => {
    const result = await runAgentTurn({
      prompt: "Look up customer sarah",
      enabledSources: [],
      llmClient,
      mcpClient: client,
      registry,
    });
    expect(result.steps).toHaveLength(0);
    expect(result.answer.toLowerCase()).toContain("turned off");
  });

  it("returns a clean top-level error (not a thrown exception) when the MCP connection itself is unavailable", async () => {
    // Simulate "unavailable MCP server" at the runtime boundary: a client that was closed
    // still satisfies the CommasMcpClient type but every call now fails at the transport.
    const deadClient = await CommasMcpClient.connectMock();
    await deadClient.close();

    const result = await runAgentTurn({
      prompt: "Look up customer sarah",
      enabledSources: ["commas"],
      llmClient,
      mcpClient: deadClient,
      registry,
    });

    // The tool call fails, but the runtime still completes the turn with a clean, described
    // failure rather than throwing — the assistant message becomes the "clean error state."
    expect(result.toolSummary[0].ok).toBe(false);
    expect(result.answer.toLowerCase()).toContain("couldn't complete");
  });
});
