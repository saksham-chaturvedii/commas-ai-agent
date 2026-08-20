// @vitest-environment node
import { describe, expect, it, beforeAll } from "vitest";
import type { Hono } from "hono";
import { createApp } from "../../server/app.js";

/**
 * Tests the real HTTP layer (routing, JSON parsing, status codes) via Hono's in-memory
 * `app.request()` — no port binding, no real network, but the same app instance
 * server/index.ts serves.
 */
describe("HTTP API", () => {
  let app: Hono;

  beforeAll(async () => {
    app = await createApp();
  });

  it("GET /api/health reports the mock MCP connection and stub LLM mode", async () => {
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.mcpConnected).toBe(true);
    expect(body.llmMode).toBe("stub"); // no ANTHROPIC_API_KEY in this test environment
  });

  it("GET /api/tools returns the discovered Commas tools (not a hardcoded list)", async () => {
    const res = await app.request("/api/tools");
    const body = await res.json();
    expect(body.tools.map((t: { name: string }) => t.name).sort()).toEqual(
      ["commas_get_dispute", "fanbasis_get_transaction", "fanbasis_list_customers", "fanbasis_list_transactions"].sort(),
    );
  });

  it("POST /api/agent/run runs a full query -> tool call -> result -> final answer loop", async () => {
    const res = await app.request("/api/agent/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "Look up customer sarah.johnson@email.com", enabledSources: ["commas"] }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.error).toBeUndefined();
    expect(body.toolSummary).toEqual([{ sourceId: "commas", label: "Customer records", ok: true }]);
    expect(body.answer).toContain("Sarah Johnson");
  });

  it("POST /api/agent/run rejects a missing prompt with a clean 400, not a crash", async () => {
    const res = await app.request("/api/agent/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabledSources: ["commas"] }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("malformed_result");
  });

  it("POST /api/agent/run rejects malformed JSON with a clean 400, not a crash", async () => {
    const res = await app.request("/api/agent/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not json",
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("malformed_result");
  });
});
