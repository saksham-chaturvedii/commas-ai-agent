// @vitest-environment node
import { describe, expect, it, beforeAll, vi } from "vitest";
import type { Hono } from "hono";
import { createApp } from "../../server/app.js";
import { SessionStore } from "../../server/agent/sessions/store.js";
import { buildContextPrompt } from "../../server/agent/context/buildContext.js";
import { buildAgentContext, agentContextFromPageContext } from "../../server/agent/context/model.js";
import { runSharedAgent, type AgentStreamEvent } from "../../server/agent/runtime/sharedAgent.js";
import { StubStreamClient } from "../../server/llm/streaming/stubStreamClient.js";
import { CommasAdapter } from "../../server/adapters/commasAdapter.js";
import { buildToolRegistry, type RegisteredTool } from "../../server/agent/registry.js";
import type { SourceAdapter } from "../../server/adapters/types.js";

/** Real mock-backed Commas adapter + registry (server/mcp/mockCommasServer.ts), shared across
 * every runSharedAgent test in this file — in-process, no network, safe to reuse (this phase's
 * shared agent never calls the one write tool on this source, so nothing here is mutated by a
 * test run). `connectedSources: ["commas"]` on a call's `requestContext` is what actually makes
 * these tools visible to that call — see server/agent/tools/index.ts's `sharedAgentToolsFor`. */
async function commasFixture(): Promise<{ adapters: SourceAdapter[]; registry: Map<string, RegisteredTool> }> {
  const adapters = [await CommasAdapter.createMock()];
  const registry = await buildToolRegistry(adapters);
  return { adapters, registry };
}

/**
 * Tests the shared agent runtime (docs/AI_ASSISTANT_ARCHITECTURE.md §2–§4) — session storage,
 * context building, the runtime loop, and the HTTP layer it's exposed through. Deliberately
 * separate from tests/server/{runtime,app,disputeIntents}.test.ts, which exercise the
 * *legacy* runtime and remain completely unaffected by anything here.
 */

async function readSSE(res: Response): Promise<{ event: string; data: unknown }[]> {
  if (!res.body) throw new Error("Response has no body");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const frames: { event: string; data: unknown }[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sep: number;
    while ((sep = buffer.indexOf("\n\n")) !== -1) {
      const raw = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      let event = "message";
      const dataLines: string[] = [];
      for (const line of raw.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
      }
      const joined = dataLines.join("\n");
      frames.push({ event, data: joined ? JSON.parse(joined) : undefined });
    }
  }
  return frames;
}

