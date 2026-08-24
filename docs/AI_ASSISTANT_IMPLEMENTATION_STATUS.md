# AI Assistant Implementation Status

**Branch:** `experiment/unified-ai-assistant`
**Baseline commit (main):** `c3a250c6701427e065aa388205f1f3516cc38216`
**Baseline document:** [`AI_ASSISTANT_BASELINE.md`](./AI_ASSISTANT_BASELINE.md)
**Architecture document:** [`AI_ASSISTANT_ARCHITECTURE.md`](./AI_ASSISTANT_ARCHITECTURE.md)

## Goal

Build a real AI assistant inside the existing Commas AI Agent prototype that can power both global chat and Resolution Center investigation without breaking the existing product UI and UX.

## Initial architecture goals

- one shared agent system
- global AI workspace
- dispute-scoped AI
- persistent context
- Commas data tools
- connected-source tools
- human-approved Resolution Center actions

## Rules

- preserve the existing Commas UI
- do not replace polished UI with generic framework UI
- do not create another project
- all experimental work remains isolated to this branch
- main remains untouched

## Current phase

**2 — Foundational shared agent runtime (implemented, live-verified)**

The shared agent from `AI_ASSISTANT_ARCHITECTURE.md` §2–§4 is real, running code: one runtime, one session abstraction with GLOBAL/DISPUTE modes, real streaming to a real LLM (or a genuinely-chunked deterministic stub when no key is configured), reachable end-to-end from the existing, unredesigned global Chat UI. The legacy `server/agent/runtime.ts` loop — and therefore the Resolution Center's entire "Investigate with AI" flow, including tool calls and the write-approval pause — is untouched and was re-verified live, not just left alone in theory.

## Phase log

| Phase | Description | Status |
|---|---|---|
| 0 | Baseline documentation (`AI_ASSISTANT_BASELINE.md`, this file) | ✅ Complete — 2026-08-24 |
| 1 | Architecture definition (`AI_ASSISTANT_ARCHITECTURE.md`) — one shared agent, two modes; stack, session/context, tools, actions, persistence, risks, sequencing | ✅ Analyzed, not implemented — 2026-08-24 |
| 2 | Foundational shared agent runtime — session/context/runtime modules, streaming LLM client (real + stub), `POST /api/agent/stream`, global-chat wiring | ✅ Implemented, live-verified — 2026-08-24 |
| 3 | One dataset + wider Commas/connector tools with citations, wired into the shared agent's own tool-calling loop | ⏳ Next |

## Phase 2 — what was built

### Dependencies added

**None.** Every capability this phase needed was already installed on `main`, exactly as `AI_ASSISTANT_ARCHITECTURE.md` §9 predicted: `@anthropic-ai/sdk` 0.120 (`client.messages.stream()`, confirmed to accept `{signal}` as request options), `hono`/`@hono/node-server` 4.13 (`streamSSE` from `hono/streaming`), native `Response`/`ReadableStream`/`TextDecoder` (server *and* browser). `package.json` is unmodified. CopilotKit and the Claude Agent SDK were **not** introduced, per the architecture doc's explicit recommendation.

### Runtime architecture

Two agent runtimes now exist side by side on purpose (see `server/agent/README.md`, new, for the full account) — this is not a rewrite, it's an addition:

```
existing chat UI (unchanged)
        │
        ├─ dispute-context chats ──────────────► POST /api/agent/run   (legacy — untouched)
        │                                          server/agent/runtime.ts
        │                                          → LlmClient.nextStep() → SourceAdapter tools
        │                                          → write-approval pause → Resolution Center
        │
        └─ global/dashboard chats ─────────────► POST /api/agent/stream (new)
                                                   server/agent/runtime/sharedAgent.ts
                                                   → SessionStore.resolve(sessionId, config)
                                                   → buildContextPrompt(session)
                                                   → StreamingLlmClient.streamReply()
                                                       (AnthropicStreamClient | StubStreamClient)
                                                   → SSE: event delta* → event done | event error
```

`sendMessage` in `useChatStore.tsx` is the single branch point: `chat.context?.kind === "dispute"` → the exact pre-existing code path; anything else → the new streaming path. No other component decides this.

