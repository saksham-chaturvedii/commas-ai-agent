# AI Assistant Architecture — one shared agent, two contextual modes

**Branch:** `experiment/unified-ai-assistant` · **Date:** 2026-08-24 · **Status:** analyzed, not implemented
**Baseline:** [`AI_ASSISTANT_BASELINE.md`](./AI_ASSISTANT_BASELINE.md) (read first — this document assumes it)
**Reference:** `../commas-ai-copilot` branch `experiment/copilotkit-poc` (a validated POC of the same question on a different codebase; patterns are reused here, packages are not)

## The question

> Can the existing Commas AI Agent prototype support **one shared AI assistant** that works in both global AI chat and Resolution Center dispute investigation, without creating two separate agent systems?

**Answer: yes — and it already has the right shape.** Global chat and dispute chat are one store, one conversation component, one HTTP route and one runtime today; "dispute" is a data field on the chat, not a second code path. The assistant does not need a new surface or a new agent system. What it needs is real reasoning behind the existing `LlmClient` seam, a server-side session so context persists, a streamed event channel so the UI can show real work, a wider tool layer over one dataset, and a proposal → approval → execute channel back into the Resolution Center. Every one of those lands behind boundaries that already exist, and the polished UI stays.

---

## 1. Current architecture — inspection findings

The baseline document describes the system; this section answers the specific questions the phase asked, with file references.

| Question | Finding |
|---|---|
| **Where does global chat get its responses?** | `useChatStore.sendMessage()` → `src/lib/agentApi.ts` → `POST /api/agent/run` → `server/app.ts` → `runAgentTurn()` in `server/agent/runtime.ts` → `LlmClient.nextStep()` → adapters → final `answer`. Same route and same loop for every chat, global or dispute. |
| **Are responses mocked or hardcoded?** | **The pipeline is real; the reasoning is scripted.** Tool calls, MCP protocol, adapters, error handling and the approval pause all execute for real. The "LLM" is `server/llm/stubClient.ts`, a deterministic keyword router with authored answers, because no `ANTHROPIC_API_KEY` has ever been present. `AnthropicLlmClient` is real code that has never run. The two `SEED_CHATS` are hand-written transcripts, not backend output. |
| **How are conversations stored?** | Browser only: `useChatStore` keeps `chats[]` in React Context and mirrors `{chats, sources, credits}` to `localStorage["commas-ai-agent:v2"]`. The server stores nothing between requests. |
| **How is chat history scoped?** | By the `Chat.context` field. `createChat(context?)` dedupes on `(context.kind, context.id)` so each dispute has at most one *empty* chat; `ChatHistoryList` hides context chats unless active; `App.openPanel()` finds-or-creates the chat for the current page context and closes the panel on any navigation. Memory sent to the model is the last 20 message texts of that chat (`historyFor()`), re-capped server-side (`HISTORY_TURN_LIMIT = 20`). Tool results from earlier turns are not remembered. |
| **How is the active dispute represented?** | Three places: `App.selectedDisputeId` (UI), `PageContext { kind:"dispute", id, label, dispute: DisputeContextDetail }` built by `buildDisputeContext(id)` from `src/lib/disputeData.ts` and stored on the chat, and the server's own `DISPUTES` record in `server/mcp/mockCommasServer.ts` fetched by `commas_get_dispute`. `buildSystemPrompt(context)` inlines `context.dispute`'s facts into the system prompt. |
| **How does the Resolution Center open AI investigation?** | `DisputeDetail` "Investigate with AI" (`btn-blue`, hidden when resolved) → `onInvestigate` → `App.openPanel(buildDisputeContext(selectedDisputeId))` → `RightPanel` renders the dispute's chat with `DisputeSummaryHeader` + 7 `DISPUTE_SUGGESTED_CAPABILITIES` chips. The floating button on the detail page does the same. |
| **What existing UI actions should become agent actions?** | `onAddEvidence(item)` (App → `evidenceByDispute`), the response-draft textarea (`DisputeDetail` local `response` state + "Save draft"), the mark-ready flag (`markedReadyDisputeIds`, already a gated write tool). Optional later: a case-summary card (new), navigation to a dispute from global chat. `verify`/submit must never become agent actions (Submit stays disabled/manual). |
| **What data already exists that can become tools?** | Server: 5 disputes with authored reasoning fields, 5 customers, 5 transactions, `MONTH_SUMMARY`, Sarah-only Fathom/Zoom/Calendar/Gmail/GoHighLevel fixtures — 11 tools registered. Frontend-only (invisible to the agent today): `evidenceCategories`, seeded and session-added `AIEvidenceItem`s, `initialEvidenceAdded`, the draft text, Dashboard figures. |
| **Where should context live?** | Split by volatility: *frontend-owned identity* (which chat/scope, which dispute, evidence inventory, connector availability) travels per request as a small typed envelope; *conversation and tool-derived state* lives server-side in a session keyed by the chat; *reasoning* is ephemeral within a run. Never the whole dataset in a prompt. |
| **Can CopilotKit be introduced without disrupting the UI?** | Technically yes (headless `useAgent`, as the copilot POC did) — but it would replace `useChatStore`'s transport with a second message/run store, pin a pre-release with known streaming/threadId/context bugs, and add ~5× bundle. It provides nothing this UI lacks. **Not recommended** (§9, §10). |
| **How should the POC architecture be reused?** | As **patterns and code to port**, not packages: scope-keyed sessions with a leakage guard, the context envelope + delta context block, the five-stage proposal model with consequence tiers, the investigation-loop prompt with stopping criteria and report format, citation metadata on source results, robustness rules. See §11 for the file-by-file mapping. |