describe("SessionStore", () => {
  it("creates a fresh session with an empty transcript when none exists", () => {
    const store = new SessionStore();
    const session = store.resolve("chat-1", { mode: "global" });
    expect(session.sessionId).toBe("chat-1");
    expect(session.config).toEqual({ mode: "global" });
    expect(session.transcript).toEqual([]);
  });

  it("reuses the same session record on a second resolve with a matching config", () => {
    const store = new SessionStore();
    const first = store.resolve("chat-1", { mode: "global" });
    first.transcript.push({ role: "user", text: "hi" });
    const second = store.resolve("chat-1", { mode: "global" });
    expect(second).toBe(first);
    expect(second.transcript).toHaveLength(1);
  });

  it("bootstraps a brand-new session's transcript from client-sent history", () => {
    const store = new SessionStore();
    const session = store.resolve("chat-1", { mode: "global" }, [
      { role: "user", text: "earlier question" },
      { role: "assistant", text: "earlier answer" },
    ]);
    expect(session.transcript).toEqual([
      { role: "user", text: "earlier question" },
      { role: "assistant", text: "earlier answer" },
    ]);
  });

  it("does NOT bootstrap an already-existing session from history — its own transcript wins", () => {
    const store = new SessionStore();
    const first = store.resolve("chat-1", { mode: "global" });
    first.transcript.push({ role: "user", text: "real turn" }, { role: "assistant", text: "real reply" });
    const second = store.resolve("chat-1", { mode: "global" }, [{ role: "user", text: "stale bootstrap" }]);
    expect(second.transcript).toEqual([
      { role: "user", text: "real turn" },
      { role: "assistant", text: "real reply" },
    ]);
  });

  it("discards a session whose stored config disagrees with the request (dispute -> global) — transcript AND context both reset, never inherited", () => {
    const store = new SessionStore();
    const disputeSession = store.resolve("chat-1", { mode: "dispute", disputeId: "2481" });
    disputeSession.transcript.push({ role: "user", text: "about #2481" }, { role: "assistant", text: "..." });
    store.updateContext(
      "chat-1",
      buildAgentContext({
        conversationId: "chat-1",
        conversationType: "dispute",
        dispute: disputeFacts({ customerName: "Sarah Johnson" }),
      }),
    );

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // Simulates the real product: the seller closes the dispute panel and returns to global
    // chat — the critical isolation requirement is that global chat never silently inherits
    // the dispute-specific context that was just active, even reusing the same chat/session id.
    const globalSession = store.resolve("chat-1", { mode: "global" });
    warn.mockRestore();

    expect(globalSession.config).toEqual({ mode: "global" });
    expect(globalSession.transcript).toEqual([]); // fresh, not the dispute transcript
    expect(globalSession.context.conversationType).toBe("global");
    expect(globalSession.context.dispute).toBeUndefined(); // never Sarah Johnson's facts
    expect(globalSession).not.toBe(disputeSession);
  });

  it("discards a session whose stored config disagrees with the request (same dispute id required) — switching disputes never carries the old dispute's context forward", () => {
    const store = new SessionStore();
    store.resolve("chat-1", { mode: "dispute", disputeId: "2481" });
    store.updateContext(
      "chat-1",
      buildAgentContext({
        conversationId: "chat-1",
        conversationType: "dispute",
        dispute: disputeFacts({ disputeId: "2481", customerName: "Sarah Johnson" }),
      }),
    );

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // The exact scenario the task calls out: a chat id somehow reused across two different
    // disputes (e.g. #2481 -> #3102) must not leak #2481's facts into #3102's context.
    const other = store.resolve("chat-1", { mode: "dispute", disputeId: "3102" });
    warn.mockRestore();
    expect(other.config).toEqual({ mode: "dispute", disputeId: "3102" });
    expect(other.transcript).toEqual([]);
    expect(other.context.dispute).toBeUndefined(); // bare — not #2481's facts, not yet #3102's either
  });

  it("delete removes a session so a later resolve creates a genuinely new one", () => {
    const store = new SessionStore();
    const first = store.resolve("chat-1", { mode: "global" });
    first.transcript.push({ role: "user", text: "hi" });
    expect(store.delete("chat-1")).toBe(true);
    expect(store.get("chat-1")).toBeUndefined();
    const second = store.resolve("chat-1", { mode: "global" });
    expect(second.transcript).toEqual([]);
  });
});

function disputeFacts(overrides: Partial<Parameters<typeof buildAgentContext>[0]["dispute"]> = {}) {
  return {
    disputeId: "2481",
    customerId: "sarah.johnson@email.com",
    customerName: "Sarah Johnson",
    transactionId: "txn_1",
    reason: "product_not_received",
    status: "Needs response",
    evidenceStatus: "not_started" as const,
    evidenceSummary: [],
    ...overrides,
  };
}

