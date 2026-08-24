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

**6 — Simulated multi-source connectors + reason-driven selective investigation (implemented, live-verified)**

Gmail, Google Calendar, Fathom, Zoom, and GoHighLevel are now realistic simulated connectors (no OAuth, no live external calls) exposed through the same `SourceAdapter` tool abstraction Commas already uses — enriched with source-specific data (email threads by category, calendar event durations, call transcripts/recordings, meeting join/leave times, CRM pipeline stage + activity log) instead of the near-empty stubs from earlier phases. The legacy runtime's dispute-investigation chain (`server/llm/stubClient.ts`) no longer checks every connector for every dispute: `REASON_SOURCE_PRIORITY` maps a dispute's reason code to an ordered, selective list of sources to check (`product_not_received` → Fathom/Zoom/Gmail; `product_unacceptable` → Calendar/Zoom/Fathom/Gmail; `duplicate` → Gmail only; `fraudulent` → GoHighLevel), and the synthesis step reports two distinct reasons a source might be absent — genuinely not enabled for the chat, vs. enabled but deliberately lower priority for this reason — instead of one blanket "missing" bucket. The explicit "search across my connected apps" path is unchanged and stays exhaustive by design. Live-verified end to end: Marcus Webb's #2502 (`product_unacceptable`) investigation checks Calendar/Zoom/Fathom/Gmail (skipping GoHighLevel) and surfaces genuinely ambiguous evidence — the booked call happened but ran 14 of 30 minutes; Sarah Johnson's #2481 (`product_not_received`) checks only Fathom/Zoom when Gmail isn't enabled for the chat, and correctly separates "GoHighLevel, Gmail — not enabled" from "Google Calendar — available but lower priority" in the answer.

## Phase log

| Phase | Description | Status |
|---|---|---|
| 0 | Baseline documentation (`AI_ASSISTANT_BASELINE.md`, this file) | ✅ Complete — 2026-08-24 |
| 1 | Architecture definition (`AI_ASSISTANT_ARCHITECTURE.md`) — one shared agent, two modes; stack, session/context, tools, actions, persistence, risks, sequencing | ✅ Analyzed, not implemented — 2026-08-24 |
| 2 | Foundational shared agent runtime — session/context/runtime modules, streaming LLM client (real + stub), `POST /api/agent/stream`, global-chat wiring | ✅ Implemented, live-verified — 2026-08-24 |
| 3 | Shared agent context and session model — `AgentContext` (dispute facts, evidence, workspace summary, investigation progress), unified into both runtimes, isolation-tested | ✅ Implemented, live-verified — 2026-08-24 |
| 4 | First real tool layer — Commas read tools wired into the shared agent's own tool-calling loop, reusing the existing adapter/registry architecture | ✅ Implemented, live-verified — 2026-08-24 |
| 5 | Agent-initiated application actions — propose → approve → execute → UI-updates for evidence and response drafts, ACTIVE/RESOLVED dispute gating | ✅ Implemented, live-verified — 2026-08-24 |
| 6 | Simulated Gmail/Calendar/Fathom/Zoom/GoHighLevel connectors with realistic data; reason-driven selective source prioritization replacing the fixed always-check-everything chain | ✅ Implemented, live-verified — 2026-08-24 |
| 7 | Same propose/approve action pipeline for the shared agent (global chat) once dispute chats move off the legacy transport; real OAuth connectors to replace this phase's simulated ones | ⏳ Next |

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

## Phase 3 — what was built

### The context model

`server/agent/context/model.ts` (new) defines `AgentContext` — the one type both runtimes now build their system prompt from, capable of representing every field the task asked for:

