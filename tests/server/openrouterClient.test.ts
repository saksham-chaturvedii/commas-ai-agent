// @vitest-environment node
import { describe, expect, it, vi, afterEach } from "vitest";
import { OpenRouterLlmClient } from "../../server/llm/openrouterClient.js";
import { OpenRouterStreamClient } from "../../server/llm/streaming/openrouterStreamClient.js";
import { AgentError } from "../../server/agent/errors.js";
import type { LlmStepInput } from "../../server/llm/types.js";
import type { StreamStepArgs } from "../../server/llm/streaming/types.js";

/**
 * `OpenRouterLlmClient`/`OpenRouterStreamClient` (server/llm/openrouterClient.ts,
 * server/llm/streaming/openrouterStreamClient.ts) — the third LLM provider, added when Gemini's
 * real free-tier rate limit (5 requests/minute for gemini-3.6-flash, confirmed live) proved too
 * tight for a multi-step investigation. No OpenRouter key is available in this environment
 * either, so these tests mock `fetch` directly to verify the OpenAI-shaped request/response
 * mapping — the one thing verifiable without live network access — rather than shipping this
 * unverified, same approach as tests/server/geminiClient.test.ts.
 */

function baseInput(overrides: Partial<LlmStepInput> = {}): LlmStepInput {
  return {
    systemPrompt: "You are a helpful assistant.",
    userPrompt: "Hello",
    availableTools: [],
    conversationHistory: [],
    toolHistory: [],
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("OpenRouterLlmClient", () => {
  it("sends system prompt, history, and the user prompt as OpenAI-shaped messages, and returns the model's final text", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "Hi there." } }] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new OpenRouterLlmClient("test-key", "meta-llama/llama-3.3-70b-instruct:free");
    const result = await client.nextStep(baseInput({ conversationHistory: [{ role: "user", text: "earlier message" }] }));

    expect(result).toEqual({ type: "final", text: "Hi there." });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(init.headers.authorization).toBe("Bearer test-key");
    const body = JSON.parse(init.body);
    expect(body.model).toBe("meta-llama/llama-3.3-70b-instruct:free");
    expect(body.messages[0]).toEqual({ role: "system", content: "You are a helpful assistant." });
    expect(body.messages[1]).toEqual({ role: "user", content: "earlier message" });
    expect(body.messages.at(-1)).toEqual({ role: "user", content: "Hello" });
  });

  it("maps an OpenAI-shaped tool_calls response into a tool_call decision, parsing the JSON arguments string", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                tool_calls: [{ id: "call_abc123", type: "function", function: { name: "commas_get_dispute", arguments: '{"id":"2481"}' } }],
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new OpenRouterLlmClient("test-key");
    const result = await client.nextStep(
      baseInput({ availableTools: [{ name: "commas_get_dispute", description: "look up a dispute", inputSchema: { type: "object" } }] }),
    );

    expect(result).toEqual({ type: "tool_call", toolCallId: "call_abc123", toolName: "commas_get_dispute", input: { id: "2481" } });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.tools[0]).toEqual({
      type: "function",
      function: { name: "commas_get_dispute", description: "look up a dispute", parameters: { type: "object" } },
    });
  });

  it("replays a resolved tool call using its real id (not a synthesized one) on the next turn", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: "done" } }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new OpenRouterLlmClient("test-key");
    await client.nextStep(
      baseInput({
        toolHistory: [
          { toolCallId: "call_abc123", toolName: "commas_get_dispute", input: { id: "2481" }, result: { ok: true, data: { id: "2481" } } },
        ],
      }),
    );

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    const assistantMsg = body.messages.find((m: { role: string }) => m.role === "assistant");
    expect(assistantMsg.tool_calls[0].id).toBe("call_abc123");
    const toolMsg = body.messages.find((m: { role: string }) => m.role === "tool");
    expect(toolMsg.tool_call_id).toBe("call_abc123");
    expect(JSON.parse(toolMsg.content)).toEqual({ ok: true, data: { id: "2481" } });
  });

  it("falls back to an empty input rather than crashing on malformed arguments JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ choices: [{ message: { tool_calls: [{ id: "call_1", type: "function", function: { name: "x", arguments: "{not json" } }] } }] }),
          { status: 200 },
        ),
      ),
    );
    const client = new OpenRouterLlmClient("test-key");
    const result = await client.nextStep(baseInput());
    expect(result).toEqual({ type: "tool_call", toolCallId: "call_1", toolName: "x", input: {} });
  });

  it("classifies a 401/403 response as auth_failed without crashing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "invalid key" }), { status: 401 })));
    const client = new OpenRouterLlmClient("bad-key");
    await expect(client.nextStep(baseInput())).rejects.toMatchObject({ code: "auth_failed" });
  });

  it("classifies a 429 response as tool_error (rate limited), not a crash", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "rate limited" }), { status: 429 })));
    const client = new OpenRouterLlmClient("test-key");
    await expect(client.nextStep(baseInput())).rejects.toMatchObject({ code: "tool_error" });
  });

  it("classifies a network failure as server_unavailable, not an unhandled rejection", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    const client = new OpenRouterLlmClient("test-key");
    const err = await client.nextStep(baseInput()).catch((e) => e);
    expect(err).toBeInstanceOf(AgentError);
    expect(err.code).toBe("server_unavailable");
  });
});

describe("OpenRouterStreamClient", () => {
  function sseResponse(lines: string[]): Response {
    const body = lines.map((l) => `data: ${l}\n\n`).join("");
    return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
  }

  function baseStreamArgs(overrides: Partial<StreamStepArgs> = {}): StreamStepArgs {
    return {
      systemPrompt: "You are a helpful assistant.",
      transcript: [{ role: "user", text: "Hello" }],
      availableTools: [],
      toolHistory: [],
      onDelta: vi.fn(),
      ...overrides,
    };
  }

  it("forwards streamed text deltas as they arrive and resolves with the full text", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        sseResponse([
          JSON.stringify({ choices: [{ delta: { content: "Hi " } }] }),
          JSON.stringify({ choices: [{ delta: { content: "there." } }] }),
          "[DONE]",
        ]),
      ),
    );

    const onDelta = vi.fn();
    const client = new OpenRouterStreamClient("test-key");
    const result = await client.streamStep(baseStreamArgs({ onDelta }));

    expect(result).toEqual({ type: "final", text: "Hi there." });
    expect(onDelta).toHaveBeenNthCalledWith(1, "Hi ");
    expect(onDelta).toHaveBeenNthCalledWith(2, "there.");
  });

  it("accumulates tool_call argument fragments across multiple chunks by index before resolving", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        sseResponse([
          JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "commas_get_dispute", arguments: "" } }] } }] }),
          JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"id":' } }] } }] }),
          JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"2481"}' } }] } }] }),
          "[DONE]",
        ]),
      ),
    );

    const onDelta = vi.fn();
    const client = new OpenRouterStreamClient("test-key");
    const result = await client.streamStep(baseStreamArgs({ onDelta }));

    expect(result).toEqual({ type: "tool_call", toolCallId: "call_1", toolName: "commas_get_dispute", input: { id: "2481" } });
    expect(onDelta).not.toHaveBeenCalled();
  });

  it("classifies an error response without crashing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status: 401 })));
    const client = new OpenRouterStreamClient("bad-key");
    await expect(client.streamStep(baseStreamArgs())).rejects.toMatchObject({ code: "auth_failed" });
  });
});