describe("buildContextPrompt", () => {
  it("global mode: no dispute framing", () => {
    const context = buildAgentContext({ conversationId: "s", conversationType: "global" });
    const prompt = buildContextPrompt(context);
    expect(prompt).toContain("general workspace conversation");
    expect(prompt).not.toContain("Dispute #");
  });

  it("dispute mode: names the specific dispute and states its known facts", () => {
    const context = buildAgentContext({ conversationId: "s", conversationType: "dispute", dispute: disputeFacts() });
    const prompt = buildContextPrompt(context);
    expect(prompt).toContain("Dispute #2481");
    expect(prompt).toContain("Sarah Johnson");
    expect(prompt).toContain("sarah.johnson@email.com");
  });

  it("dispute mode: states gathered evidence from the summary, or says plainly there is none", () => {
    const empty = buildContextPrompt(
      buildAgentContext({ conversationId: "s", conversationType: "dispute", dispute: disputeFacts() }),
    );
    expect(empty).toContain("No evidence has been gathered");

    const withEvidence = buildContextPrompt(
      buildAgentContext({
        conversationId: "s",
        conversationType: "dispute",
        dispute: disputeFacts({ evidenceSummary: [{ category: "Customer communications", count: 2 }] }),
      }),
    );
    expect(withEvidence).toContain("Customer communications (2)");
  });

  it("global mode: surfaces the workspace's disputes-needing-attention summary", () => {
    const withNone = buildContextPrompt(buildAgentContext({ conversationId: "s", conversationType: "global" }));
    expect(withNone).toContain("no disputes needing a response");

    const withOne = buildContextPrompt(
      buildAgentContext({
        conversationId: "s",
        conversationType: "global",
        workspace: {
          disputesNeedingAttention: [
            { disputeId: "2481", customerName: "Sarah Johnson", reason: "product_not_received", amountCents: 49900, evidenceDueAt: "2026-08-23" },
          ],
        },
      }),
    );
    expect(withOne).toContain("Dispute #2481");
    expect(withOne).toContain("Sarah Johnson");
  });

  it("a dispute-mode context never contains another dispute's facts, and global mode never contains dispute facts at all", () => {
    const a = buildContextPrompt(buildAgentContext({ conversationId: "s", conversationType: "dispute", dispute: disputeFacts({ disputeId: "2481", customerName: "Sarah Johnson" }) }));
    const b = buildContextPrompt(buildAgentContext({ conversationId: "s", conversationType: "dispute", dispute: disputeFacts({ disputeId: "2390", customerName: "Priya Nair" }) }));
    expect(a).toContain("Sarah Johnson");
    expect(a).not.toContain("Priya Nair");
    expect(b).toContain("Priya Nair");
    expect(b).not.toContain("Sarah Johnson");

    const global = buildContextPrompt(buildAgentContext({ conversationId: "s", conversationType: "global" }));
    expect(global).not.toContain("Sarah Johnson");
    expect(global).not.toContain("Priya Nair");
  });
});

describe("agentContextFromPageContext (legacy runtime's adapter onto the shared context model)", () => {
  it("maps a dispute PageContext onto the same AgentContext shape the shared agent uses", () => {
    const context = agentContextFromPageContext("dispute-chat-1", {
      kind: "dispute",
      id: "2481",
      label: "Dispute #2481 — Sarah Johnson",
      dispute: {
        customerName: "Sarah Johnson",
        customerEmail: "sarah.johnson@email.com",
        transactionId: "txn_1",
        amountCents: 49900,
        reason: "product_not_received",
        openedAt: "2026-08-09T00:00:00Z",
        evidenceDueAt: "2026-08-23T00:00:00Z",
        evidenceStatus: "not_started",
        status: "Needs response",
        evidenceSummary: [{ category: "Transaction & payment details", count: 1 }],
      },
    });
    expect(context.conversationType).toBe("dispute");
    expect(context.dispute).toMatchObject({
      disputeId: "2481",
      customerId: "sarah.johnson@email.com",
      customerName: "Sarah Johnson",
    });
    const prompt = buildContextPrompt(context);
    expect(prompt).toContain("Dispute #2481");
    expect(prompt).toContain("Transaction & payment details (1)");
  });

  it("a context-less PageContext (dashboard) maps to global, not dispute", () => {
    const context = agentContextFromPageContext("dashboard-chat", { kind: "dashboard", id: "dashboard", label: "Dashboard" });
    expect(context.conversationType).toBe("global");
    expect(context.dispute).toBeUndefined();
  });
});

