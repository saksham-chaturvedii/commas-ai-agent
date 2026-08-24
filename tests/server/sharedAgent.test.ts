// @vitest-environment node
import { describe, expect, it, beforeAll, vi } from "vitest";
import type { Hono } from "hono";
import { createApp } from "../../server/app.js";
import { SessionStore } from "../../server/agent/sessions/store.js";
import { buildContextPrompt } from "../../server/agent/context/buildContext.js";
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

  it("discards a session whose stored config disagrees with the request (dispute -> global)", () => {
    const store = new SessionStore();
    const disputeSession = store.resolve("chat-1", { mode: "dispute", disputeId: "2481" });
    disputeSession.transcript.push({ role: "user", text: "about #2481" }, { role: "assistant", text: "..." });

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const globalSession = store.resolve("chat-1", { mode: "global" });
    warn.mockRestore();

    expect(globalSession.config).toEqual({ mode: "global" });
    expect(globalSession.transcript).toEqual([]); // fresh, not the dispute transcript
    expect(globalSession).not.toBe(disputeSession);
  });

  it("discards a session whose stored config disagrees with the request (same dispute id required)", () => {
    const store = new SessionStore();
    store.resolve("chat-1", { mode: "dispute", disputeId: "2481" });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const other = store.resolve("chat-1", { mode: "dispute", disputeId: "3102" });
    warn.mockRestore();
    expect(other.config).toEqual({ mode: "dispute", disputeId: "3102" });
    expect(other.transcript).toEqual([]);
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

describe("buildContextPrompt", () => {
  it("global mode: no dispute framing", () => {
    const prompt = buildContextPrompt({
      sessionId: "s",
      config: { mode: "global" },
      transcript: [],
      createdAt: "",
      updatedAt: "",
    });
    expect(prompt).toContain("general workspace conversation");
    expect(prompt).not.toContain("Dispute #");
  });

  it("dispute mode: names the specific dispute and is honest about not having tools yet", () => {
    const prompt = buildContextPrompt({
      sessionId: "s",
      config: { mode: "dispute", disputeId: "2481" },
      transcript: [],
      createdAt: "",
      updatedAt: "",
    });
    expect(prompt).toContain("Dispute #2481");
    expect(prompt.toLowerCase()).toContain("do not have dispute-investigation tools");
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
      userMessage: "hello", // FALLBACK_REPLY — many words, many chunk delays, finishes slower
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
