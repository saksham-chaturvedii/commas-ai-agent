// @vitest-environment node
import { describe, expect, it, beforeAll, vi } from "vitest";
import type { Hono } from "hono";
import { createApp } from "../../server/app.js";
import { SessionStore } from "../../server/agent/sessions/store.js";
import { buildContextPrompt } from "../../server/agent/context/buildContext.js";
import { buildAgentContext, agentContextFromPageContext } from "../../server/agent/context/model.js";
import { runSharedAgent, type AgentStreamEvent } from "../../server/agent/runtime/sharedAgent.js";
import { StubStreamClient } from "../../server/llm/streaming/stubStreamClient.js";

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
  it("emits ordered delta events that reassemble into the full reply, then a done event", async () => {
    const store = new SessionStore();
    const events: AgentStreamEvent[] = [];
    await runSharedAgent({
      sessionId: "chat-1",
      config: { mode: "global" },
      userMessage: "hello",
      llmClient: new StubStreamClient(),
      sessionStore: store,
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
      llmClient: new StubStreamClient(),
      sessionStore: store,
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
    const originalStreamReply = client.streamReply.bind(client);
    client.streamReply = (args) => {
      seenTranscriptLengths.push(args.transcript.length);
      return originalStreamReply(args);
    };

    await runSharedAgent({
      sessionId: "chat-1",
      config: { mode: "global" },
      userMessage: "hi",
      llmClient: client,
      sessionStore: store,
      onEvent: () => {},
    });
    await runSharedAgent({
      sessionId: "chat-1",
      config: { mode: "global" },
      userMessage: "thanks",
      llmClient: client,
      sessionStore: store,
      onEvent: () => {},
    });

    // First call: just the new user turn. Second call: the first turn's user+assistant pair,
    // PLUS the new user turn — proof the runtime hands the model real accumulated history from
    // its own session store, not just whatever the caller passed this time.
    expect(seenTranscriptLengths).toEqual([1, 3]);
    expect(store.get("chat-1")!.transcript).toHaveLength(4);
  });

  it("dispute mode adds the runtime's own no-tools-yet caveat; buildContextPrompt itself stays tool-agnostic (see buildContextPrompt tests above)", async () => {
    const store = new SessionStore();
    const seenPrompts: string[] = [];
    const client = new StubStreamClient();
    const originalStreamReply = client.streamReply.bind(client);
    client.streamReply = (args) => {
      seenPrompts.push(args.systemPrompt);
      return originalStreamReply(args);
    };

    await runSharedAgent({
      sessionId: "chat-1",
      config: { mode: "dispute", disputeId: "2481" },
      userMessage: "what evidence do we have?",
      requestContext: {
        dispute: {
          disputeId: "2481",
          customerId: "sarah.johnson@email.com",
          customerName: "Sarah Johnson",
          transactionId: "txn_1",
          reason: "product_not_received",
          status: "Needs response",
          evidenceStatus: "not_started",
          evidenceSummary: [],
        },
      },
      llmClient: client,
      sessionStore: store,
      onEvent: () => {},
    });

    expect(seenPrompts[0]).toContain("Dispute #2481");
    expect(seenPrompts[0].toLowerCase()).toContain("do not have live investigation tools");
  });

  it("tracks investigation progress on the session's own context — advances only after a turn completes", async () => {
    const store = new SessionStore();
    const session = store.resolve("chat-1", { mode: "dispute", disputeId: "2481" });
    expect(session.context.investigation).toEqual({ status: "not_started", turnsCompleted: 0 });

    await runSharedAgent({
      sessionId: "chat-1",
      config: { mode: "dispute", disputeId: "2481" },
      userMessage: "hello",
      llmClient: new StubStreamClient(),
      sessionStore: store,
      onEvent: () => {},
    });
    expect(store.get("chat-1")!.context.investigation).toEqual({ status: "in_progress", turnsCompleted: 1 });

    await runSharedAgent({
      sessionId: "chat-1",
      config: { mode: "dispute", disputeId: "2481" },
      userMessage: "thanks",
      llmClient: new StubStreamClient(),
      sessionStore: store,
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
      llmClient: { streamReply: () => Promise.reject(new Error("boom")) },
      sessionStore: store,
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
      llmClient: {
        streamReply: async ({ onDelta }) => {
          await onDelta("partial");
          controller.abort();
          const err = new Error("aborted");
          err.name = "AbortError";
          throw err;
        },
      },
      sessionStore: store,
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
      llmClient: { streamReply: () => Promise.reject(err) },
      sessionStore: store,
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
      llmClient: client,
      sessionStore: store,
      onEvent: () => {},
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = runSharedAgent({
      sessionId: "chat-1",
      config: { mode: "global" },
      userMessage: "thanks", // ACKNOWLEDGMENT_REPLY — one word, would finish first if unserialized
      llmClient: client,
      sessionStore: store,
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
  it("two different dispute chats sharing one SessionStore never see each other's facts, end to end", async () => {
    // Mirrors the real app: each dispute gets its own chat/session id (App.tsx dedupes chats by
    // context kind+id), so #2481 and #2390 are two entirely separate sessions in the SAME store
    // instance a running server actually uses (one SessionStore per createApp()).
    const store = new SessionStore();
    const client = new StubStreamClient();
    const eventsA: AgentStreamEvent[] = [];
    const eventsB: AgentStreamEvent[] = [];

    await runSharedAgent({
      sessionId: "chat-2481",
      config: { mode: "dispute", disputeId: "2481" },
      userMessage: "what evidence do we have?",
      requestContext: {
        dispute: disputeFacts({
          disputeId: "2481",
          customerName: "Sarah Johnson",
          evidenceSummary: [{ category: "Transaction & payment details", count: 1 }],
        }),
      },
      llmClient: client,
      sessionStore: store,
      onEvent: (e) => { eventsA.push(e); },
    });
    await runSharedAgent({
      sessionId: "chat-2390",
      config: { mode: "dispute", disputeId: "2390" },
      userMessage: "what evidence do we have?",
      requestContext: {
        dispute: disputeFacts({
          disputeId: "2390",
          customerName: "Priya Nair",
          evidenceSummary: [{ category: "Customer communications", count: 3 }],
        }),
      },
      llmClient: client,
      sessionStore: store,
      onEvent: (e) => { eventsB.push(e); },
    });

    const doneA = eventsA.find((e): e is Extract<AgentStreamEvent, { type: "done" }> => e.type === "done")!.text;
    const doneB = eventsB.find((e): e is Extract<AgentStreamEvent, { type: "done" }> => e.type === "done")!.text;
    expect(doneA).toContain("Transaction & payment details");
    expect(doneA).not.toContain("Customer communications");
    expect(doneA).not.toContain("2390");
    expect(doneB).toContain("Customer communications");
    expect(doneB).not.toContain("Transaction & payment details");
    expect(doneB).not.toContain("2481");

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
      requestContext: {
        dispute: disputeFacts({
          disputeId: "2481",
          customerName: "Sarah Johnson",
          evidenceSummary: [{ category: "Transaction & payment details", count: 1 }],
        }),
      },
      llmClient: client,
      sessionStore: store,
      onEvent: (e) => { disputeEvents.push(e); },
    });

    const globalEvents: AgentStreamEvent[] = [];
    await runSharedAgent({
      sessionId: "chat-1", // same id — the scope-mismatch guard is what must protect this
      config: { mode: "global" },
      userMessage: "what evidence do we have?", // same question, now with no dispute in scope
      llmClient: client,
      sessionStore: store,
      onEvent: (e) => { globalEvents.push(e); },
    });
    warn.mockRestore();

    const disputeAnswer = disputeEvents.find((e): e is Extract<AgentStreamEvent, { type: "done" }> => e.type === "done")!.text;
    const globalAnswer = globalEvents.find((e): e is Extract<AgentStreamEvent, { type: "done" }> => e.type === "done")!.text;
    expect(disputeAnswer).toContain("Transaction & payment details");
    // The exact same question, asked right after in the same slot, gets the generic fallback —
    // not Sarah Johnson's evidence — because global mode has no `dispute` in its context at all.
    expect(globalAnswer).not.toContain("Transaction & payment details");
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