describe("runSharedAgent (StubStreamClient)", () => {
  let adapters: SourceAdapter[];
  let registry: Map<string, RegisteredTool>;
  beforeAll(async () => {
    ({ adapters, registry } = await commasFixture());
  });
  const commasSources = { connectedSources: ["commas" as const] };

  it("emits ordered delta events that reassemble into the full reply, then a done event", async () => {
    const store = new SessionStore();
    const events: AgentStreamEvent[] = [];
    await runSharedAgent({
      sessionId: "chat-1",
      config: { mode: "global" },
      userMessage: "hello",
      requestContext: commasSources,
      llmClient: new StubStreamClient(),
      sessionStore: store,
      adapters,
      registry,
      onEvent: (e) => {
        events.push(e);
      },
    });

    const deltas = events.filter((e): e is Extract<AgentStreamEvent, { type: "delta" }> => e.type === "delta");
    expect(deltas.length).toBeGreaterThan(1); // genuinely chunked, not one blob
    const reassembled = deltas.map((d) => d.text).join("");
    const done = events.find((e): e is Extract<AgentStreamEvent, { type: "done" }> => e.type === "done");
    expect(done).toBeDefined();
    expect(reassembled).toBe(done!.text);
    expect(events[events.length - 1]).toBe(done);
  });

  it("persists both the user and assistant turn to the session transcript — real server-side memory", async () => {
    const store = new SessionStore();
    await runSharedAgent({
      sessionId: "chat-1",
      config: { mode: "global" },
      userMessage: "hello",
      requestContext: commasSources,
      llmClient: new StubStreamClient(),
      sessionStore: store,
      adapters,
      registry,
      onEvent: () => {},
    });

    const session = store.get("chat-1")!;
    expect(session.transcript).toHaveLength(2);
    expect(session.transcript[0]).toEqual({ role: "user", text: "hello" });
    expect(session.transcript[1].role).toBe("assistant");
    expect(session.transcript[1].text.length).toBeGreaterThan(0);
  });

  it("a second turn in the same session sees the session's own accumulated transcript, not just the new message", async () => {
    const store = new SessionStore();
    const seenTranscriptLengths: number[] = [];
    const client = new StubStreamClient();
    const originalStreamStep = client.streamStep.bind(client);
    client.streamStep = (args) => {
      seenTranscriptLengths.push(args.transcript.length);
      return originalStreamStep(args);
    };

    await runSharedAgent({
      sessionId: "chat-1",
      config: { mode: "global" },
      userMessage: "hi",
      requestContext: commasSources,
      llmClient: client,
      sessionStore: store,
      adapters,
      registry,
      onEvent: () => {},
    });
    await runSharedAgent({
      sessionId: "chat-1",
      config: { mode: "global" },
      userMessage: "thanks",
      requestContext: commasSources,
      llmClient: client,
      sessionStore: store,
      adapters,
      registry,
      onEvent: () => {},
    });

    // First call: just the new user turn. Second call: the first turn's user+assistant pair,
    // PLUS the new user turn — proof the runtime hands the model real accumulated history from
    // its own session store, not just whatever the caller passed this time.
    expect(seenTranscriptLengths).toEqual([1, 3]);
    expect(store.get("chat-1")!.transcript).toHaveLength(4);
  });

  it("no sources enabled: a clean, honest answer instead of silently answering anyway", async () => {
    const store = new SessionStore();
    const events: AgentStreamEvent[] = [];
    await runSharedAgent({
      sessionId: "chat-1",
      config: { mode: "global" },
      userMessage: "hello",
      // no requestContext.connectedSources — nothing enabled for this chat
      llmClient: new StubStreamClient(),
      sessionStore: store,
      adapters,
      registry,
      onEvent: (e) => { events.push(e); },
    });
    const done = events.find((e): e is Extract<AgentStreamEvent, { type: "done" }> => e.type === "done")!;
    expect(done.text.toLowerCase()).toContain("no sources are enabled");
  });

  it("real tool-calling loop: 'Tell me about dispute #2481' calls commas_get_dispute and answers from the real result, never fabricating", async () => {
    const store = new SessionStore();
    const events: AgentStreamEvent[] = [];
    await runSharedAgent({
      sessionId: "chat-1",
      config: { mode: "global" },
      userMessage: "Tell me about dispute #2481.",
      requestContext: commasSources,
      llmClient: new StubStreamClient(),
      sessionStore: store,
      adapters,
      registry,
      onEvent: (e) => { events.push(e); },
    });
    const done = events.find((e): e is Extract<AgentStreamEvent, { type: "done" }> => e.type === "done")!;
    expect(done.text).toContain("Dispute #2481");
    expect(done.text).toContain("product not received");
    expect(done.text).toContain("$499"); // money() drops trailing .00 for whole-dollar amounts
  });

  it("real tool-calling loop, full 4-question flow: dispute overview -> why -> evidence -> customer purchase history, without repeating the id", async () => {
    const store = new SessionStore();
    const client = new StubStreamClient();
    const ask = async (message: string) => {
      const events: AgentStreamEvent[] = [];
      await runSharedAgent({
        sessionId: "chat-1",
        config: { mode: "global" },
        userMessage: message,
        requestContext: commasSources,
        llmClient: client,
        sessionStore: store,
        adapters,
        registry,
        onEvent: (e) => { events.push(e); },
      });
      return events.find((e): e is Extract<AgentStreamEvent, { type: "done" }> => e.type === "done")!.text;
    };

    const overview = await ask("Tell me about dispute #2481.");
    expect(overview).toContain("Dispute #2481");

    // No dispute id repeated from here on — the stub has to recall #2481 from conversation
    // history, exactly like a real tool-calling model would.
    const why = await ask("Why was it disputed?");
    expect(why.toLowerCase()).toContain("product not received");
    expect(why).toContain("42-minute onboarding call"); // dispute #2481's real, authored likelyReason text

    const evidence = await ask("What evidence do we currently have?");
    expect(evidence).toContain("Access & activity records");
    expect(evidence).toContain("Customer communications");
    expect(evidence).toContain("Transaction & payment details");

    const history = await ask("Has this customer purchased from us before?");
    expect(history).toMatch(/Found 1 transaction totaling \$499\.00/);
  });

  it("two different dispute-focused global conversations never mix up which dispute is in focus", async () => {
    // Isolation at the LLM-reasoning layer, not just the session layer (see the dedicated
    // "context isolation" describe block below for the session-store-level guarantee): even
    // within ONE global session, naming a different dispute must not leak the previous one's
    // facts into the new answer.
    const store = new SessionStore();
    const client = new StubStreamClient();
    const ask = async (message: string) => {
      const events: AgentStreamEvent[] = [];
      await runSharedAgent({
        sessionId: "chat-1",
        config: { mode: "global" },
        userMessage: message,
        requestContext: commasSources,
        llmClient: client,
        sessionStore: store,
        adapters,
        registry,
        onEvent: (e) => { events.push(e); },
      });
      return events.find((e): e is Extract<AgentStreamEvent, { type: "done" }> => e.type === "done")!.text;
    };

    const first = await ask("Tell me about dispute #2481.");
    expect(first).toContain("Dispute #2481");
    const second = await ask("Tell me about dispute #2390.");
    expect(second).toContain("Dispute #2390");
    expect(second).not.toContain("Dispute #2481");
  });

  it("audit P1-4: a dispute mentioned earlier never hijacks an unrelated later question in the same global chat", async () => {
    const store = new SessionStore();
    const client = new StubStreamClient();
    const ask = async (message: string) => {
      const events: AgentStreamEvent[] = [];
      await runSharedAgent({
        sessionId: "chat-sticky-focus",
        config: { mode: "global" },
        userMessage: message,
        requestContext: commasSources,
        llmClient: client,
        sessionStore: store,
        adapters,
        registry,
        onEvent: (e) => { events.push(e); },
      });
      return events.find((e): e is Extract<AgentStreamEvent, { type: "done" }> => e.type === "done")!.text;
    };

    const disputeAnswer = await ask("Tell me about dispute #2481.");
    expect(disputeAnswer).toContain("Dispute #2481");

    const salesAnswer = await ask("Summarize my sales this month");
    expect(salesAnswer).not.toContain("Dispute #2481");
    expect(salesAnswer).toContain("$18,420");
  });

  it("no data available: honestly says a dispute doesn't exist rather than fabricating one", async () => {
    const store = new SessionStore();
    const events: AgentStreamEvent[] = [];
    await runSharedAgent({
      sessionId: "chat-1",
      config: { mode: "dispute", disputeId: "9999" },
      userMessage: "why was it disputed?",
      requestContext: { ...commasSources, dispute: disputeFacts({ disputeId: "9999", customerName: "Nobody" }) },
      llmClient: new StubStreamClient(),
      sessionStore: store,
      adapters,
      registry,
      onEvent: (e) => { events.push(e); },
    });
    const done = events.find((e): e is Extract<AgentStreamEvent, { type: "done" }> => e.type === "done")!;
    expect(done.text).toContain("couldn't find dispute #9999");
  });

  it("tracks investigation progress on the session's own context — advances only after a turn completes", async () => {
    const store = new SessionStore();
    const session = store.resolve("chat-1", { mode: "dispute", disputeId: "2481" });
    expect(session.context.investigation).toEqual({ status: "not_started", turnsCompleted: 0 });

    await runSharedAgent({
      sessionId: "chat-1",
      config: { mode: "dispute", disputeId: "2481" },
      userMessage: "hello",
      requestContext: commasSources,
      llmClient: new StubStreamClient(),
      sessionStore: store,
      adapters,
      registry,
      onEvent: () => {},
    });
    expect(store.get("chat-1")!.context.investigation).toEqual({ status: "in_progress", turnsCompleted: 1 });

    await runSharedAgent({
      sessionId: "chat-1",
      config: { mode: "dispute", disputeId: "2481" },
      userMessage: "thanks",
      requestContext: commasSources,
      llmClient: new StubStreamClient(),
      sessionStore: store,
      adapters,
      registry,
      onEvent: () => {},
    });
    expect(store.get("chat-1")!.context.investigation).toEqual({ status: "in_progress", turnsCompleted: 2 });
  });

  it("emits an error event (not a throw) when the LLM client rejects", async () => {
    const store = new SessionStore();
    const events: AgentStreamEvent[] = [];
    await runSharedAgent({
      sessionId: "chat-1",
      config: { mode: "global" },
      userMessage: "hello",
      requestContext: commasSources,
      llmClient: { streamStep: () => Promise.reject(new Error("boom")) },
      sessionStore: store,
      adapters,
      registry,
      onEvent: (e) => { events.push(e); },
    });
    expect(events).toEqual([{ type: "error", message: "boom" }]);
    // A failed turn doesn't get written into memory as if it succeeded.
    expect(store.get("chat-1")!.transcript).toEqual([]);
  });

  it("aborting mid-stream ends quietly (no error event) and does not persist a partial turn", async () => {
    const store = new SessionStore();
    const controller = new AbortController();
    const events: AgentStreamEvent[] = [];
    await runSharedAgent({
      sessionId: "chat-1",
      config: { mode: "global" },
      userMessage: "hello",
      requestContext: commasSources,
      llmClient: {
        streamStep: async ({ onDelta }) => {
          await onDelta("partial");
          controller.abort();
          const err = new Error("aborted");
          err.name = "AbortError";
          throw err;
        },
      },
      sessionStore: store,
      adapters,
      registry,
      onEvent: (e) => { events.push(e); },
      signal: controller.signal,
    });
    expect(events.filter((e) => e.type === "error")).toEqual([]);
    expect(store.get("chat-1")!.transcript).toEqual([]);
  });

  it("treats any rejection as a real error when the signal was never aborted, even if the error is named AbortError", async () => {
    // Regression: abort detection must key off `signal.aborted`, not the rejected error's
    // `.name` — the real Anthropic SDK throws `APIUserAbortError` (name "Error") on a genuine
    // abort, so name-sniffing both misses real aborts and (as exercised here) could wrongly
    // swallow an unrelated error that merely happens to be named "AbortError".
    const store = new SessionStore();
    const events: AgentStreamEvent[] = [];
    const err = new Error("unrelated failure");
    err.name = "AbortError";
    await runSharedAgent({
      sessionId: "chat-1",
      config: { mode: "global" },
      userMessage: "hello",
      requestContext: commasSources,
      llmClient: { streamStep: () => Promise.reject(err) },
      sessionStore: store,
      adapters,
      registry,
      onEvent: (e) => { events.push(e); },
      // no signal passed at all — signal.aborted can't be true
    });
    expect(events).toEqual([{ type: "error", message: "unrelated failure" }]);
  });

  it("two overlapping requests for the same session are serialized, never interleaved or reordered", async () => {
    // Regression for a race where two concurrent calls on the same sessionId each snapshot the
    // transcript before either wrote back, so whichever finished streaming first — not whichever
    // was sent first — won, silently corrupting turn order for every later turn.
    const store = new SessionStore();
    const client = new StubStreamClient();

    const first = runSharedAgent({
      sessionId: "chat-1",
      config: { mode: "global" },
      userMessage: "hello", // GREETING_REPLY — many words, many chunk delays, finishes slower
      requestContext: commasSources,
      llmClient: client,
      sessionStore: store,
      adapters,
      registry,
      onEvent: () => {},
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = runSharedAgent({
      sessionId: "chat-1",
      config: { mode: "global" },
      userMessage: "thanks", // ACKNOWLEDGMENT_REPLY — one word, would finish first if unserialized
      requestContext: commasSources,
      llmClient: client,
      sessionStore: store,
      adapters,
      registry,
      onEvent: () => {},
    });
    await Promise.all([first, second]);

    const transcript = store.get("chat-1")!.transcript;
    expect(transcript.map((t) => t.text)).toEqual([
      "hello",
      transcript[1].text,
      "thanks",
      transcript[3].text,
    ]);
  });
});

describe("context isolation (critical requirement: switching disputes never leaks, returning to global never inherits)", () => {
  let adapters: SourceAdapter[];
  let registry: Map<string, RegisteredTool>;
  beforeAll(async () => {
    ({ adapters, registry } = await commasFixture());
  });
  const commasSources = { connectedSources: ["commas" as const] };

  it("two different dispute chats sharing one SessionStore never see each other's facts, end to end — real tool-grounded answers, not just context text", async () => {
    // Mirrors the real app: each dispute gets its own chat/session id (App.tsx dedupes chats by
    // context kind+id), so #2481 and #2390 are two entirely separate sessions in the SAME store
    // instance a running server actually uses (one SessionStore per createApp()). Both ask the
    // real tool-calling loop the same question — the answer comes from each session's own
    // commas_get_dispute call, never a shared/leaked value.
    const store = new SessionStore();
    const client = new StubStreamClient();
    const eventsA: AgentStreamEvent[] = [];
    const eventsB: AgentStreamEvent[] = [];

    await runSharedAgent({
      sessionId: "chat-2481",
      config: { mode: "dispute", disputeId: "2481" },
      userMessage: "what evidence do we have?",
      requestContext: { ...commasSources, dispute: disputeFacts({ disputeId: "2481", customerName: "Sarah Johnson" }) },
      llmClient: client,
      sessionStore: store,
      adapters,
      registry,
      onEvent: (e) => { eventsA.push(e); },
    });
    await runSharedAgent({
      sessionId: "chat-2390",
      config: { mode: "dispute", disputeId: "2390" },
      userMessage: "what evidence do we have?",
      requestContext: { ...commasSources, dispute: disputeFacts({ disputeId: "2390", customerName: "Priya Nair" }) },
      llmClient: client,
      sessionStore: store,
      adapters,
      registry,
      onEvent: (e) => { eventsB.push(e); },
    });

    const doneA = eventsA.find((e): e is Extract<AgentStreamEvent, { type: "done" }> => e.type === "done")!.text;
    const doneB = eventsB.find((e): e is Extract<AgentStreamEvent, { type: "done" }> => e.type === "done")!.text;
    // #2481 (Sarah Johnson): open, missing evidence — real DISPUTES record text.
    expect(doneA).toContain("Access & activity records");
    expect(doneA).toContain("Transaction & payment details");
    expect(doneA).not.toContain("already resolved");
    // #2390 (Priya Nair): already resolved — a completely different real answer shape.
    expect(doneB.toLowerCase()).toContain("already resolved");
    expect(doneB).not.toContain("Access & activity records");

    expect(store.get("chat-2481")!.context.dispute?.customerName).toBe("Sarah Johnson");
    expect(store.get("chat-2390")!.context.dispute?.customerName).toBe("Priya Nair");
  });

  it("returning to global chat on the same session id never inherits the dispute it just left", async () => {
    const store = new SessionStore();
    const client = new StubStreamClient();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const disputeEvents: AgentStreamEvent[] = [];
    await runSharedAgent({
      sessionId: "chat-1",
      config: { mode: "dispute", disputeId: "2481" },
      userMessage: "what evidence do we have?",
      requestContext: { ...commasSources, dispute: disputeFacts({ disputeId: "2481", customerName: "Sarah Johnson" }) },
      llmClient: client,
      sessionStore: store,
      adapters,
      registry,
      onEvent: (e) => { disputeEvents.push(e); },
    });

    const globalEvents: AgentStreamEvent[] = [];
    await runSharedAgent({
      sessionId: "chat-1", // same id — the scope-mismatch guard is what must protect this
      config: { mode: "global" },
      userMessage: "what evidence do we have?", // same question, now with no dispute in scope
      requestContext: commasSources,
      llmClient: client,
      sessionStore: store,
      adapters,
      registry,
      onEvent: (e) => { globalEvents.push(e); },
    });
    warn.mockRestore();

    const disputeAnswer = disputeEvents.find((e): e is Extract<AgentStreamEvent, { type: "done" }> => e.type === "done")!.text;
    const globalAnswer = globalEvents.find((e): e is Extract<AgentStreamEvent, { type: "done" }> => e.type === "done")!.text;
    expect(disputeAnswer).toContain("Access & activity records");
    // The exact same question, asked right after in the same slot, does NOT resolve to Sarah
    // Johnson's dispute — global mode has no dispute in focus (no id mentioned, none in this
    // fresh session's history), so it falls through to the generic no-specific-answer reply,
    // never fabricating a dispute-shaped answer out of nothing.
    expect(globalAnswer).not.toContain("Access & activity records");
    expect(globalAnswer).not.toContain("Sarah Johnson");
    expect(globalAnswer).not.toContain("2481");

    expect(store.get("chat-1")!.context.conversationType).toBe("global");
    expect(store.get("chat-1")!.context.dispute).toBeUndefined();
  });
});

describe("POST /api/agent/stream (HTTP layer)", () => {
  let app: Hono;

  beforeAll(async () => {
    app = await createApp();
  });

  it("streams a real SSE response for a global-mode message: ordered deltas then done", async () => {
    const res = await app.request("/api/agent/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: "http-chat-1", mode: "global", message: "hi" }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const frames = await readSSE(res);
    expect(frames[frames.length - 1].event).toBe("done");
    const deltaFrames = frames.filter((f) => f.event === "delta");
    expect(deltaFrames.length).toBeGreaterThan(1);
    const reassembled = deltaFrames.map((f) => (f.data as { text: string }).text).join("");
    expect(reassembled).toBe((frames[frames.length - 1].data as { text: string }).text);
  });

  it("the real tool-calling loop runs end to end over the actual HTTP route — a global-mode dispute question gets a tool-grounded answer", async () => {
    const res = await app.request("/api/agent/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: "http-chat-tools",
        mode: "global",
        message: "Tell me about dispute #2481.",
        enabledSources: ["commas"],
      }),
    });
    expect(res.status).toBe(200);
    const frames = await readSSE(res);
    const done = frames[frames.length - 1];
    expect(done.event).toBe("done");
    expect((done.data as { text: string }).text).toContain("Dispute #2481");
  });

  it("audit P1-2: 'Find information across my connected apps' actually works over the real streaming route, with connector sources enabled", async () => {
    const res = await app.request("/api/agent/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: "http-chat-connected-apps",
        mode: "global",
        message: "Find information across my connected apps",
        enabledSources: ["commas", "google-calendar", "zoom", "fathom", "gmail", "crm"],
      }),
    });
    expect(res.status).toBe(200);
    const frames = await readSSE(res);
    const done = frames[frames.length - 1];
    expect(done.event).toBe("done");
    const text = (done.data as { text: string }).text;
    expect(text).not.toContain("No connected apps are enabled");
  });

  it("supports dispute-mode session config over the same route", async () => {
    const res = await app.request("/api/agent/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: "http-chat-2", mode: "dispute", disputeId: "2481", message: "hi" }),
    });
    expect(res.status).toBe(200);
    const frames = await readSSE(res);
    expect(frames[frames.length - 1].event).toBe("done");
  });

  it("rejects a missing sessionId with a clean 400, not a crash", async () => {
    const res = await app.request("/api/agent/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "hi" }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects an empty message with a clean 400", async () => {
    const res = await app.request("/api/agent/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: "http-chat-3", message: "   " }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects malformed JSON with a clean 400", async () => {
    const res = await app.request("/api/agent/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not json",
    });
    expect(res.status).toBe(400);
  });

  it("rejects a malformed history entry with a clean 400 instead of a 500 crash", async () => {
    const res = await app.request("/api/agent/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: "http-chat-4", message: "hi", history: [null] }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("malformed_result");
  });

  it("a real multi-turn conversation over HTTP: the second call's session has the first turn in memory", async () => {
    const sessionId = "http-chat-memory";
    const first = await app.request("/api/agent/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, mode: "global", message: "hello there" }),
    });
    await readSSE(first);

    // Re-derive a fresh app instance's session store isn't accessible from here (createApp()
    // doesn't expose it) — instead, prove memory the same way a real client would notice it:
    // the second HTTP call must succeed and stream a real reply, and (see the direct
    // runSharedAgent test above for the precise transcript-length assertion) the underlying
    // session is real and shared across requests to the same running app instance.
    const second = await app.request("/api/agent/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, mode: "global", message: "thanks" }),
    });
    expect(second.status).toBe(200);
    const frames = await readSSE(second);
    expect(frames[frames.length - 1].event).toBe("done");
  });
});
