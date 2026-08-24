// @vitest-environment node
import { describe, expect, it, vi, afterEach } from "vitest";
import { GeminiLlmClient } from "../../server/llm/geminiClient.js";
import { GeminiStreamClient } from "../../server/llm/streaming/geminiStreamClient.js";
import { sanitizeSchemaForGemini } from "../../server/llm/geminiSchema.js";
import { AgentError } from "../../server/agent/errors.js";
import type { LlmStepInput } from "../../server/llm/types.js";
import type { StreamStepArgs } from "../../server/llm/streaming/types.js";

/**
 * `GeminiLlmClient`/`GeminiStreamClient` (server/llm/geminiClient.ts, server/llm/streaming/
 * geminiStreamClient.ts) are Gemini's genuinely-free counterpart to `AnthropicLlmClient`/
 * `AnthropicStreamClient` — added when a real ANTHROPIC_API_KEY turned out to have a $0 credit
 * balance in production (Anthropic has no free tier at all), and there's no free key available
 * in this environment to test against the real Gemini API either. These tests mock `fetch`
 * directly to verify the request/response mapping is correct — the one thing that's actually
 * verifiable without live network access — rather than shipping this unverified.
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

describe("sanitizeSchemaForGemini", () => {
  it("strips $schema and $id at every depth without touching anything else", () => {
    const input = {
      $schema: "http://json-schema.org/draft-07/schema#",
      type: "object",
      properties: {
        nested: { $id: "#nested", type: "object", properties: { id: { type: "string" } } },
      },
      required: ["nested"],
    };
    expect(sanitizeSchemaForGemini(input)).toEqual({
      type: "object",
      properties: { nested: { type: "object", properties: { id: { type: "string" } } } },
      required: ["nested"],
    });
  });

  it("passes through primitives and arrays unchanged", () => {
    expect(sanitizeSchemaForGemini("x")).toBe("x");
    expect(sanitizeSchemaForGemini([{ $schema: "y", a: 1 }])).toEqual([{ a: 1 }]);
  });
});

describe("GeminiLlmClient", () => {
  it("sends system instruction, history, and the user prompt, and returns the model's final text", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: "Hi there." }] }, finishReason: "STOP" }],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new GeminiLlmClient("test-key", "gemini-2.5-flash");
    const result = await client.nextStep(
      baseInput({
        conversationHistory: [{ role: "user", text: "earlier message" }],
      }),
    );

    expect(result).toEqual({ type: "final", text: "Hi there." });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("gemini-2.5-flash:generateContent");
    expect(init.headers["x-goog-api-key"]).toBe("test-key");
    const body = JSON.parse(init.body);
    expect(body.systemInstruction.parts[0].text).toBe("You are a helpful assistant.");
    expect(body.contents[0]).toEqual({ role: "user", parts: [{ text: "earlier message" }] });
    expect(body.contents.at(-1)).toEqual({ role: "user", parts: [{ text: "Hello" }] });
  });

  it("maps a functionCall response into a tool_call decision", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: { parts: [{ functionCall: { name: "commas_get_dispute", args: { dispute_id: "2481" } } }] },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new GeminiLlmClient("test-key");
    const result = await client.nextStep(
      baseInput({
        availableTools: [
          {
            name: "commas_get_dispute",
            description: "look up a dispute",
            // Mirrors the real tool registry's shape (server/agent/registry.ts): every schema
            // carries a top-level $schema key from zod-to-json-schema.
            inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"], $schema: "http://json-schema.org/draft-07/schema#" },
          },
        ],
      }),
    );

    expect(result.type).toBe("tool_call");
    if (result.type === "tool_call") {
      expect(result.toolName).toBe("commas_get_dispute");
      expect(result.input).toEqual({ dispute_id: "2481" });
      expect(result.toolCallId).toMatch(/^gemini-/);
    }

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.tools[0].functionDeclarations[0].name).toBe("commas_get_dispute");
    // Gemini's API rejects $schema outright (confirmed live: 400 INVALID_ARGUMENT, "Unknown
    // name \"$schema\"") — it must never reach the wire.
    expect(body.tools[0].functionDeclarations[0].parameters).not.toHaveProperty("$schema");
    expect(body.tools[0].functionDeclarations[0].parameters).toEqual({
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    });
  });

  it("includes prior tool calls as plain-text model/user turn pairs, not structured functionCall/functionResponse parts", async () => {
    // Gemini 3.x rejects a replayed functionCall part with no thought_signature attached — see
    // toolHistoryToContents's doc comment in server/llm/geminiClient.ts for the live-confirmed
    // failure this sidesteps by using plain text instead.
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "done" }] } }] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new GeminiLlmClient("test-key");
    await client.nextStep(
      baseInput({
        toolHistory: [
          { toolCallId: "t1", toolName: "commas_get_dispute", input: { dispute_id: "2481" }, result: { ok: true, data: { id: "2481" } } },
        ],
      }),
    );

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.contents[0].role).toBe("model");
    expect(body.contents[0].parts[0]).not.toHaveProperty("functionCall");
    expect(body.contents[0].parts[0].text).toContain("commas_get_dispute");
    expect(body.contents[0].parts[0].text).toContain("2481");
    expect(body.contents[1].role).toBe("user");
    expect(body.contents[1].parts[0]).not.toHaveProperty("functionResponse");
    expect(body.contents[1].parts[0].text).toContain("commas_get_dispute");
    expect(body.contents[1].parts[0].text).toContain('"ok":true');
  });

  it("classifies a 401/403 response as auth_failed without crashing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: "API key not valid" } }), { status: 403 })),
    );
    const client = new GeminiLlmClient("bad-key");
    await expect(client.nextStep(baseInput())).rejects.toMatchObject({ code: "auth_failed" });
  });

  it("classifies a 429 response as tool_error (rate limited), not a crash", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: "rate limited" } }), { status: 429 })));
    const client = new GeminiLlmClient("test-key");
    await expect(client.nextStep(baseInput())).rejects.toMatchObject({ code: "tool_error" });
  });

  it("classifies a network failure as server_unavailable, not an unhandled rejection", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("fetch failed")),
    );
    const client = new GeminiLlmClient("test-key");
    const err = await client.nextStep(baseInput()).catch((e) => e);
    expect(err).toBeInstanceOf(AgentError);
    expect(err.code).toBe("server_unavailable");
  });
});

describe("GeminiStreamClient", () => {
  function sseResponse(chunks: unknown[]): Response {
    const body = chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("");
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
          { candidates: [{ content: { parts: [{ text: "Hi " }] } }] },
          { candidates: [{ content: { parts: [{ text: "there." }] } }] },
        ]),
      ),
    );

    const onDelta = vi.fn();
    const client = new GeminiStreamClient("test-key");
    const result = await client.streamStep(baseStreamArgs({ onDelta }));

    expect(result).toEqual({ type: "final", text: "Hi there." });
    expect(onDelta).toHaveBeenNthCalledWith(1, "Hi ");
    expect(onDelta).toHaveBeenNthCalledWith(2, "there.");
  });

  it("resolves immediately with a tool_call on a functionCall chunk, without streaming it as text", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        sseResponse([{ candidates: [{ content: { parts: [{ functionCall: { name: "commas_get_dispute", args: { dispute_id: "2481" } } }] } }] }]),
      ),
    );

    const onDelta = vi.fn();
    const client = new GeminiStreamClient("test-key");
    const result = await client.streamStep(baseStreamArgs({ onDelta }));

    expect(result.type).toBe("tool_call");
    if (result.type === "tool_call") {
      expect(result.toolName).toBe("commas_get_dispute");
      expect(result.input).toEqual({ dispute_id: "2481" });
    }
    expect(onDelta).not.toHaveBeenCalled();
  });

  it("classifies an error response without crashing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status: 403 })));
    const client = new GeminiStreamClient("bad-key");
    await expect(client.streamStep(baseStreamArgs())).rejects.toMatchObject({ code: "auth_failed" });
  });
});