Reference layering of the current code against the target layering:

```
USER INTERFACE        src/components/chat/*, resolution/*, App.tsx, useChatStore.tsx (also owns transport + run state)
AGENT ORCHESTRATION   server/agent/runtime.ts (loop, approval pause, error mapping), registry.ts
LLM REASONING         server/llm/anthropicClient.ts (unexercised) | stubClient.ts (what runs)
TOOL EXECUTION        server/adapters/* → server/mcp/* mock servers + inline fixtures
APPLICATION STATE     browser: chats/credits/sources (localStorage), evidence + draft (React memory); server: none
```

The layers exist; the deficits are inside them (scripted reasoning, no server state, no streaming, one-way RC), not between them.

---

## 2. Target architecture

```
┌────────────────────────────── USER INTERFACE (unchanged components) ──────────────────────────────┐
│ ChatPage · RightPanel · ChatWorkspace · EmptyState · ChatComposer · ProgressBlock · ApprovalCard   │
│ DisputeDetail (+ new ProposalCard in Commas tokens) · ResolutionCenter · Dashboard · shell        │
│                                                                                                    │
│ useChatStore  ──▶ agentApi.streamRun()   context envelope { scope, page, dispute?, evidence, sources }
│      ▲                     │                                                                       │
│      │ events              ▼ POST /api/agent/runs  (SSE response)                                 │
└──────┼─────────────────────┼───────────────────────────────────────────────────────────────────────┘
       │                     │
┌──────┼─────────────────────▼──────────────── AGENT ORCHESTRATION (server/agent) ──────────────────┐
│ EventSink (run.started · status · tool.started/completed · message.delta · approval.required ·    │
│            proposal.created · run.completed/cancelled/error)                                        │
│ SessionStore (keyed by chatId; scope guard; full model transcript; investigation state)            │
│ ContextBlock (envelope → bounded prompt text; delta on resumed sessions)                            │
│ runLoop: nextStep → read tools execute · propose tools record · write tools pause                  │
│ ProposalStore (pending/approved/rejected, decisions fed back next turn)                             │
└──────┬─────────────────────────────────────────────────────────────────────────────────────────────┘
       │ LlmClient.nextStep({ system, transcript, tools, sink })
┌──────▼──────────────────── LLM REASONING (server/llm) ─────────────────────────────────────────────┐
│ AnthropicLlmClient — @anthropic-ai/sdk messages.stream(), claude-opus-5 (AGENT_MODEL env),         │
│   adaptive thinking, N tool_use blocks per response, text deltas → sink                            │
│ StubLlmClient — kept as the no-key fallback (same interface, same sink)                             │
└──────┬─────────────────────────────────────────────────────────────────────────────────────────────┘
       │ registry.dispatch(toolName, input) — scope-filtered tool set
┌──────▼──────────────────── TOOL EXECUTION (server/adapters, server/tools) ────────────────────────┐
│ commas (mcp, in-proc mock | real)   fathom · zoom (mcp mocks)   gmail · calendar · gohighlevel (api) │
│ actions (app: propose_evidence · propose_response_draft · update_response_draft · propose_case_summary)
│ all reading ONE dataset: server/data/world.ts (5 customers, every source, incl. empty + failing)    │
└──────┬─────────────────────────────────────────────────────────────────────────────────────────────┘
       │
┌──────▼──────────────────── APPLICATION STATE ──────────────────────────────────────────────────────┐
│ server: data/state.json { sessions, proposals }  (gitignored path that already exists in .gitignore)│
│ browser: localStorage v3 { chats (rendered transcript), sources, credits, rcState: evidence+drafts } │
│ mutation of RC state happens ONLY in the browser, from a human click (executors in src/)           │
└────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

**Design principles**

1. **One runtime, one route family, one store.** Mode is derived from the request's scope, never from a code path. There is no `DisputeAgent` class and no separate dispute chat store.
2. **Preserve the UI by feeding it, not replacing it.** Every new server capability maps onto an existing UI primitive: streamed steps → `ProgressBlock`, streamed text → `ChatMessageBubble`, write pause → `ApprovalCard`, proposals → a new `ProposalCard` styled like `ApprovalCard`/`content-card` and rendered inside `DisputeDetail` next to the evidence it would join.
3. **Additive transport.** The existing JSON `POST /api/agent/run` keeps working (it collects the same events into today's `AgentRunResponse`), so all 94 tests and the stub path stay green while the streaming route is introduced.
4. **The model proposes; humans dispose; only the browser mutates.** Read tools run autonomously; `propose_*` tools only record; platform write tools pause for approval as today. No code path from a model token to RC state skips a click.
5. **Zero new runtime dependencies.** Everything required is already installed (`@anthropic-ai/sdk` 0.120 with `messages.stream`, Hono 4.13 with `streamSSE`, `@modelcontextprotocol/sdk`, `zod`).

---

## 3. Component boundaries

| Layer | Responsibility | Owns | Must not |
|---|---|---|---|
| **UI** (`src/components`, `src/pages`, `App.tsx`) | Render chats, progress, proposals; collect clicks; hold RC state | rendered transcript, `evidenceByDispute`, drafts, view/panel state | call the model, compute credits beyond the 1/message rule, contain tool logic |
| **Client store/transport** (`useChatStore.tsx`, `agentApi.ts`) | Build the context envelope, open the run stream, apply events to store, persist to localStorage, execute *approved* actions | run state (`runPhase`, `runSteps`, `pendingApproval`, `pendingProposals`) | reorder or fabricate events; decide approvals |
| **Orchestration** (`server/agent/*`) | Session resolution + scope guard, context block, loop control (caps, timeout, cancel), tool classification gate, event emission, proposal/decision bookkeeping | sessions, proposals, run lifecycle | know which LLM or which adapter kind is behind an interface; mutate RC state |
| **LLM** (`server/llm/*`) | Turn `{system, transcript, tools}` into `{tool calls | final text}` with streaming deltas | prompt-format details, SDK error mapping | execute tools; see secrets other than its own key; be aware of UI |
| **Tools** (`server/adapters/*`, `server/tools/*`, `server/data/*`) | Typed, schema-validated access to one dataset; honest empty results; explicit connector failures; citations | fixtures, adapter transports (mock MCP / real MCP / api) | reach into sessions or proposals; know about scopes (scope filtering is orchestration's job) |
| **Application state** | Durable truth for conversations (server) and RC artifacts (browser, persisted) | `data/state.json`, localStorage v3 | be written by the model |

Interfaces that change (all additive):

```ts
// server/llm/types.ts
interface LlmClient {
  nextStep(input: LlmStepInput & { sink?: EventSink; signal?: AbortSignal }): Promise<LlmStepResult>;
}
type LlmStepResult =
  | { type: "tool_calls"; calls: { toolCallId; toolName; input }[]; assistantText?: string } // N per response
  | { type: "final"; text: string };

// server/types.ts (mirrored in src/lib/types.ts, or moved to shared/ — see §10)
type ToolClassification = "read" | "propose" | "write";
interface AgentContextEnvelope { kind: "commas.agent-context/v1"; scope: ChatScope; page: PageRef;
  dispute?: DisputeContextDetail & { evidenceInventory: EvidenceRef[]; draftPresent: boolean; status };
  sources: { id: SourceId; status: "connected" | "not_connected" }[] }
type ChatScope = { kind: "global" } | { kind: "dispute"; disputeId: string };
```

---

## 4. Agent / session model

**Identity.** A session is keyed by the client's `chat.id` (already unique, already the unit of history in the UI). Each chat has exactly one immutable `scope` set at creation: `{kind:"global"}` for context-less and dashboard chats, `{kind:"dispute", disputeId}` for dispute chats. The server stores the scope with the session and **refuses to resume** a session whose stored scope differs from the request's — it starts fresh and logs a warning (the copilot POC's leakage guard, which caught a real cross-dispute leak there).

**Session record** (`server/agent/sessionStore.ts`, persisted to `data/state.json`):

```ts
interface AgentSession {
  chatId: string; scope: ChatScope;
  transcript: Anthropic.MessageParam[];      // full model-facing history incl. tool_use/tool_result — the real memory
  investigation: { status: "none"|"partial"|"complete"; providersConsulted: SourceId[]; toolsUsed: string[]; runCount: number; lastRunAt?: string; memoryLost?: boolean };
  decisionsReported: string[];               // proposal ids whose outcome has been told to the model
  updatedAt: string;
}
```

**Resolution per run:** `resolve(chatId, scope)` → `resumed` (transcript exists, scope matches) | `new` | `scope-mismatch` (fresh). If the client sends `history` but the server has no session (server restart before persistence lands, or a chat created on `main`'s localStorage), the transcript is bootstrapped from that text history and `memoryLost` is set so the context block tells the model its tool-level memory is gone. Once the session exists the client still sends `history` for backward compatibility but the server ignores it in favor of its transcript.

**Run lifecycle:** `running → awaiting_approval → running → completed | cancelled | error`; one active run per chat (the store already enforces one run globally). Caps: `MAX_ITERATIONS` raised from 6 to 12 in dispute scope (the spec's original number; an investigation is many sequential calls), 6 in global scope; per-tool 10 s (existing); new per-run wall clock (120 s global / 180 s dispute — the POC measured 1–2.5 min for a full 15-call investigation); cancellation checked at every loop boundary via the request's abort signal.

**Investigation state is derived, never asserted.** The loop records which tools actually ran; the client cannot claim an investigation happened. It feeds two things: the "Checked N sources" receipt (already rendered) and the next turn's context block.

**Transcript hygiene.** Tool results are stored compactly (the adapter's parsed JSON, size-capped); thinking blocks are never stored; the transcript is trimmed oldest-first past a token budget with the first user turn and last N turns pinned. This is the persistent-context mechanism that "history of 20 texts" cannot provide.

---

## 5. Global vs dispute context

Both modes run the same loop with the same registry; the differences are entirely in **what the envelope says, which tools are exposed, and which prompt section is active**.

| | GLOBAL MODE | DISPUTE MODE |
|---|---|---|
| Scope | `{kind:"global"}` (context-less chats, dashboard chats) | `{kind:"dispute", disputeId}` |
| Envelope carries | page (`dashboard` / `chat` / `resolution-center-list`), connector availability | + dispute identity/facts (existing `DisputeContextDetail`), dispute status, **evidence inventory** (id · title · category · addedBy — not bodies), whether a draft exists, connector availability |
| Tools exposed | all `read` tools of enabled sources; `write` tools (approval-gated) | same + `propose_*` action tools |
| Tools withheld | `propose_*` (no dispute to attach to — also enforced server-side, not just by omission) | none |
| System prompt | persona + workspace section ("you help with customers, transactions, disputes portfolio, connected apps; to act on a dispute, open it") | persona + investigation loop (steps, stopping criteria, source selection by dispute reason, report format) + action tiers |
| Suggestion chips | `SUGGESTED_CAPABILITIES` / `DASHBOARD_…` (unchanged) | `DISPUTE_SUGGESTED_CAPABILITIES` (unchanged) |
| Memory | this chat's session transcript | this dispute chat's session transcript (one dispute chat per dispute, as today) |
| Handoff | "open Dispute #2481 and I'll investigate" — rendered as a clickable chip that navigates; the agent never navigates the user itself | "Start new session" (existing) deletes the chat → server session deleted via `DELETE /api/agent/sessions/:chatId` |

**Context block rendering** (`server/agent/contextBlock.ts`, ported pattern): the envelope becomes a short `[Context]` block ahead of the user message. First turn of a session: full orientation (scope, dispute facts, evidence inventory, sources). Resumed turns: a delta only (evidence count changed, draft appeared, connector toggled, decisions on proposals). Global mode gets two lines. The block never contains records — the model fetches records with tools.

**What replaces `buildSystemPrompt`'s inlined dispute facts:** they stay (they are small and useful — "don't re-fetch what you know") but move into the context block so they are versioned with the envelope rather than embedded in the persona string.

**Evidence visibility (closing the biggest one-way gap):** the inventory in the envelope lets the model reason about what the seller already attached ("Access & activity records already on file — 1 item, added by you"). A `commas_get_dispute_evidence(disputeId)` tool returns the same inventory server-side so the stub and the tests can exercise it without the envelope; the browser remains the owner of the items.

---

## 6. Tool architecture

**Keep:** `SourceAdapter` (`listTools/callTool`, `kind: "mcp"|"api"`), registry discovery, `KNOWN_TOOLS` presentation metadata, fail-safe-to-`write` for unknown names, the `SourceId` set. **Add:** a third classification `"propose"`, a scope filter, one dataset, citations, and more tools.

**One dataset.** `server/data/world.ts` (+ `connectedSources.ts`) becomes the single server-side source for disputes, customers, transactions, products/policies, activity, and every connector's fixtures — *for all five customers*, with deliberate variety: Sarah (strong, corroborating), Marcus (thin), Elena (duplicate-charge, evidence-ready), David (inconclusive, empty external), Priya (resolved), plus one connector wired to fail at the connector level for one customer (e.g. Zoom `auth_expired` for David) so "couldn't check" is distinguishable from "checked, empty". `mockCommasServer.ts`, the Fathom/Zoom mock servers, and the api adapters all read from it. The frontend's `src/lib/disputeData.ts` stays as the UI's copy for now (hand-synced as today); serving the dispute list from the API is a later, optional step.

**Tool inventory (target).** Real-platform names keep the `fanbasis_` prefix; prototype-only tools keep `commas_`; connector tools are prefixed per provider.

| Source | Tools (read unless noted) |
|---|---|
| commas | `fanbasis_list_customers`, `fanbasis_get_customer` (new), `fanbasis_list_transactions`, `fanbasis_get_transaction`, `fanbasis_list_products` (new, incl. listing + policy), `commas_list_disputes`, `commas_get_dispute`, `commas_get_dispute_evidence` (new), `commas_get_customer_activity` (new: logins/lessons/access), `commas_mark_dispute_response_ready` (**write**) |
| gmail | `gmail_search_threads(customer_email, query?)`, `gmail_get_thread(thread_id)` (new) |
| google-calendar | `calendar_list_events(attendee_email, query?)` |
| fathom | `fathom_search_calls(attendee_email, query?)`, `fathom_get_call_summary(call_id)` (new) |
| zoom | `zoom_list_meetings(attendee_email, query?)`, `zoom_get_meeting_attendance(meeting_id)` (new) |
| crm (GoHighLevel) | `crm_get_contact(email)`, `crm_get_contact_notes(email)` (new), `crm_get_pipeline_history(email)` (new) |
| actions (new adapter, `kind: "app"`) | `propose_evidence`, `propose_response_draft`, `update_response_draft`, `propose_case_summary` — all **propose** |

**Result contract.** Every connector result carries `citation: { sourceType, sourceLabel, sourceAnchor }` matching `AIEvidenceItem`'s existing vocabulary, so a finding can become a proposed evidence item without reshaping. Empty results are `ok: true` with empty arrays; connector failures are `isError: true` with a human message; ids not found are `isError: true` "No X with id …".

**Classification and gating in the loop:**

- `read` → execute immediately, emit `tool.started/completed`.
- `propose` → execute immediately (the handler only appends to `ProposalStore` and returns "recorded, awaiting review"), emit `proposal.created`; the loop continues. No pause.
- `write` → pause with `pendingApproval` exactly as today (`ApprovalCard`), resume via `/api/agent/approve`. Reserved for platform-mutating actions (mark ready; future refund/charge would go here with a distinct second confirmation).
- Scope filter: `propose_*` are removed from the tool set and rejected at dispatch outside dispute scope; proposals against a resolved dispute are rejected at the handler (`isDisputeOpen` guard — the one robustness case where being wrong mutates).

**Why not MCP for everything.** Unchanged decision: Commas/Fathom/Zoom stay MCP-shaped (mock in-proc servers today, swappable for real), Gmail/Calendar/GoHighLevel stay api-shaped, and the new `actions` adapter is app-shaped. The registry makes them indistinguishable to the loop. Real MCP servers become worth it when the tool surface must be shared beyond this runtime — not before.

---

## 7. Frontend action architecture

Five stages, each with a distinct representation and owner (ported from the POC, mapped onto this repo's existing state):

| Stage | Where | Representation |
|---|---|---|
| 1 Agent intent | model reasoning inside a run | ephemeral |
| 2 Proposed action | `server/agent/proposalStore.ts` via `propose_*` tools | `ActionProposal { id, chatId, scope, kind, input, status:"pending", createdAt }` |
| 3 Human decision | `DisputeDetail` → new `ProposalCard` (Commas tokens: `content-card`, `btn-dark`/`btn-secondary`, agent accent) | Approve / Edit-then-approve / Dismiss; evidence proposals get "Review" (expands record + citation) before "Add to dispute" |
| 4 Executed action | `src/lib/actionExecutors.ts` — plain functions called from click handlers | `addEvidenceAfterApproval`, `applyResponseDraft`, `applyCaseSummary` |
| 5 UI state update | the setters the manual UI already uses | `onAddEvidence(item{addedBy:"ai"})`, `setDraft(disputeId, text)`, `setCaseSummary(disputeId, text)` |

**Existing UI actions that become agent-reachable (via proposals only):**

- **Add evidence** → `propose_evidence(title, record, why, category, citation)` → approved → `App.addEvidenceItem(disputeId, { …, addedBy: "ai", sourceType: citation.sourceType })` → renders under its category in `ManualEvidenceCard` exactly like seller-added items, with an "AI found" marker and the source icon. `addedBy: "ai"` stops being a dead value.
- **Response draft** → `propose_response_draft(text)` / `update_response_draft(text, reason)` → approved → fills the response textarea. Requires lifting `DisputeDetail`'s local `response` state to `App.tsx` (`draftByDispute`) — the one small refactor to an existing component, done so the draft survives navigation and can be set by an executor. "Save draft" keeps its toast and now actually persists (localStorage v3).
- **Case summary** → `propose_case_summary(summary)` → approved → a small "Case summary · AI drafted · you approved" card above the response card (new, optional).
- **Mark response ready** → unchanged: the `write` tool, `ApprovalCard`, `markedReadyDisputeIds` badge.
- **Never agent actions:** verification, Submit response, evidence deletion, connector connect/disconnect, credit purchase.

**Transport of proposals to the UI:** `proposal.created` events during a run (so cards appear as the agent works), plus `GET /api/agent/proposals?chatId=` on dispute open (so pending cards survive navigation/reload). Decisions: `POST /api/agent/proposals/:id/decision { decision, editedInput?, executionResult }` — the browser reports what it *did*; the server records it and, on the next turn, the context block tells the model "the seller APPROVED/REJECTED …" including the created evidence id so follow-ups can reference it. A failed execution stays pending with an inline error and Retry rather than becoming a rejection.

**Global mode actions:** none that mutate. The only global-mode "action" is a navigation suggestion chip rendered from a `suggest_open_dispute(disputeId)` hint (or simply from the answer text) that calls the existing `setView/setRcView/setSelectedDisputeId` path on click.

---

## 8. Conversation persistence strategy

Two halves, deliberately different owners, kept in step by the shared `chat.id`:

| What | Owner | Store | Lifetime |
|---|---|---|---|
| Rendered transcript (what the seller sees: bubbles, tool summaries, proposal outcomes) | browser `useChatStore` | `localStorage["commas-ai-agent:v3"]` | across reloads (as today) |
| Model transcript (tool_use/tool_result, findings — what the model reasons over) | server `SessionStore` | `data/state.json` (write-then-rename, versioned) | across server restarts |
| Proposals + decisions | server `ProposalStore` | `data/state.json` | across restarts |
| Resolution Center artifacts (evidence items incl. AI-added, drafts, case summaries) | browser `App.tsx` | `localStorage` v3 `rcState` (new — today they are lost on reload, which would make an approved AI action evaporate) | across reloads |
| Credits, sources | browser (unchanged) | localStorage v3 | across reloads |

Rules: deleting a chat (sidebar trash, "Start new session") deletes both halves (`DELETE /api/agent/sessions/:chatId` also drops its pending proposals). `resetDemo()` calls `POST /api/demo/reset` (new) so server sessions/proposals and the mock write flag reset together with the browser. Storage key bumps to `v3` with a migration that keeps `v2` chats and marks their sessions `memoryLost` on first resume. A single-process JSON file is the right size for this prototype; the store sits behind an interface so SQLite can replace it (the original `ARCHITECTURE.md` §10 intent, finally built).

---

## 9. Proposed dependency additions

**Required: none.**

| Need | Already available |
|---|---|
| Streaming model responses, multiple tool_use blocks, adaptive thinking | `@anthropic-ai/sdk` 0.120 — `client.messages.stream()`; the beta `toolRunner` + `betaZodTool` helpers also exist if the manual loop is ever replaced |
| SSE from Hono | `hono/streaming` `streamSSE` (4.13.3) |
| MCP-shaped tools, in-proc transports | `@modelcontextprotocol/sdk` 1.30 |
| Schemas | `zod` 4 |
| Dev: run/test | `tsx`, `vitest` |

**Deliberately not added, with reasons:**

- **`@copilotkit/react-core` / `@copilotkit/runtime` (2.0.0-next.x)** — would introduce a second message/run store beside `useChatStore`, a pre-release with documented bugs (Express adapter dropping SSE bodies, singleton `threadId`, context not forwarded by `runAgent()`, post-terminal event rejection), a `--legacy-peer-deps` conflict on `@anthropic-ai/sdk` versions, and ~5× the client bundle — to obtain a chat surface this repo already has in polished form. The POC's own verdict: "AG-UI is the valuable part; a build on a thin SSE endpoint would have been similar in size."
- **`@ag-ui/client`** — not needed to *emit* a well-defined event stream; the vocabulary below is named after AG-UI's (`RUN_STARTED`, `TEXT_MESSAGE_CONTENT`, `TOOL_CALL_START/END`, `RUN_FINISHED`, `RUN_ERROR`, `CUSTOM`) so adopting the protocol later is a transport swap, not a rewrite. Adding the package would force `rxjs` and an `AbstractAgent` shape onto a runtime that doesn't need it.
- **`@anthropic-ai/claude-agent-sdk`** — see the decision below.
- **`rxjs`, a router, a state library, a markdown library** — not needed; `liteMarkdown` gains tables/links only if the real model's output demands it.

### Decision: CopilotKit — do not introduce

The requirement is "preserve the existing Commas UI, do not replace polished UI with generic framework UI". CopilotKit's contribution in headless mode is a hook that owns messages and runs; `useChatStore` already owns them, and every consumer component reads from it. Introducing it means either two stores (the POC's `conversationStore` + `useAgent` duality, which caused the frozen-stream bug there) or rewriting `useChatStore` around a pre-release dependency. The streamed-event consumer that replaces `applyPlan()`'s timers is ~150 lines of plain TypeScript. Revisit only if a stable CopilotKit release ships an AG-UI-native runtime *and* a requirement appears that it uniquely serves (e.g. generative UI components authored outside this repo).

### Decision: Claude Agent SDK — do not introduce

In the POC it was the right call because that codebase had **no loop**; the SDK supplied loop, sessions and in-proc tools for free. This repo already has a tested loop (`runtime.ts`), an adapter abstraction that must stay transport-agnostic ("not every source is MCP" is a recorded product decision), and an approval pause that spans HTTP requests. Adopting the SDK would replace `runtime.ts`/`registry.ts`, force every adapter into `createSdkMcpServer` shape, spawn the Claude Code CLI as a subprocess with its own on-disk session format and ambient-credential behavior (the POC "worked without a key" because the CLI login was present — a surprise on any other machine), and make the approval pause awkward (the POC sidestepped it with proposals). The three things the SDK would give — streaming, N tool calls per turn, session resume — are each small additions to the existing loop using the SDK that is already installed. Keep `AnthropicLlmClient` on `@anthropic-ai/sdk`; make the model id an env var (`AGENT_MODEL`, default `claude-opus-5`).

---

## 10. Risks and conflicts

| # | Risk / conflict | Mitigation |
|---|---|---|
| 1 | **Tests assert stub strings and the JSON `/api/agent/run` shape** (`disputeIntents.test.ts`, `runtime.test.ts`, `app.test.ts`, `ChatFlow.test.tsx`). | Streaming is additive; the JSON route collects events into today's response; `StubLlmClient` stays the no-key path and emits through the same sink. New behavior gets new tests with a *scripted* `LlmClient` (existing pattern); the real model is exercised by a manual smoke script, never CI. |
| 2 | **The real model has never run.** Prompt quality, tool schema strictness, latency, and the one-`tool_use`-per-response bug are all unobserved. | Phase 1 is *only* "make the existing loop run live and watch it" before anything else is built on it. |
| 3 | **Chips were authored for the stub.** The 7 dispute / 5 global / 4 dashboard prompts must produce good answers from the real model too. | Prompt work in Phase 5; chips stay; the report format gives the model a target. |
| 4 | **Two stores of truth for a chat** (rendered vs model transcript) can diverge — e.g. server restart before persistence. | `memoryLost` flag + honest context line; client `history` used only to bootstrap; deletion/reset clear both halves. |
| 5 | **Cross-scope leakage** (one dispute's findings in another's chat). | Immutable scope per chat, server-side scope guard, `propose_*` withheld and rejected outside dispute scope; regression test ported from the POC. |
| 6 | **RC state lives in React memory** — an approved AI action is lost on reload (POC limitation 3). | localStorage v3 `rcState` in Phase 6, done *before* proposals ship. |
| 7 | **`server/types.ts` ↔ `src/lib/types.ts` hand mirror** grows with the envelope/proposal types. | Introduce `shared/` included by both tsconfigs (neither is `composite`, so a file can be pulled into both projects via import — verify with `tsc -b` in Phase 3; fall back to mirroring if it objects). |
| 8 | **`DisputeDetail` refactor** (lifting draft state) touches preserved UI. | Behavior-preserving; textarea, buttons, toast unchanged; covered by a render test. |
| 9 | **Latency** — a full multi-source investigation is 1–2.5 min on the POC. | Streaming progress makes it legible; per-run wall clock; the stopping-criteria prompt keeps call counts bounded; `AGENT_MODEL` can be pointed at a faster model for demos. |
| 10 | **Credits are message-based and client-side**; a 15-call investigation costs "1 credit". | Keep the rule for the prototype (product decision); expose per-run tool counts in `run.completed` so metering can be revisited later without UI change. |
| 11 | **Prompt injection via source content** (emails, call notes are model input). | Out of scope with fixtures; note in the system prompt that source text is data, not instructions; real connectors would need real treatment. |
| 12 | **Ambient credentials.** With the plain SDK there is no CLI fallback: no key → stub, explicitly. | `GET /api/health.llmMode` already reports which path is active; `.env.example` documents `AGENT_MODEL`. |
| 13 | **Single-process JSON store** is not multi-instance safe. | Acceptable for the prototype; interface allows SQLite later. |
| 14 | **Conflict with `docs/ARCHITECTURE.md`** (tool-runner loop, backend-metered credits, Google Meet/ClickFunnels). | This document supersedes it for the branch; `active-context.md` gets a pointer when implementation starts. |

---

## 11. Phased implementation order

Every phase ends green (`typecheck`, `lint`, 94+ tests) with `main`'s UI pixel-identical unless the phase says otherwise, and with `AI_ASSISTANT_IMPLEMENTATION_STATUS.md` updated.

| Phase | Deliverable | Touches | Reuses from POC |
|---|---|---|---|
| **1 — Live model on the existing loop** | `AnthropicLlmClient`: `messages.stream()`, all `tool_use` blocks per response, text alongside tool calls preserved, `AGENT_MODEL` env, error mapping verified live; `scripts/smoke-live.ts`; first real turn observed and recorded (global + dispute chips). No UI change. | `server/llm/anthropicClient.ts`, `server/agent/runtime.ts` (multi-call), `.env.example` | — |
| **2 — One dataset, wider tools** | `server/data/world.ts` + `connectedSources.ts` for all 5 customers (+ empty and failing-connector cases); new Commas/connector tools per §6; citations on results; `KNOWN_TOOLS` labels; `commas_get_dispute_evidence` fed by a server mirror populated from the envelope. | `server/data/*` (new), `server/mcp/*`, `server/adapters/*`, `server/agent/registry.ts` | `server/data/commasData.ts`, `connectedSourcesData.ts`, `server/tools/*.ts`, `mcpResult.ts` (shapes, not code paths) |
| **3 — Sessions + context envelope** | `SessionStore` (`data/state.json`), scope guard, `AgentContextEnvelope` built in `useChatStore` from `App` state (evidence inventory, sources), `contextBlock.ts` with first-turn/delta rendering, `DELETE /api/agent/sessions/:chatId` wired to `deleteChat`, `POST /api/demo/reset`, `shared/` types. | `server/agent/sessionStore.ts`, `contextBlock.ts` (new), `app.ts`, `useChatStore.tsx`, `agentApi.ts`, `App.tsx` (pass evidence to the store) | `shared/contextModel.ts`, `server/agent/scopeSessions.ts`, `contextBlock.ts` |
| **4 — Streaming transport** | `EventSink`; `POST /api/agent/runs` streaming SSE (AG-UI-named events); JSON route kept as a collector; `agentApi.streamRun()`; `useChatStore` consumes events (steps live, text deltas, `pendingApproval`), cancel = abort; `ProgressBlock`/bubbles unchanged. | `server/agent/events.ts` (new), `app.ts`, `agentApi.ts`, `useChatStore.tsx` | `server/agent/translate.ts` (event mapping table) |
| **5 — Dispute-mode investigation** | Mode-aware system prompt: workspace section vs investigation loop (steps, stopping criteria, source selection by reason, report format, three kinds of "nothing", conflict handling, robustness rules); iteration/wall-clock caps per scope; live verification on all 5 disputes (strong / weak / conflicting / none / resolved). | `server/agent/prompt.ts` (new), `runtime.ts` | `server/agent/prompt.ts` `INVESTIGATION_LOOP_PROMPT` + Phase 12 edge-case rules |
| **6 — RC persistence + proposals** | localStorage v3 with `rcState` (evidence, drafts, summaries) and `draftByDispute` lifted to `App`; `actions` adapter with `propose_*` tools (`propose` classification, scope + open-dispute guards); `ProposalStore`; `proposal.created` event + proposals/decision routes; `ProposalCard` in `DisputeDetail` (review / edit / approve / dismiss / retry); executors; decisions fed back via the context block; "AI found" marker on evidence. | `server/tools/actions.ts`, `server/agent/proposalStore.ts` (new), `src/lib/actionExecutors.ts`, `src/components/resolution/ProposalCard.tsx` (new), `DisputeDetail.tsx`, `App.tsx`, `useChatStore.tsx` | `shared/actionContracts.ts`, `server/agent/proposalStore.ts`, `server/tools/actions.ts`, `src/copilot/executeAction.ts`, `ProposalCard.tsx`, `useProposals.ts` |
| **7 — Global mode + hardening** | Workspace context (dashboard facts, portfolio), dispute handoff chip, connector-failure and resolved-dispute behavior verified, robustness pass (repeated requests, ambiguous follow-ups, interruption), docs (`README.md`, stale folder READMEs, `active-context.md` pointer), regression suite; optional: `liteMarkdown` tables/links if needed. | prompt, `App.tsx` (chip → navigation), docs, tests | POC Phase 12 edge-case matrix |

**Sequencing rationale.** 1 before everything: the model is the only untested component and its real behavior determines prompt and cap choices. 2 before 3/5: the investigation prompt and the evidence tool need the dataset. 3 before 4: streaming a run that has no memory would need to be redone. 4 before 5: verifying a real investigation without live progress is impractical. 6 last among the functional phases because it is the only one that mutates RC state, and it should land on persisted RC state.

**Definition of done for the branch:** in one running app, a seller can (a) ask a global question and get a real, sourced, streamed answer; (b) open a dispute, click "Investigate with AI", watch real tool progress, receive the structured report; (c) ask "What did Fathom say?" and get an answer from memory with no tool calls; (d) approve a proposed evidence item and see it in the Resolution Center with an AI marker, reload, and still see it; (e) switch disputes with zero leakage — all with the `main` UI visually unchanged and `main` itself untouched.