| Requirement | Field | Source |
|---|---|---|
| Conversation id / type | `conversationId`, `conversationType` | session id, `SessionConfig.mode` |
| Active dispute / customer / transaction id | `dispute.{disputeId, customerId, transactionId}` | `PageContext.dispute` (customer**Id** = customer**Email** — this prototype has no separate id scheme, see model.ts's doc comment) |
| Dispute reason / status | `dispute.{reason, status}` | `PageContext.dispute` (`status` is new this phase — the dispute's lifecycle status, distinct from the pre-existing `evidenceStatus`) |
| Connected sources | `connectedSources` | `chat.enabledSources` |
| Gathered evidence | `dispute.evidenceSummary` | `App.tsx`'s `evidenceByDispute`, summarized by checklist category — new this phase (baseline noted the agent couldn't see this at all before) |
| Investigation progress | `investigation: {status, turnsCompleted}` | the shared agent's own session, incremented only after a turn completes |
| Pending/recommended actions | `pendingActions` | typed `never[]` — always empty; the propose/approve pipeline (§7) doesn't exist yet, so this documents the slot without inventing a shape ahead of it |
| GLOBAL's "broad workspace context" | `workspace.disputesNeedingAttention` | `src/lib/disputeData.ts`'s new `disputesNeedingAttention()` — the same `DISPUTES` the Resolution Center list already renders from, not a separate dataset |

`buildContextPrompt(context)` (`server/agent/context/buildContext.ts`, rewritten) renders this into prose — the *only* place GLOBAL vs. DISPUTE, and which dispute, changes the model's system prompt. It's tool-availability-agnostic on purpose: the shared agent (no tools yet) appends its own "you don't have live investigation tools" caveat itself; the legacy runtime (real tools) doesn't.

### One context model, two runtimes — not two backends

`agentContextFromPageContext(conversationId, PageContext)` (also in `context/model.ts`) adapts the legacy runtime's own per-request `PageContext` into the identical `AgentContext` shape. `server/agent/runtime.ts`'s `buildSystemPrompt` was refactored to call this + `buildContextPrompt` instead of its own inline prompt string — the concrete change that makes "one shared agent architecture with scoped context, not two separate agent backends" true at the context layer for **both** runtimes, not just the one already using the shared session store. The legacy runtime's real tool-calling loop and write-approval pause are completely untouched — this was a pure-function swap only, verified by the full existing `runtime.test.ts`/`disputeIntents.test.ts` suite passing unmodified.

### Session-level state

`SessionRecord` (`server/agent/sessions/store.ts`) now carries its own `context: AgentContext`, replaced wholesale (never merged) every turn by `runSharedAgent` from that turn's fresh facts — so a dispute whose evidence changed, or a session that's never seen dispute facts at all, can never hold stale ones. `SessionStore.updateContext()` is the only mutator. Investigation progress (`turnsCompleted`) is the one field that's genuinely session-memory rather than resent-per-request: it advances only after a turn actually completes.

### Isolation — the critical requirement

Enforced structurally, not just by convention: `SessionStore.resolve()`'s pre-existing scope-mismatch guard (Phase 2) discards and rebuilds the **entire** `SessionRecord`, context included, whenever a session id's stored config disagrees with the request — so a chat id reused from dispute #2481 to #2390, or from a dispute back to global, always gets a bare fresh context, never the old one's facts. In the real app this is normally moot (App.tsx gives each dispute its own chat id), but the guard is what protects the edge case, and it's now proven for the context field specifically, not just the transcript:
- `tests/server/sharedAgent.test.ts` — "context isolation" describe block: two live dispute sessions (`#2481`/`#2390`) sharing one `SessionStore` never answer with each other's facts; the same session id returning to global mode never inherits the dispute it just left, exercised end-to-end through `runSharedAgent` + `StubStreamClient`, not just asserted on data structures.
- The two pre-existing "discards a session whose stored config disagrees" tests were extended to assert `context.dispute` is reset, not just `transcript`.
- `tests/DisputeContext.test.tsx` (new) — `buildDisputeContext` never lets one dispute's evidence summary leak into another's, back-to-back calls.

**Live-verified in-browser**, both servers running, stub LLM (no `ANTHROPIC_API_KEY`):
1. Global chat, fresh: "Show me disputes that need attention" → correctly answered from the live workspace summary — all 4 open disputes with customer/amount/reason, Priya Nair's resolved #2390 correctly excluded. Proves the GLOBAL requirement end to end, not just in tests.
2. Dispute #2481 (Sarah Johnson), an existing chat: asked "What evidence do we have?" with **no dispute id mentioned** — correctly answered about #2481 specifically (the pre-existing legacy investigation flow, unaffected by the `buildSystemPrompt` refactor). Proves the "follow-ups work without repeating the dispute id" requirement live.
3. Same chat: "Investigate this dispute" and "mark the response ready" still produced the exact same real multi-source investigation and write/approval round trip as Phase 2's walkthrough — zero regression from the runtime.ts refactor.
4. Console: no errors.

### The stub client is now genuinely context-grounded

`StreamReplyArgs` (`server/llm/streaming/types.ts`) gained an optional `context: AgentContext` field, passed alongside `systemPrompt` — mirroring the legacy `LlmClient.nextStep()`'s own `context` parameter. `StubStreamClient` uses it to answer "disputes needing attention" (global) and "what evidence do we have" / "draft a response" (dispute) from the real structured facts instead of a fixed fallback string — this is what made live verification #1 above possible without a live model. `AnthropicStreamClient` ignores the field; a real model needs only the rendered prose.

### Files created

| File | Purpose |
|---|---|
| `server/agent/context/model.ts` | `AgentContext`/`DisputeFacts`/`WorkspaceDisputeSummary` types, `buildAgentContext()`, `agentContextFromPageContext()` |
| `tests/DisputeContext.test.tsx` | Frontend isolation coverage for `buildDisputeContext`/`disputesNeedingAttention` |

### Files modified

| File | Change |
|---|---|
| `server/agent/context/buildContext.ts` | Rewritten: takes `AgentContext` (not a `SessionRecord`), renders dispute facts/evidence/sources/investigation progress or the workspace summary; no longer tool-availability-specific |
| `server/agent/sessions/store.ts` | `SessionRecord.context: AgentContext`, `+ updateContext()` |
| `server/agent/runtime/sharedAgent.ts` | Builds a fresh `AgentContext` from `requestContext` each turn, stores it, renders the prompt from it, tracks `investigation.turnsCompleted`, appends its own no-tools caveat |
| `server/agent/runtime.ts` | `buildSystemPrompt` now calls `agentContextFromPageContext` + `buildContextPrompt` instead of its own inline prompt |
| `server/app.ts` | `SharedAgentStreamRequest` gains `enabledSources`/`dispute`/`workspace`, forwarded to `runSharedAgent` |
| `server/llm/streaming/types.ts` | `StreamReplyArgs.context: AgentContext` |
| `server/llm/streaming/stubStreamClient.ts` | Context-grounded replies for workspace/evidence/draft questions |
| `src/lib/types.ts`, `server/types.ts` | `DisputeContextDetail` gains `status`, `evidenceSummary` |
| `src/lib/mockData.ts` | `buildDisputeContext(disputeId, evidenceItems?)` — now computes `status`/`evidenceSummary` |
| `src/lib/disputeData.ts` | `+ disputesNeedingAttention()` |
| `src/App.tsx` | Both `buildDisputeContext` call sites now pass `evidenceByDispute[selectedDisputeId]` |
| `src/lib/agentApi.ts` | `StreamAgentMessageArgs` gains `enabledSources`/`dispute`/`workspace` |
| `src/hooks/useChatStore.tsx` | Global-mode `streamAgentMessage` call sends `enabledSources` + the live workspace summary |
| `tests/server/sharedAgent.test.ts`, `tests/ChatFlow.test.tsx`, `tests/server/runtime.test.ts` | Updated for the new `buildContextPrompt` signature/behavior and request shape; new context-isolation and investigation-progress tests |

### Verification performed

- `npx tsc -b` (project-reference build, not just `--noEmit`) — clean.
- `npm run lint` — clean.
- `npx vitest run` — **133/133 passing** (118 at Phase 2's commit; +15 this phase — new context-isolation, investigation-progress, and `buildDisputeContext` coverage, plus several existing tests extended in place for the new `buildContextPrompt` signature).
- `npm run build` — clean.
- Live in-browser walkthrough — see above.

## Phase 4 — what was built

### The tool-calling loop

`runSharedAgent` (`server/agent/runtime/sharedAgent.ts`, rewritten) is now a real loop, up to a 6-iteration step limit (matching `runtime.ts`'s `MAX_ITERATIONS`): resolve session → build context → **loop: LLM decides next step → tool call (executed via `adapters`/`registry`, same timeout/error-recovery as the legacy runtime) or final answer** → persist transcript → emit events. `server/app.ts` passes the SAME `adapters`/`registry` instances it already built once for the legacy runtime — nothing is duplicated or rebuilt.

### `StreamingLlmClient`, renamed to a real step primitive

`streamReply()` → `streamStep()` (`server/llm/streaming/types.ts`): takes `availableTools`/`toolHistory` (the same `LlmToolDef`/`ToolCallRecord` types `server/llm/types.ts` already defines for the legacy `LlmClient`) and returns one step at a time — `{type:"tool_call", ...}` or `{type:"final", text}` — exactly like `LlmClient.nextStep()`. This is what let the loop reuse `runtime.ts`'s control-flow shape structurally, not just conceptually. `AnthropicStreamClient.streamStep()` calls `client.messages.stream({tools, ...})` and inspects `stop_reason`, mirroring `AnthropicLlmClient.nextStep()`'s own message/tool-result construction almost line for line, just decided over a stream.

### One reasoning engine, not two

`StubStreamClient.streamStep()` no longer has its own scripted replies — it bridges into the SAME `StubLlmClient` (`server/llm/stubClient.ts`) the legacy runtime already uses (`pageContextFromAgentContext`, the reverse of Phase 3's `agentContextFromPageContext`, does the shape conversion), then chunks the resulting final text for streaming. This is the "one shared reasoning engine" principle — already applied to the context model in Phase 3 — now applied to the LLM layer too, instead of maintaining a second ~600-line scripted reasoning engine in parallel.

`StubLlmClient` itself gained one genuinely new capability, additive and gated to `context?.kind !== "dispute"` (so every existing dispute-context-chat test and behavior is untouched): resolving which dispute a GLOBAL chat is talking about from the message text (`#2481`, or a bare `2481`) or, for a follow-up with no id restated, the most recent dispute mentioned earlier in the conversation (`findRecentDisputeId`, the same idiom the file already used for `findRecentEmail`). This is what makes the task's exact test flow work from global chat.

### Tool scope for this phase

`server/agent/tools/index.ts` (filled in from its Phase 2 placeholder): `sharedAgentToolsFor(enabledSources, registry)` returns only registry entries where `sourceId` is in `SHARED_AGENT_TOOL_SOURCES` (currently `["commas"]`), the tool's own classification is `"read"`, and the source is enabled for that specific chat. Concretely, the shared agent can call: `commas_get_dispute`, `commas_list_disputes`, `fanbasis_list_customers`, `fanbasis_list_transactions`, `fanbasis_get_transaction` — the exact data already exposed by the existing Commas mock (`server/mcp/mockCommasServer.ts`), inspected before writing anything new; no tool was invented for data that doesn't exist (evidence/product-info/policies/access-records are either already embedded in `commas_get_dispute`'s response or have no real structured backing in this prototype — see Known limitations). `commas_mark_dispute_response_ready` (the one write tool on this source) and every non-Commas source stay excluded — enforced by a dedicated test suite (`tests/server/tools.test.ts`) that constructs all 6 real adapters and proves the scoping holds even when every source is "enabled."

### Verified: structured data, not hallucination; graceful "I don't have that"

- "Tell me about dispute #2481." → a real `commas_get_dispute` call, answered from its result.
- An unknown/nonexistent dispute id → "I couldn't find dispute #9999 — Dispute not found: 9999.", never a fabricated case.
- No sources enabled for a chat → "No sources are enabled for this chat — enable at least one in the sources menu and ask again.", never silently answering anyway.
- Two different dispute-focused conversations (or two dispute ids named back-to-back in the same global chat) never mix up which dispute is in focus — covered both as a session-isolation property (Phase 3) and now as an LLM-reasoning-layer property specific to the new dispute-focus resolution.

**Live-verified in-browser**, both servers running, stub LLM: the full 4-question flow from a single fresh GLOBAL chat —
1. "Tell me about dispute #2481." → "**Dispute #2481** — product not received, $499, evidence due August 23."
2. "Why was it disputed?" (no id) → the real `likelyReason` text ("Sarah engaged heavily with the product... 14 logins and 6 of 12 lessons completed...").
3. "What evidence do we currently have?" → "Before responding, you're missing: Access & activity records, Customer communications, Transaction & payment details."
4. "Has this customer purchased from us before?" → "Found 1 transaction totaling $499.00."

Then, separately, the Resolution Center: opened Dispute #2502 (Marcus Webb, a different demo case), "Investigate with AI" → "Investigate this dispute" → the exact same real multi-source investigation as always ("Fathom: no recorded calls with Marcus", "Zoom: no meetings attended by Marcus", matching this case's authored "missing_evidence" scenario) — zero regression from the `stubClient.ts`/`runtime.ts` changes, since the new logic is entirely gated behind `context?.kind !== "dispute"`. Console: no errors.

### Files created

| File | Purpose |
|---|---|
| `tests/server/tools.test.ts` | `sharedAgentToolsFor` scoping: Commas-only, read-only, respects per-chat enabled sources |

### Files modified

| File | Change |
|---|---|
| `server/agent/tools/index.ts` | Filled in from the Phase 2 placeholder: `sharedAgentToolsFor()`, `SHARED_AGENT_TOOL_SOURCES` |
| `server/agent/runtime/sharedAgent.ts` | Rewritten: real tool-calling loop (adapters/registry, step limit, per-tool timeout/error recovery) replacing the single `streamReply` call |
| `server/llm/streaming/types.ts` | `streamReply(StreamReplyArgs)` → `streamStep(StreamStepArgs): Promise<StreamStepResult>` — tool-call-or-final, reusing `server/llm/types.ts`'s `LlmToolDef`/`ToolCallRecord` |
| `server/llm/streaming/anthropicStreamClient.ts` | Implements `streamStep()` via `messages.stream({tools})`, mirroring `AnthropicLlmClient.nextStep()` |
| `server/llm/streaming/stubStreamClient.ts` | Implements `streamStep()` by delegating to `StubLlmClient`, then chunking the final text |
| `server/llm/stubClient.ts` | + global-mode dispute-focus resolution (`findDisputeIdMentioned`/`findRecentDisputeId`/`describeDispute`) and a customer-purchase-history check, both additive and gated off dispute-context chats |
| `server/agent/context/model.ts` | `+ pageContextFromAgentContext()` — the reverse adapter, used only by the stub bridge |
| `server/app.ts` | `runSharedAgent` call now passes `adapters`/`registry` (already constructed once, reused, not duplicated) |
| `server/agent/README.md`, `server/agent/context/model.ts`'s doc comment | Updated — no longer describe the shared agent as conversation-only |
| `tests/server/sharedAgent.test.ts` | `streamReply` → `streamStep` throughout; new tests for the real tool loop, the 4-question flow, no-sources/no-data honesty; context-isolation tests rewritten to assert on real tool-grounded text instead of the old context-only reply |

No file under `src/` was touched this phase — the entire tool layer is server-side; the existing GLOBAL chat UI (already wired to `POST /api/agent/stream` since Phase 2) needed no changes to start receiving tool-grounded answers.

### Verification performed

- `npx tsc -b` — clean.
- `npm run lint` — clean.
- `npx vitest run` — **143/143 passing** (133 at Phase 3's commit; +10 this phase, including the full 4-question flow, tool-scoping tests, and rewritten isolation tests).
- `npm run build` — clean.
- Live in-browser walkthrough — see above.

## Phase 5 — what was built

### The propose → approve → execute → UI-updates pipeline

`server/agent/actions/index.ts` (filled in from its Phase 2 placeholder) defines two LLM-visible tools that never touch a `SourceAdapter` — they have no external source, only the seller's own case state:

| Tool | Covers (from the task's list) | Approving calls |
|---|---|---|
| `propose_add_evidence` | recommend evidence, prepare evidence for review, add proposed evidence to the case | `addEvidenceItem(disputeId, item)` — the same function the Resolution Center's manual "Add evidence" button already calls |
| `propose_draft_response` | draft a case response, update the response draft | `setResponseDraft(disputeId, text)` — the same state the "Your response" textarea already reads/writes |

"Open a dispute" and "focus/highlight relevant evidence" are the two listed action types **not** wired to a real execution this phase — see Known limitations for why, and what a proposal for them would need.

`buildProposedAction()` validates a tool call's raw input before turning it into a `ProposedAction` — a malformed call (missing fields) becomes `undefined`, fed back to the LLM as a tool error, never a half-formed proposal. `server/agent/runtime.ts`'s loop recognizes these tool names (`PROPOSE_ACTION_TOOL_NAMES`) and intercepts them before the normal adapter-dispatch path: no adapter call, no write-approval pause — the runtime just records the proposal and feeds back a synthetic "noted" result so the LLM's own turn continues normally to a final answer. `MAX_ITERATIONS` moved 6 → 8 to fit the extra step onto the existing 5-tool investigation chain without truncating (a real regression two existing tests caught immediately).

### ACTIVE vs RESOLVED — enforced before the LLM ever sees the tools

`availableToolsFor` (`server/agent/runtime.ts`) only appends the two propose-tools when `context.dispute?.status === "Needs response"` — a resolved dispute's chat never has them in its tool list at all, so there's no "the model tried to propose something and got refused" path to get wrong; the capability simply doesn't exist for that turn. `ProposedActionCard.tsx` adds a second, independent check (looking up the dispute's live status itself) as defense in depth, rendering a plain non-actionable note instead of approve/decline controls if a proposal ever somehow targeted a resolved dispute.

### One case-state store, not two

`evidenceByDispute`/`addEvidenceItem` moved from local state in `App.tsx` into `useChatStore` (mirroring the existing `markedReadyDisputeIds` pattern from Phase 2); the response draft (previously ephemeral `useState("")` inside `DisputeDetail`, never lifted, "Save draft" was cosmetic) moved there too as new `responseDraftByDispute`/`setResponseDraft` state. `App.tsx` and `DisputeDetail.tsx` now read/write through `useChatStore()` instead of local state, with their own external props/behavior otherwise unchanged — the Resolution Center is still the only UI that *renders* this state, the chat only ever proposes changes to it through the same functions the manual UI already used. `resetDemo()` now genuinely resets evidence and drafts too (previously required a page reload as a workaround, noted honestly in Phase 2 — now fixed as a natural consequence of this move, not separately scoped work).

### Grounded, never fabricated evidence recommendations

`buildEvidenceProposal` (`server/llm/stubClient.ts`) only proposes what's backed by an actual tool result this turn: a Fathom-sourced candidate only if `fathom_search_calls` actually found a call; a Gmail-communications candidate only if `gmail_search_threads` was actually checked this turn (an early version cited "Gmail" using the dispute record's own `communicationsSummary` field regardless of whether Gmail was connected for the chat — caught and fixed before committing, since the dispute record carries that field either way but citing an unchecked source as the origin would misattribute it). A dispute with no evidence gaps, or gaps with no real grounding available, gets no proposal at all — never a generic template.

### Verified: real state changes, not chat-local ones

- `tests/server/actions.test.ts` (new) — `buildProposedAction` validation; `runAgentTurn` end to end for both tools on an active dispute (evidence proposal cites the real 42-minute Fathom call; draft proposal's text is never duplicated into the chat's own final answer); a resolved dispute gets zero proposals for either "investigate" or "draft a response"; a context-less run gets none either.
- `tests/ProposedActions.test.tsx` (new) — the full frontend flow through a real dispute-context chat + mocked `/api/agent/run` response: approving adds every checked item to `useChatStore`'s `evidenceByDispute` (read directly, not inferred from re-rendered UI); unchecking one item before approving adds only what's still checked, with the confirmation count matching exactly (`approvedCount`, stored on the action itself — the checkbox selection is per-mount local UI state and would silently reset to "all checked" on a later remount, a real bug caught while writing this test, fixed before committing); declining adds nothing; approving a draft sets `responseDraftByDispute`; a proposal manually targeting an already-resolved dispute id renders non-actionable.

**Live-verified in-browser**, both servers running, stub LLM, a fresh dispute (Sarah Johnson, #2481, 0 of 6 evidence items):
1. "Investigate with AI" → "Help me resolve this dispute" → the usual investigation text, plus a **Recommended evidence** card: "I found a Fathom call that appears relevant." with one checked item (title, category, why). Clicked **Add selected (1)** → the Resolution Center's own Evidence checklist immediately showed **"1 of 6 items added"**, "Access & activity records" marked **Added**, the exact Fathom-call item rendered under it — the real page, not a chat-local echo.
2. Same chat: "draft a response for me" → a **Proposed draft** card with the full draft text previewed. Clicked **Use this draft** → the Resolution Center's "Your response" textarea immediately contained that exact text.
3. Priya Nair's resolved dispute (#2390, "Won"): no "Investigate with AI" button, no Add/Add-another controls on the page at all (pre-existing, unaffected). Direct backend check with the same prompts: `proposedActions` is `undefined`, `draft a response for me` returns the authored "already resolved" text instead.
4. Console: no errors throughout.

*(One environment note, not a product bug: an early check of this flow against a chat created in an earlier phase — before `DisputeContextDetail` gained `status`/`evidenceSummary` — silently got no proposals, because that stale localStorage-persisted `chat.context` was missing the newer fields `availableToolsFor` gates on. A fresh chat (or "Reset all demo data") doesn't have this issue; there's no code path in the current app that creates a chat with an incomplete context.)*

### Files created

| File | Purpose |
|---|---|
| `server/agent/actions/index.ts` | `propose_add_evidence`/`propose_draft_response` tool defs, `buildProposedAction()` |
| `src/components/chat/ProposedActionCard.tsx` | Renders one proposal inline under the message that made it — approve/decline, resolved-state confirmation, resolved-dispute defense in depth |
| `tests/server/actions.test.ts` | `buildProposedAction` + `runAgentTurn` propose-tool coverage, active vs. resolved |
| `tests/ProposedActions.test.tsx` | Full frontend propose → approve → execute → UI-updates flow |

### Files modified

| File | Change |
|---|---|
| `server/agent/runtime.ts` | `availableToolsFor` appends propose-tools only for an active dispute; `runLoop` intercepts propose-tool calls before adapter dispatch; `MAX_ITERATIONS` 6 → 8 |
| `server/llm/stubClient.ts` | `disputeChainStep` proposes evidence (grounded in what was actually found) after the investigation chain; the "draft" intent proposes instead of returning text directly, when the tool is available |
| `server/types.ts`, `src/lib/types.ts` | `+ ProposedAction`/`ProposedEvidenceCandidate` types; `AgentRunResponse`/`ChatMessage`/`AgentRunPlan` gain `proposedActions?` |
| `src/hooks/useChatStore.tsx` | `evidenceByDispute`/`addEvidenceItem` moved in from `App.tsx`; `+ responseDraftByDispute`/`setResponseDraft`; `+ resolveProposedAction`; `applyPlan` attaches `proposedActions` to the new message; `resetDemo` resets the new state too |
| `src/App.tsx` | Sources `evidenceByDispute`/`addEvidenceItem` from `useChatStore()` instead of local `useState` — same props passed down, unchanged |
| `src/components/resolution/DisputeDetail.tsx` | Response draft reads/writes via `useChatStore()` instead of local `useState` |
| `src/components/chat/ChatMessageBubble.tsx`, `ChatMessageList.tsx` | Render `ProposedActionCard` per proposed action on a message; `chatId` threaded through |
| `src/components/chat/AddCreditsModal.tsx` | Comment fix only — `resetDemo` no longer needs the reload to cover evidence/drafts, though the reload itself stays (still clears transient local UI state) |

### Verification performed

- `npx tsc -b` — clean.
- `npm run lint` — clean.
- `npx vitest run` — **158/158 passing** (143 at Phase 4's commit; +15 this phase).
- `npm run build` — clean.
- Live in-browser walkthrough — see above.

## Phase 6 — what was built

### Realistic simulated connectors, same tool abstraction as Commas

`SourceAdapter` (`server/adapters/types.ts`) is the one abstraction every source implements — `{sourceId, kind, listTools(), callTool(name, args)}` — and Gmail/Calendar/GoHighLevel already went through it as API-style adapters, Fathom/Zoom as mock MCP servers. This phase didn't add a second abstraction for the new sources; it enriched the existing thin mocks with realistic, source-specific structured data, and taught the LLM stub which of them to actually call:

- **Gmail** (`server/adapters/gmailAdapter.ts`) — threads gain a `category` (`purchase_confirmation` | `support_request` | `refund_discussion`). Elena Cruz (#2417, duplicate charge) got a real thread matching her dispute's authored `communicationsSummary` — the summary already claimed a Gmail thread existed that the mock data never actually had; fixed as part of this phase rather than left as a latent inconsistency.
- **Google Calendar** (`server/adapters/calendarAdapter.ts`) — events gain `durationMinutes` (what was *booked*), including a new event for Marcus Webb's 1:1 Strategy Call (30 min booked).
- **Fathom** (`server/mcp/mockFathomServer.ts`) — calls gain `transcriptExcerpt` and a mock `recordingUrl`. Marcus Webb's call is deliberately ambiguous evidence: it happened (contradicting "never received the service") but ran only 14 of the 30 booked minutes, with a transcript excerpt showing it was cut short.
- **Zoom** (`server/mcp/mockZoomServer.ts`) — meetings gain `leftAt`, independently corroborating Fathom's duration finding (Marcus's Zoom meeting is also 14 minutes).
- **GoHighLevel** (`server/adapters/crmAdapter.ts`) — contacts gain `pipelineStage` and an `activityLog` (pipeline-stage changes, booked calls, notes) — the "pipeline/activity records" a real CRM exposes beyond a flat contact lookup. Not every customer has a record (Elena and David don't) — matched honestly to what a real business would actually have, not invented for coverage.

The UI's connected-apps surface (`src/components/chat/SourceIcon.tsx`, `src/lib/mockData.ts`) already had brand-recognizable icons and the correct "GoHighLevel" label (not a generic "CRM") from earlier phases — confirmed, not modified.

### Selective source prioritization, replacing "always check everything"

`server/llm/stubClient.ts`'s `disputeChainStep` used to walk a fixed `DISPUTE_CHAIN` — every dispute, regardless of reason, checked GoHighLevel → Gmail → Fathom → Zoom in the same order. `REASON_SOURCE_PRIORITY` now maps a Stripe-style dispute reason code to an ordered, intentionally partial list:

| Reason | Priority order | Rationale |
|---|---|---|
| `product_not_received` | Fathom, Zoom, Gmail | Access/activity + fulfillment evidence — did the customer actually engage? GoHighLevel's pipeline data isn't informative for "did they receive it." |
| `product_unacceptable` (Commas' service-style product, the 1:1 Strategy Call) | Calendar, Zoom, Fathom, Gmail | Whether the session happened and what it covered is exactly what these four can confirm. |
| `duplicate` | Gmail | A transaction-record question first; Gmail only to check whether the customer already self-reported it. |
| `fraudulent` | GoHighLevel | Account/transaction history — the real Stripe reason code, no demo dispute currently uses it, covered by a direct unit test instead. |

A reason code not in the table falls back to `DEFAULT_SOURCE_PRIORITY` (the old full chain) — a safe, exhaustive default, never a silent gap for an un-reasoned-about case. The explicit "search across my connected apps" path (`crossSourceStep`, triggered by phrases like "connected apps"/"across my") is unchanged and still exhaustive — that's a deliberate, explicit user request, not the automatic blanket search the task warns against.

The synthesis step (`synthesizeDisputeInvestigation`) now distinguishes two reasons a source is absent from the answer, each with its own wording, instead of one "missing" bucket keyed only on connection status:
- **not enabled for this chat** — the source is genuinely turned off; "Turn on in the sources menu for a fuller picture."
- **available but not prioritized** — the source is connected, but this dispute's reason code doesn't call for it; "available but not checked; lower priority for a '`<reason>`' investigation."

A Google Calendar findings block was added to the synthesis output (previously absent entirely, even though Calendar data existed since Phase 5-era work).

### Verified

- `tests/server/sourcePriority.test.ts` (new) — direct unit coverage of `sourcePriorityFor()` (now exported) for all four mapped reasons plus the unmapped-reason fallback, including the `fraudulent` mapping with no UI-visible dispute case.
- `tests/server/runtime.test.ts` — the existing "chains through every enabled source" test rewritten to assert the new selective behavior for #2481 (`{commas, gmail, fathom, zoom}`, `crm` no longer called); two new tests added: Marcus Webb's #2502 investigation (Calendar/Zoom/Fathom/Gmail checked, GoHighLevel deliberately skipped, both missing-information categories present) and Elena Cruz's #2417 investigation (`{commas, gmail}` only, per the `duplicate` priority). David Kim's existing P0-3 test (uncertainty narrative, "no email threads found") verified unaffected — Gmail deliberately stayed in `product_not_received`'s priority list specifically to preserve it.
- `npx tsc -b`, `npm run lint`, `npx vitest run` (**165/165 passing** — 158 at Phase 5's commit + 7 new: 2 in `runtime.test.ts`, 5 in the new `sourcePriority.test.ts`), `npm run build` — all clean.

**Live-verified in-browser**, both servers running, stub LLM:
1. Marcus Webb's #2502, fresh investigation with all 6 sources enabled: visible step-by-step progress — "Checking dispute record… Checking Google Calendar… Checking Zoom meeting history… Searching Fathom calls… Checking Gmail threads…" — GoHighLevel never appears in the progress list. Final answer's "What I found" reports Calendar (30 min booked), Zoom + Fathom (14 min actual, corroborating each other), Gmail (no threads); "Missing information" correctly labels GoHighLevel as "available but not checked; lower priority for a 'product unacceptable' investigation."
2. Sarah Johnson's #2481, fresh session, only Commas/Calendar/Zoom/Fathom enabled for the chat (Gmail/GoHighLevel not enabled): "What I found" reports only Fathom + Zoom (Gmail skipped because unavailable, not because it wasn't prioritized); "Missing information" correctly splits into "GoHighLevel, Gmail — not enabled for this chat" vs. "Google Calendar — available but not checked; lower priority for a 'product not received' investigation" — both categories rendering correctly in the same answer.
3. Connected-apps modal (`Manage connected apps`): all 5 non-Commas sources show distinct, recognizable brand icons and correct product names, including "GoHighLevel" (never a generic "CRM").
4. Console: no errors in either run.

### Files modified

| File | Change |
|---|---|
| `server/adapters/gmailAdapter.ts` | `+ category` on threads; new thread for Elena Cruz matching her authored narrative |
| `server/adapters/calendarAdapter.ts` | `+ durationMinutes` on events; new event for Marcus Webb |
| `server/mcp/mockFathomServer.ts` | `+ transcriptExcerpt`, `+ recordingUrl`; new ambiguous-evidence call for Marcus Webb |
| `server/mcp/mockZoomServer.ts` | `+ leftAt`; new meeting for Marcus Webb corroborating Fathom |
| `server/adapters/crmAdapter.ts` | `+ pipelineStage`, `+ activityLog`; new contacts for Marcus Webb and Priya Nair |
| `server/llm/stubClient.ts` | `DISPUTE_CHAIN` replaced by `REASON_SOURCE_PRIORITY`/`DEFAULT_SOURCE_PRIORITY`/`sourcePriorityFor()` (exported); `disputeChainStep` rewritten to prioritize by reason code instead of a fixed order; `synthesizeDisputeInvestigation` gains a Calendar findings block and two-category missing-information logic |
| `tests/server/runtime.test.ts` | Multi-source test updated for selective behavior; new Marcus Webb / Elena Cruz investigation tests |
| `tests/server/sourcePriority.test.ts` | New — direct `sourcePriorityFor()` unit coverage |

## Known limitations (honest, not hidden)

- **No device/IP or geographic-consistency data exists for the `fraudulent` priority profile.** The task names these alongside account/transaction history as fraud-relevant evidence; account/transaction history is real (GoHighLevel's `pipelineStage`/`activityLog`, Commas' own transaction record), but no connector in this prototype exposes device, IP, or geographic data, and none was fabricated to fill out the category — `sourcePriorityFor("fraudulent")` only prioritizes `crm_get_contact`, and there's no UI-visible dispute case using this reason code (covered by a direct unit test instead, `tests/server/sourcePriority.test.ts`).
- **`buildEvidenceProposal` can still cite a source's `communicationsSummary` even when that source found nothing this turn** (pre-existing, not introduced or fixed this phase) — e.g. investigating Marcus Webb (#2502) proposes a "Customer correspondence" evidence candidate sourced from Gmail even though `gmail_search_threads` returned zero threads, because the gate is "was Gmail checked," not "did Gmail find anything." His dispute's `communicationsSummary` field is itself authored around the *absence* of email (informative to cite, but not as "correspondence"). Left alone this phase — `buildEvidenceProposal` wasn't in scope, and reworking its grounding logic risks regressing the evidence-recommendation tests from Phase 5.
- **"Open a dispute" and "focus/highlight relevant evidence" have no real execution.** Both are in the Phase 5 task's list of potential actions; the two actually wired (add evidence, draft response) are the ones the given examples demonstrate and the ones with an unambiguous, already-existing state to mutate. "Open a dispute" is a GLOBAL-chat action (navigating *to* a dispute) but GLOBAL chat runs on the shared agent, not the legacy runtime the propose-tools live on — wiring it would mean either adding propose-tools to the shared agent too (its own open item, see Phase 7 below) or a separate mechanism. "Focus/highlight evidence" has no existing highlight/scroll-to affordance in `DisputeDetail` to hook into without a UI change, which was out of scope.
- **The propose/approve pipeline exists only in the legacy runtime.** Dispute chats still don't route through the shared agent's streaming endpoint (unchanged from Phase 4) — a deliberate, repeatedly-reaffirmed risk decision, not an oversight. `pendingActions` (the shared context model's placeholder field) is still always `[]`.
- **`commas_mark_dispute_response_ready` is unaffected** — it's a genuinely different kind of action (marks the dispute record itself ready via a real, if simulated, "write" tool call) and keeps using the pre-existing `pendingApproval` blocking-pause mechanism, not the new non-blocking `ProposedAction` one. Two related-but-distinct approval mechanisms now coexist in the legacy runtime for two different reasons (one pauses an in-progress tool loop; one attaches a reviewable card to a completed turn) — not consolidated into one this phase.
- **Commas only, no OAuth connectors, no wider tool set for the shared agent** (unchanged from Phase 4).
- **Session memory is still in-process only** (unchanged from Phase 2).
- **`server/types.ts` / `src/lib/types.ts`** still hand-mirrored, not unified into a `shared/` module (architecture §10).

## Implementation sequence (from architecture §11)

1. ~~Live model on the existing loop (no UI change)~~ — **done in Phase 2**.
2. One dataset + wider Commas/connector tools with citations — **Commas read tools done in Phase 4**; Gmail/Calendar/Fathom/Zoom/GoHighLevel now realistic *simulated* connectors with reason-driven selective calling (**Phase 6**); real OAuth-backed connectors still open
3. ~~Server-side sessions + context envelope + context block~~ — **done in Phase 3**.
4. Streaming SSE transport consumed by `useChatStore` — **done in Phase 2**.
5. Dispute-mode investigation prompt (loop, stopping criteria, report format) — the tool-calling loop (Phase 4), grounded evidence recommendation (Phase 5), and reason-driven source selection (Phase 6) are the mechanism; a dedicated investigation *prompt/strategy* refinement on top is still open
6. ~~Resolution Center persistence + proposal/approval actions (`ProposalCard`, executors)~~ — **done in Phase 5**: `ProposedActionCard` is that component, `resolveProposedAction` is the executor, evidence/draft state is real and shared with the Resolution Center
7. Global-mode polish, hardening, docs, regression suite — still open; the same propose/approve pipeline for the shared agent (global chat) is the natural next piece

## Notes

- `docs/active-context.md` is the accurate history of how `main` got here; `docs/ARCHITECTURE.md` / `IMPLEMENTATION_PLAN.md` describe parts that were never built (SSE, backend store, metered credits) — this phase is the first place a *real* SSE stream exists in this repo, on the new route only. See baseline §13–§15 for the reconciled list.
- The sibling `../commas-ai-copilot` repo (and its `experiment/copilotkit-poc` branch) is reference material only — nothing is imported across repos; patterns (scope guard, session model) were reimplemented from scratch against this repo's own types and conventions.