**Session model** (`server/agent/sessions/store.ts`): `SessionConfig = {mode:"global"} | {mode:"dispute", disputeId}` — the literal "GLOBAL SESSION or DISPUTE SESSION" the task asked for, as a discriminated union, not a string flag. `SessionStore.resolve(sessionId, config, bootstrapHistory?)` finds-or-creates a session keyed by the chat id; a session whose stored config disagrees with the request is discarded and recreated (a scope-leakage guard, ported as a pattern — not code — from the `commas-ai-copilot` POC's `ScopeSessionStore`), verified by a dedicated test and live via a hand-run smoke script (`console.warn` firing exactly as designed). One `SessionStore` instance per `createApp()` call, matching how adapters/registry/llmClient are already constructed there, so tests and separate server processes never share state.

**Context** (`server/agent/context/buildContext.ts`): `buildContextPrompt(session)` is the *only* place GLOBAL vs. DISPUTE changes anything — a different system-prompt string, nothing else. Deliberately minimal this phase (no dispute facts, no tool inventory, no evidence — see Known limitations).

**Runtime loop** (`server/agent/runtime/sharedAgent.ts`): `runSharedAgent()` resolves the session, builds the prompt, streams a reply (forwarding every delta to an `onEvent` sink as it arrives), then persists **both** the user and assistant turn into the session's own transcript. The next call in the same session sends the model that accumulated transcript, not client-resent text — genuine server-side memory, proven by a test that intercepts what the LLM client actually receives (`tests/server/sharedAgent.test.ts` — transcript length `[1, 3]` across two calls, not `[1, 1]`). Errors become a `{type:"error"}` event instead of an unhandled rejection; an aborted run ends quietly with nothing persisted.

**LLM clients** (`server/llm/streaming/`): a new `StreamingLlmClient` interface (delta-shaped: `streamReply({systemPrompt, transcript, onDelta, signal})`), deliberately separate from the legacy request/response `LlmClient` so nothing about the old interface changed. `AnthropicStreamClient` calls `client.messages.stream()` and forwards its `"text"` events; `StubStreamClient` is a **real, genuinely-chunked** deterministic fallback (word-by-word with a 35ms delay) used whenever `ANTHROPIC_API_KEY` is unset — the same reason the legacy `StubLlmClient` exists, but this one exercises the streaming *transport* honestly instead of returning one blob. Model is configurable via `AGENT_MODEL` (falls back to `claude-opus-5`).

**Transport** (`server/app.ts`, additive): `POST /api/agent/stream` — real Server-Sent Events via `hono/streaming`'s `streamSSE`, not JSON. Request: `{sessionId, mode?, disputeId?, message, history?}`. Response frames: repeated `event: delta` (`{text}`) as the reply streams in, then one `event: done` (`{text: full}`) or `event: error` (`{message}`). `history` only bootstraps a *brand-new* session's memory (e.g. resuming a chat whose server-side session was never created) — an existing session's own transcript always wins. `/api/agent/run` and `/api/agent/approve` are byte-for-byte unmodified.

**Client** (`src/lib/agentApi.ts`, additive): `streamAgentMessage()` — plain `fetch` + a hand-rolled SSE frame parser (not `EventSource`, which can't POST a JSON body or honor an `AbortSignal`). `AgentStreamError` distinguishes a *server-authored* error (safe to show verbatim, exactly like the legacy path's `plan.error.message`) from any other failure (network rejection, non-2xx, unreadable stream), which always renders the same fixed, product-voiced fallback the legacy path already used — a real bug caught and fixed during test-writing: the first version leaked raw browser error text like `"Failed to fetch"` into the chat, which is exactly what PRODUCT_READINESS_AUDIT.md's P1-4 fix was written to prevent.

**Store wiring** (`src/hooks/useChatStore.tsx`): three small additive helpers — `ensureStreamingMessage` (appends an empty `streaming:true` placeholder), `appendStreamDelta` (grows its text), `finalizeStreamedMessage` (settles it; drops it instead of leaving an empty bubble if nothing ever arrived, e.g. cancelled before the first delta). `sendMessage`'s existing credit charge, one-run-at-a-time guard, and cancellation (`AbortController`) are shared by both paths unchanged.

**UI** (`src/components/chat/ChatMessageList.tsx`, one guard added): the generic "Thinking…" `ProgressBlock` is suppressed once the streaming placeholder message already has content, so the seller sees the real, growing answer instead of a stale spinner sitting above it. Dispute chats never set `streaming` on a message, so `ProgressBlock`'s behavior there is completely unchanged. This is the only pixel of `ChatMessageList` that changed.

### Files created

| File | Lines | Purpose |
|---|---|---|
| `server/agent/sessions/store.ts` | 86 | `SessionStore`, `SessionConfig`, the scope-leakage guard |
| `server/agent/context/buildContext.ts` | 33 | `buildContextPrompt` — global vs. dispute system prompt |
| `server/agent/runtime/sharedAgent.ts` | 76 | `runSharedAgent()` — the loop |
| `server/agent/tools/index.ts` | 19 | placeholder — deliberately empty, documents where real tools land |
| `server/agent/actions/index.ts` | 12 | placeholder — deliberately empty, documents where propose/approve lands |
| `server/agent/README.md` | 26 | why two runtimes coexist, folder-by-folder |
| `server/llm/streaming/types.ts` | 29 | `StreamingLlmClient` interface |
| `server/llm/streaming/anthropicStreamClient.ts` | 51 | real streaming client |
| `server/llm/streaming/stubStreamClient.ts` | 59 | genuinely-chunked deterministic fallback |
| `tests/server/sharedAgent.test.ts` | 349+ | 20 tests (session store, context prompt, runtime loop, HTTP layer), +4 regression tests added after the adversarial review below |

### Files modified

| File | Change |
|---|---|
| `server/app.ts` | + `POST /api/agent/stream` route, + streaming client/session-store construction. Every existing route/import/behavior unchanged. |
| `src/lib/types.ts` | + optional `ChatMessage.streaming?: boolean` (backward-compatible; absent everywhere except the new path). |
| `src/lib/agentApi.ts` | + `streamAgentMessage()`, + `AgentStreamError`. `runAgentTurn`/`approveAgentAction`/`postJson` unchanged. |
| `src/hooks/useChatStore.tsx` | `sendMessage` branches on `chat.context?.kind === "dispute"`; dispute branch is the exact pre-existing code, byte-for-byte. + 3 streaming helpers. |
| `src/components/chat/ChatMessageList.tsx` | + one guard suppressing `ProgressBlock` once real streamed content exists. |
| `tests/ChatFlow.test.tsx` | 6 of 9 tests updated: the 5 that send a message in a *global* chat now mock the SSE contract instead of the JSON one (assertions on **intent** — request shape, rendered text, error handling — are unchanged, only the wire format they mock changed); the approval-card test moved to a dispute-context harness, since write/approval is dispute-mode-only in this phase (see Known limitations) — it still proves the exact same thing (approval pauses, only Approve executes) against the exact same legacy code. The other 3 tests were already unaffected. |
| `tests/CreditSystem.test.tsx` | Same mock swap for every test that sends a message (A, C, D, E); assertions (credit math, disabled states) were already independent of response shape and needed no changes. `mockFetchOnce` removed (no longer referenced). |

No file under `src/components/resolution/`, `src/components/dashboard/`, `src/components/shell/`, `server/adapters/`, `server/mcp/`, `server/agent/{runtime,registry,errors}.ts`, or `server/llm/{types,anthropicClient,stubClient}.ts` was touched.

### Verification performed

- `npx tsc -b --noEmit` — clean, 0 errors (app + node + server projects).
- `npm run lint` — clean, 0 errors/warnings.
- `npx vitest run` — **118/118 passing** (94 original + 20 from this phase's own new coverage + 4 regression tests added after the adversarial review below; 0 regressions — every original test's *intent* is preserved, only the mocked wire format changed where the code under test genuinely changed).
- `npm run build` — clean; bundle grew 258.52 kB → 260.78 kB (+2.3 kB, +0.9%) for the new streaming client + SSE parser — no new dependency pulled in.
- **Live, in a real browser**, both servers actually running (no `ANTHROPIC_API_KEY` in this environment, so the stub streaming client is what ran):
  1. Reset demo data (the app's own existing control), opened Chat, sent "Hello there" in a fresh global chat — watched the reply render **word by word** in real time (caught mid-stream at "I can help", then complete), credits 300→299 charged once, Stop button live during the stream, composer re-enabled cleanly on completion, no leftover "Thinking…" indicator.
  2. Sent a follow-up ("thanks") in the same chat — correct multi-turn rendering, credits 299→298, both turns visible.
  3. Console: zero errors (only routine Vite/React DevTools messages). Network: confirmed `POST /api/agent/stream` → 200.
  4. Resolution Center: list (4 disputes, correct dates/badges), Dispute #2481 detail page, "Investigate with AI" panel (context header + all 7 chips) — all pixel-identical to the documented baseline.
  5. "What evidence do I need?" chip → correct deterministic gap answer + "Checked 1 source", credits 298→297.
  6. "Investigate this dispute" (typed) → the full multi-source investigation chain ran, correctly citing Sarah's 14 logins/6-of-12-lessons/42-minute Fathom call, correctly naming GoHighLevel/Gmail as unchecked, "Checked 3 sources", credits 297→296 — the legacy stub's exact documented behavior, unchanged.
  7. "mark the response ready" → approval card rendered → Approve → "Done — I've marked the dispute response as ready. Nothing was submitted anywhere…" → scrolled the dispute page and confirmed the **"Marked ready by AI"** badge appeared next to "Your response", Submit still disabled — the full write/approval round trip, unchanged.

### Post-implementation adversarial review

Before committing, the full Phase 2 diff was run through an independent 4-reviewer adversarial-review workflow (parallel scoped review → independent skeptical verification of each finding). Of 4 raw findings, all 4 were confirmed real and fixed prior to commit:

| Severity | File | Issue | Fix |
|---|---|---|---|
| High | `server/agent/runtime/sharedAgent.ts` | Two overlapping requests for the same session (e.g. the same chat open in two tabs) each snapshotted the transcript before either wrote back — whichever finished streaming first, not whichever was sent first, won, silently reordering or dropping turns for every later turn in that session. | Added `SessionStore.runExclusive(sessionId, fn)` — a per-session promise queue — and wrapped the resolve/snapshot/stream/persist sequence in it. Different sessions still run fully concurrently; only overlapping calls on the *same* session serialize. |
| High | `src/hooks/useChatStore.tsx` | `deleteChat` frees `runChatId` synchronously (unlike `cancelRun`'s 300ms hold), so a new run can start on a different chat before the deleted chat's own in-flight request settles. That orphaned request's eventual completion reset the shared `cancelledRef` (by then already reset to `false` by the *new* run's own start) and could free `runChatId`/`runPhase` while the new run was still genuinely active — defeating the one-run-at-a-time guard (P1-6). | `deleteChat` now mirrors `cancelRun` (sets `cancelledRef`, aborts the controller). More importantly, both `sendMessage` branches now also check `abortRef.current !== controller` (`supersededByLaterRun()`) before touching shared run state — a reference check that stays correct even when a newer run has reset `cancelledRef`, since a newer run always installs its own `AbortController`. |
| Medium | `server/agent/runtime/sharedAgent.ts` | Abort detection checked `err.name === "AbortError"`, which the real `@anthropic-ai/sdk` never throws on an aborted stream (`APIUserAbortError`'s `.name` is the generic `"Error"`) — only `StubStreamClient`'s synthetic `DOMException` happened to satisfy it. A real client-initiated cancel against a live model would be misreported as a genuine failure. | Switched to checking `signal?.aborted` directly — true source of truth, independent of whatever error class the underlying client throws. |
| Low | `server/app.ts` | `POST /api/agent/stream` validated `sessionId`/`message` but not the shape of individual `history` entries — a malformed entry (e.g. `null`) threw an uncaught `TypeError`, falling through to Hono's generic 500 instead of the route's own clean `{error:"malformed_result"}` 400 contract. | Added a shape check (`{role: "user"\|"assistant", text: string}` per entry) before mapping, returning the same 400 contract as every other malformed-input case on this route. |

All four fixes have dedicated regression tests (`tests/server/sharedAgent.test.ts`: concurrent-session ordering, abort-vs-unrelated-error, malformed history entry; `tests/ChatFlow.test.tsx`: delete-mid-stream vs. a newer active run). Full suite: **118/118 passing**, `tsc --noEmit` clean, `npm run build` clean.

## Known limitations (honest, not hidden)

- **Conversation-only — no tools yet.** The shared agent cannot call any tool in this phase ("do not implement all real tools yet" was the explicit instruction). It cannot look up a customer, a transaction, or a dispute, and it does not know the seller's name or business details. Global chat's answers are genuinely helpful in tone but not grounded in any data — that's Phase 3.
- **The stub's replies don't vary by session mode or by prior turns.** `StubStreamClient` only pattern-matches the *latest* message; it doesn't read the system prompt or the transcript. Session mode (`buildContextPrompt`) and multi-turn memory (`session.transcript` accumulation) are both real and independently tested (`tests/server/sharedAgent.test.ts`) at the data-structure level — but only a live model, given the different system prompt and the real transcript, would visibly *behave* differently because of them. This environment has no `ANTHROPIC_API_KEY`, so that visible difference has not been observed live; wiring one and re-running the "Hello there" walkthrough above against `AnthropicStreamClient` is the natural next check.
- **Write/approval capability exists only on dispute-context chats.** Before this phase, the stub's `commas_mark_dispute_response_ready` write tool was reachable from *any* chat, including global, by typing the exact undocumented phrase "mark the response ready". Global chats now route to the shared agent, which has no tools at all, so that specific (never demo-scripted, never chip-driven) capability is no longer reachable from a global chat — only from the dispute chat that actually powers the Resolution Center's write/approval flow, which is fully preserved and re-verified live above.
- **Session memory is in-process only.** `SessionStore` is a plain `Map`; a server restart loses every shared-agent session (the *rendered* transcript in the browser survives via localStorage, but the model's own memory does not). No bootstrap-from-client-history path exists yet for a session that already had turns before the process restarted mid-conversation losing them silently — architecture §4's `memoryLost` signal is deferred; `bootstrapHistory` only seeds a session that's brand new to the store.
- **No persistence to `data/state.json`.** Sessions live in memory only, matching the legacy runtime's own persistence story (the `data/state.json` gitignore entry has never been written to by either runtime).
- **No dataset behind the context yet.** `buildContextPrompt` cannot mention a specific dispute's real facts (customer, amount, evidence) — Phase 3 wires the one shared dataset and widened tool layer from `AI_ASSISTANT_ARCHITECTURE.md` §6 into this exact loop.
- **`server/types.ts` / `src/lib/types.ts`** were not unified into a `shared/` module this phase (architecture §10's Phase 3 item) — the new streaming request/response shapes are defined locally in `server/app.ts` / `src/lib/agentApi.ts` instead, kept intentionally small.

## Implementation sequence (from architecture §11)

1. ~~Live model on the existing loop (no UI change)~~ — **done this phase**, plus streaming + sessions pulled forward from §11's phases 3–4 to satisfy this task's explicit ask for a session abstraction and streamed responses now.
2. One dataset + wider Commas/connector tools with citations — **next**
3. Server-side sessions + context envelope + context block — session store/context builder now exist; the envelope (page/evidence/sources) and delta-context-block refinement are still open
4. Streaming SSE transport consumed by `useChatStore` — **done this phase**
5. Dispute-mode investigation prompt (loop, stopping criteria, report format)
6. Resolution Center persistence + proposal/approval actions (`ProposalCard`, executors)
7. Global-mode polish, hardening, docs, regression suite

## Notes

- `docs/active-context.md` is the accurate history of how `main` got here; `docs/ARCHITECTURE.md` / `IMPLEMENTATION_PLAN.md` describe parts that were never built (SSE, backend store, metered credits) — this phase is the first place a *real* SSE stream exists in this repo, on the new route only. See baseline §13–§15 for the reconciled list.
- The sibling `../commas-ai-copilot` repo (and its `experiment/copilotkit-poc` branch) is reference material only — nothing is imported across repos; patterns (scope guard, session model) were reimplemented from scratch against this repo's own types and conventions.
