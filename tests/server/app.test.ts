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

  it("GET /api/health reports all six connected sources and the stub LLM mode", async () => {
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.commasConnected).toBe(true);
    expect(body.llmMode).toBe("stub"); // no ANTHROPIC_API_KEY in this test environment
    expect(new Set(body.sources.map((s: { sourceId: string }) => s.sourceId))).toEqual(
      new Set(["commas", "fathom", "zoom", "gmail", "google-calendar", "crm"]),
    );
    // Commas/Fathom/Zoom are MCP-backed, Gmail/Calendar/CRM are API-backed (docs/active-context.md)
    expect(body.sources.find((s: { sourceId: string }) => s.sourceId === "commas").kind).toBe("mcp");
    expect(body.sources.find((s: { sourceId: string }) => s.sourceId === "gmail").kind).toBe("api");
  });

  it("GET /api/tools returns tools discovered across every adapter (not a hardcoded list)", async () => {
    const res = await app.request("/api/tools");
    const body = await res.json();
    expect(body.tools.map((t: { name: string }) => t.name).sort()).toEqual(
      [
        "commas_get_dispute",
        "commas_list_disputes",
        "commas_mark_dispute_response_ready",
        "fanbasis_get_transaction",
        "fanbasis_list_customers",
        "fanbasis_list_transactions",
        "fathom_search_calls",
        "zoom_list_meetings",
        "gmail_search_threads",
        "calendar_list_events",
        "crm_get_contact",
      ].sort(),
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

  it("POST /api/agent/run honors a conversation history payload for multi-turn continuity", async () => {
    const res = await app.request("/api/agent/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: "What about her transactions?",
        enabledSources: ["commas"],
        history: [
          { role: "user", text: "Look up customer sarah.johnson@email.com" },
          { role: "assistant", text: "**Sarah Johnson** — sarah.johnson@email.com." },
        ],
      }),
    });
    const body = await res.json();
    expect(body.answer.toLowerCase()).toContain("transaction");
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

  it("POST /api/agent/run -> approve round trip: pauses, then executes only on confirmation", async () => {
    const context = {
      kind: "dispute",
      id: "2481",
      label: "Dispute #2481",
      dispute: {
        customerName: "Sarah Johnson",
        customerEmail: "sarah.johnson@email.com",
        transactionId: "txn_8b3f2a1c9d",
        amountCents: 49900,
        reason: "product_not_received",
        openedAt: "2026-08-09T00:00:00Z",
        evidenceDueAt: "2026-08-13T00:00:00Z",
        evidenceStatus: "not_started",
      },
    };

    const runRes = await app.request("/api/agent/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "mark the response ready", enabledSources: ["commas"], context }),
    });
    const runBody = await runRes.json();
    expect(runBody.pendingApproval).toBeDefined();

    const approveRes = await app.request("/api/agent/approve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        decision: "approve",
        toolCallId: runBody.pendingApproval.toolCallId,
        toolName: runBody.pendingApproval.toolName,
        input: runBody.pendingApproval.input,
        prompt: "mark the response ready",
        enabledSources: ["commas"],
        context,
      }),
    });
    expect(approveRes.status).toBe(200);
    const approveBody = await approveRes.json();
    expect(approveBody.pendingApproval).toBeUndefined();
    expect(approveBody.toolSummary[0].ok).toBe(true);
  });

  it("POST /api/agent/approve rejects a malformed body with a clean 400", async () => {
    const res = await app.request("/api/agent/approve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision: "maybe" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("malformed_result");
  });
});
