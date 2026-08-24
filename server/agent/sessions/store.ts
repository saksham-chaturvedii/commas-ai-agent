/**
 * Session store for the shared agent runtime (docs/AI_ASSISTANT_ARCHITECTURE.md §4). A session
 * is keyed by the client's chat id and carries its own `SessionConfig` — the "GLOBAL SESSION" /
 * "DISPUTE SESSION" concept from the architecture doc — plus the real model-facing transcript.
 * This is the persistent-memory mechanism the legacy `server/agent/runtime.ts` never had: that
 * runtime is stateless and relies entirely on the client resending text history every turn (see
 * docs/AI_ASSISTANT_BASELINE.md §15.4). This store makes memory a server-side fact instead.
 *
 * One instance is created per `createApp()` call (see server/app.ts), not a module singleton —
 * matching how adapters/registry/llmClient are already constructed there — so each test run (and
 * each server process) starts with a clean slate and tests never leak session state into each
 * other.
 */

export type SessionConfig = { mode: "global" } | { mode: "dispute"; disputeId: string };

export interface SessionTranscriptEntry {
  role: "user" | "assistant";
  text: string;
}

export interface SessionRecord {
  sessionId: string;
  config: SessionConfig;
  transcript: SessionTranscriptEntry[];
  createdAt: string;
  updatedAt: string;
}

function configsMatch(a: SessionConfig, b: SessionConfig): boolean {
  if (a.mode !== b.mode) return false;
  if (a.mode === "dispute" && b.mode === "dispute") return a.disputeId === b.disputeId;
  return true;
}

export class SessionStore {
  private sessions = new Map<string, SessionRecord>();
  private queues = new Map<string, Promise<unknown>>();

  /**
   * Runs `fn` after every previously-queued call for this `sessionId` has settled, and before
   * any call queued after it — turning "read the session, do async work, write the session back"
   * into an effectively atomic unit per session. Without this, two overlapping requests for the
   * same session (e.g. the same chat open in two tabs) each snapshot the transcript before either
   * writes back, so whichever finishes streaming first — not whichever was sent first — wins,
   * silently reordering or dropping turns. Different sessionIds never wait on each other.
   */
  runExclusive<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
    const prior = this.queues.get(sessionId) ?? Promise.resolve();
    const run = prior.then(fn, fn);
    this.queues.set(
      sessionId,
      run.catch(() => {}),
    );
    return run;
  }

  /**
   * Finds or creates the session for `sessionId`. If a session already exists under this id but
   * was created for a *different* configuration (e.g. a chat id somehow reused across a dispute
   * and the global workspace), the mismatched session is discarded and a fresh one is created —
   * failing closed toward "forgets", never toward "remembers the wrong dispute's conversation".
   *
   * `bootstrapHistory` seeds a brand-new session's transcript from client-sent text history —
   * used so a chat that already has messages in the browser (a seed chat, or a chat whose
   * server-side session was lost to a restart) doesn't appear to have suddenly forgotten
   * everything the moment this store has no record of it. An *existing* session's own
   * accumulated transcript always takes precedence over `bootstrapHistory` — that accumulated
   * transcript, not resent client text, is what proves server-side memory actually works.
   */
  resolve(sessionId: string, config: SessionConfig, bootstrapHistory: SessionTranscriptEntry[] = []): SessionRecord {
    const existing = this.sessions.get(sessionId);
    if (existing && configsMatch(existing.config, config)) {
      return existing;
    }
    if (existing) {
      console.warn(
        `[agent-session] scope mismatch for session "${sessionId}" (had ${JSON.stringify(existing.config)}, ` +
          `got ${JSON.stringify(config)}) — discarding and starting fresh.`,
      );
    }
    const now = new Date().toISOString();
    const fresh: SessionRecord = {
      sessionId,
      config,
      transcript: [...bootstrapHistory],
      createdAt: now,
      updatedAt: now,
    };
    this.sessions.set(sessionId, fresh);
    return fresh;
  }

  get(sessionId: string): SessionRecord | undefined {
    return this.sessions.get(sessionId);
  }

  delete(sessionId: string): boolean {
    return this.sessions.delete(sessionId);
  }

  size(): number {
    return this.sessions.size;
  }
}
