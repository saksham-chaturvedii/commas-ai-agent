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

**4 — First real tool layer (implemented, live-verified)**

The shared agent's loop is now a real tool-calling loop, not conversation-only: `StreamingLlmClient.streamStep()` (renamed from `streamReply`) can request a tool call, `runSharedAgent` executes it via the SAME `SourceAdapter`/registry the legacy runtime already uses, feeds the result back, and repeats up to a step limit — structurally the same loop as `server/agent/runtime.ts`'s `runLoop`. Scope for this phase, explicit and temporary (`server/agent/tools/index.ts`'s `SHARED_AGENT_TOOL_SOURCES`): Commas's 5 read tools only — no OAuth connectors, no write tool. The exact 4-question test flow from the task ("Tell me about dispute #2481." → "Why was it disputed?" → "What evidence do we currently have?" → "Has this customer purchased from us before?") passes both in tests and live in-browser, entirely from GLOBAL chat, entirely tool-grounded, with the dispute recalled across turns from conversation history rather than repeated by the user.

## Phase log

| Phase | Description | Status |
|---|---|---|
| 0 | Baseline documentation (`AI_ASSISTANT_BASELINE.md`, this file) | ✅ Complete — 2026-08-24 |
| 1 | Architecture definition (`AI_ASSISTANT_ARCHITECTURE.md`) — one shared agent, two modes; stack, session/context, tools, actions, persistence, risks, sequencing | ✅ Analyzed, not implemented — 2026-08-24 |
| 2 | Foundational shared agent runtime — session/context/runtime modules, streaming LLM client (real + stub), `POST /api/agent/stream`, global-chat wiring | ✅ Implemented, live-verified — 2026-08-24 |
| 3 | Shared agent context and session model — `AgentContext` (dispute facts, evidence, workspace summary, investigation progress), unified into both runtimes, isolation-tested | ✅ Implemented, live-verified — 2026-08-24 |
| 4 | First real tool layer — Commas read tools wired into the shared agent's own tool-calling loop, reusing the existing adapter/registry architecture | ✅ Implemented, live-verified — 2026-08-24 |
| 5 | Write actions / propose-approve pipeline for the shared agent; wider (non-Commas) source tools once OAuth connectors exist | ⏳ Next |

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

## Known limitations (honest, not hidden)

- **Dispute chats still don't route through the shared agent's streaming endpoint.** They keep the legacy `/api/agent/run` path (the full 6-source tool set, write-approval) entirely unchanged — deliberate: bringing dispute chats onto SSE would need a write-approval story SSE doesn't have yet (see next point). The shared agent's own dispute-mode tool-calling is real and tested, just not yet the frontend's actual dispute-chat transport.
- **No write tool, no approval flow, for the shared agent.** `commas_mark_dispute_response_ready` is excluded from `sharedAgentToolsFor` entirely — pausing an SSE stream mid-flight for approval has no established pattern in this codebase yet (the legacy runtime's `pendingApproval` is a JSON round-trip). `pendingActions` (the context model's placeholder) is still always `[]`.
- **Commas only — no Fathom/Zoom/Gmail/Calendar/GoHighLevel tools for the shared agent yet**, by explicit instruction this phase ("do not implement OAuth connectors yet"). Their adapters and registry entries already exist unchanged; widening `SHARED_AGENT_TOOL_SOURCES` is the entire change needed later.
- **No separate "product information," "policies," or "access/activity records" tools.** Inspected the actual data model before building anything: none of these exist as queryable structured data in this prototype (evidence categories are UI checklist labels; access-activity detail like "14 logins" is narrative prose inside `likelyReason`, not a field) — only `commas_get_dispute`/`commas_list_disputes`/customer/transaction tools have real structured data behind them, so only those were wired up.
- **Session memory is still in-process only** (unchanged from Phase 2 — no `data/state.json` persistence for either runtime).
- **`server/types.ts` / `src/lib/types.ts`** still hand-mirrored, not unified into a `shared/` module (architecture §10).

## Implementation sequence (from architecture §11)

1. ~~Live model on the existing loop (no UI change)~~ — **done in Phase 2**, plus streaming + sessions pulled forward from §11's phases 3–4.
2. One dataset + wider Commas/connector tools with citations — **Commas tools done this phase**; connector (Fathom/Zoom/Gmail/Calendar/GoHighLevel) tools for the shared agent still open, blocked on their OAuth story per this phase's own instruction
3. ~~Server-side sessions + context envelope + context block~~ — **done in Phase 3**: `AgentContext` is the envelope, shared by both runtimes, isolation-tested
4. Streaming SSE transport consumed by `useChatStore` — **done in Phase 2**
5. Dispute-mode investigation prompt (loop, stopping criteria, report format) — the shared agent's tool-calling loop (this phase) is the mechanism; a dedicated investigation *prompt/strategy* on top of it is still open
6. Resolution Center persistence + proposal/approval actions (`ProposalCard`, executors) — `pendingActions`'s slot exists in the context model, unpopulated; needs the write-approval-over-SSE story above first
7. Global-mode polish, hardening, docs, regression suite

## Notes

- `docs/active-context.md` is the accurate history of how `main` got here; `docs/ARCHITECTURE.md` / `IMPLEMENTATION_PLAN.md` describe parts that were never built (SSE, backend store, metered credits) — this phase is the first place a *real* SSE stream exists in this repo, on the new route only. See baseline §13–§15 for the reconciled list.
- The sibling `../commas-ai-copilot` repo (and its `experiment/copilotkit-poc` branch) is reference material only — nothing is imported across repos; patterns (scope guard, session model) were reimplemented from scratch against this repo's own types and conventions.
