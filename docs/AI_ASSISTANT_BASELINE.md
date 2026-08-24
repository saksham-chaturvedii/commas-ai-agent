# AI Assistant Baseline — `commas-ai-agent`

**Branch:** `experiment/unified-ai-assistant` (created from `main` at `c3a250c6701427e065aa388205f1f3516cc38216`)
**Date:** 2026-08-24
**Purpose:** a complete, verified technical snapshot of the repository *before* any AI-assistant implementation work on this branch. Everything below describes the codebase exactly as it exists at branch creation. Nothing here is aspirational — where the existing docs describe a design that was never built, that is called out.

> Companion context: `docs/active-context.md` (the repo's running session log — read it for the *history* of how the code got here), `docs/PROTOTYPE_SPEC.md` / `docs/ARCHITECTURE.md` / `docs/IMPLEMENTATION_PLAN.md` (the original spec set — parts of it were superseded by what was actually built; see §14), and `PRODUCT_READINESS_AUDIT.md` (a read-only audit whose P0/P1 items have since been implemented).

---

## 0. Baseline verification (performed 2026-08-24 on `main` @ `c3a250c`)

| Check | Result |
|---|---|
| `git status` | clean (no modified or untracked files) |
| `npm run build` (`tsc -b && vite build`) | ✅ passes — `dist/assets/index-*.js` 258.52 kB (74.28 kB gzip), CSS 40.21 kB |
| `npm run typecheck` (`tsc -b --noEmit`, 3 projects: app / node / server) | ✅ 0 errors |
| `npm test` (`vitest run`) | ✅ **94 / 94 tests** across 12 files |
| `npm run dev:server` | ✅ boots on `http://localhost:8787`; `GET /api/health` → `{ ok: true, commasConnected: true, llmMode: "stub", sources: [6 adapters] }` |
| `npm run dev` | ✅ Vite serves the app (used :5174 during verification because :5173 was occupied by the sibling `commas-ai-copilot` dev server; the app itself has no fixed-port assumption) |
| Toolchain | Node v24.18.0, npm 11.16.0 |

Both dev processes were started, probed, and stopped again; the working tree remained clean afterwards.

---

## 1. Current repository architecture

### 1.1 Stack

| Layer | Technology | Notes |
|---|---|---|
| Frontend | React 18.3 + TypeScript 5.6 + Vite 5.4 + Tailwind CSS v4 (`@tailwindcss/vite`) + `lucide-react` | No router, no state library — React Context + `useState` |
| Backend | Node 20+ / TypeScript / **Hono** 4 + `@hono/node-server` | Single process, run with `tsx` |
| LLM | `@anthropic-ai/sdk` ^0.120 (real client) + a deterministic in-repo stub | Stub is what actually runs (no key in any environment so far) |
| MCP | `@modelcontextprotocol/sdk` ^1.30 — self-hosted client + in-process mock servers | Real MCP protocol over `InMemoryTransport`; optional Streamable-HTTP "real mode" |
| Validation | `zod` ^4 (MCP tool input schemas) | |
| Tests | Vitest 2 + `@testing-library/react` + jsdom | 94 tests; no Playwright suite committed |
| Config | `dotenv` (server only) | `.env.example` documents the shape; no `.env` exists |

### 1.2 Layout

```
commas-ai-agent/
├── index.html, vite.config.ts (proxy /api → :8787; vitest config), eslint.config.js
├── tsconfig.json  → references: tsconfig.app.json (src + tests), tsconfig.node.json (vite.config), tsconfig.server.json (server/)
├── package.json   scripts: dev · dev:server · dev:all · build · preview · typecheck · lint · test
├── .env.example   ANTHROPIC_API_KEY · COMMAS_MCP_MODE · COMMAS_MCP_URL · COMMAS_API_KEY · PORT
├── public/        commas_bg_draft.webp (shell gradient), README.md
├── docs/          active-context.md · ARCHITECTURE.md · IMPLEMENTATION_PLAN.md · PROTOTYPE_SPEC.md · references/ (14 screenshots)
├── PRODUCT_READINESS_AUDIT.md
├── src/                                   ← browser app (tsconfig.app.json)
│   ├── main.tsx, App.tsx                   shell, view routing, panel binding, per-dispute evidence state
│   ├── index.css                          Tailwind v4 @theme tokens + shared CSS "recipes"
│   ├── hooks/useChatStore.tsx             THE chat/sources/credits/run store (React Context, localStorage)
│   ├── lib/                               agentApi.ts · types.ts · mockData.ts · disputeData.ts · evidenceUpload.ts · liteMarkdown.tsx
│   ├── pages/                             DashboardPage.tsx · ChatPage.tsx
│   ├── components/shell/                  Sidebar · TopNav · Badge · CommaMark · AgentMark
│   ├── components/chat/                   16 chat-surface components (see §3)
│   ├── components/resolution/             ResolutionCenter · DisputeDetail · AddEvidenceModal · EvidenceUploadArea · filters/popovers
│   ├── components/dashboard/              RevenueModule · AnnouncementsModule · OverviewControls · OverviewCard · MiniChart · EmptyIllustration
│   └── agent/ llm/ mcp/ connectors/ context/   ← STALE placeholder README.md files only (real code is in server/)
├── server/                                ← agent backend (tsconfig.server.json)
│   ├── index.ts                           entry (dotenv, bind port)
│   ├── app.ts                             createApp(): adapters, registry, LLM selection, 4 routes
│   ├── types.ts                           wire types (hand-mirrored from src/lib/types.ts)
│   ├── agent/runtime.ts · registry.ts · errors.ts
│   ├── llm/types.ts · anthropicClient.ts · stubClient.ts
│   ├── adapters/types.ts · commasAdapter · mcpAdapter · meetingsAdapters · gmailAdapter · calendarAdapter · crmAdapter
│   └── mcp/client.ts · connectInProcess.ts · mockCommasServer.ts · mockFathomServer.ts · mockZoomServer.ts
└── tests/                                 6 frontend suites + tests/server/ 6 backend suites
```

### 1.3 Runtime topology (as built)

```
Browser (React)                          Node / Hono (server/)
┌──────────────────────────┐   POST /api/agent/run     ┌────────────────────────────────────────────┐
│ useChatStore.sendMessage │ ─────────────────────────▶│ runAgentTurn()  (server/agent/runtime.ts)  │
│   → agentApi.runAgentTurn│   { prompt, enabledSources,│   loop ≤ 6 iterations:                     │
│                          │     context, history[≤20] }│     llmClient.nextStep() ──▶ tool_call?    │
│ applyPlan(): reveals     │ ◀─────────────────────────│       read  → adapter.callTool() (10s cap) │
│   steps on 650ms timers, │   { steps[], answer,       │       write → return pendingApproval       │
│   then answer / approval │     toolSummary[], error?, │     final  → return answer                 │
│                          │     pendingApproval? }     │                                            │
│ ApprovalCard Approve/    │   POST /api/agent/approve  │ resumeAfterApproval() → same loop          │
│   Decline                │ ─────────────────────────▶│                                            │
└──────────────────────────┘                           │ SourceAdapter[6] ──┬─ CommasAdapter (MCP, in-proc mock or real HTTP)
                                                       │                    ├─ McpSourceAdapter fathom / zoom (in-proc mock MCP)
                                                       │                    └─ Gmail / Calendar / Crm (plain mock "api" adapters)
                                                       └────────────────────────────────────────────┘
```

Key facts:
- **Synchronous request/response, no SSE.** The whole agent loop runs server-side and returns once; the browser paces the *display* of already-finished steps with `setTimeout`s (`STEP_INTERVAL_MS = 650`). `ARCHITECTURE.md` §9's SSE event contract was never implemented.
- **Stateless backend.** No server-side chat store, no session, no run ids. Every request carries the full context it needs (`prompt`, `enabledSources`, `context`, `history`). The only server-side mutable state is the mock Commas dataset's `responseStatus` flag (in-memory, lost on restart).
- **No backend `data/` store exists** (gitignored path `data/state.json` is referenced in `.gitignore` but nothing writes it).
- **`server/` cannot import `src/`** (separate tsconfig projects) — `server/types.ts` mirrors `src/lib/types.ts` by hand and the two must be kept in sync manually.

---

## 2. Current application shell

`src/App.tsx` (`AppShell`) — the only "router":

| State | Type | Purpose |
|---|---|---|
| `view` | `"dashboard" \| "resolution-center" \| "chat"` | top-level page |
| `rcView` | `"list" \| "detail"` | Resolution Center sub-view |
| `selectedDisputeId` | `string` (default `"2481"`) | which dispute Detail shows; `DisputeDetail` is remounted via `key={selectedDisputeId}` |
| `evidenceByDispute` | `Record<string, AIEvidenceItem[]>` | session-lifetime evidence added via "Add evidence", seeded from `DISPUTES[].seedEvidenceItems`; **not persisted** |
| `chatPageActiveId` | `string \| null` | which chat the full Chat page shows |
| `panelOpen`, `panelChatId` | | right-side AI panel binding |

Layout (ported from `commas-ai-copilot`): `.app-shell-bg` gradient frame → `Sidebar` (48px glass icon rail: Home / Billing / Growth / Wallet / Resolution Center / **Chat**, app tiles, settings, account) + column of `TopNav` (glass org pill "makemorecommas", Sparkles "Search apps…" field, +/settings/help/bell icons, black "Finish setup" pill) and a `flex` row of the page `main-surface` plus, when open, the `RightPanel` as a **sibling** `main-surface` column (380px; overlays as `fixed` below the `lg` breakpoint). `FloatingAIButton` (bottom-right, `AgentMark`) renders on every non-Chat view while the panel is closed.

Panel-context rules enforced in `App.tsx`:
- `openPanel(context?)`: with a context → find or create the chat whose `context.kind/id` matches; without → reuse the previous panel chat only if it is context-less, else create a general chat (audit P1-3).
- The panel **closes on any navigation** (sidebar click, RC list↔detail) so a "Dispute #2481" chat never floats over another page (P1-1), and is force-closed on the Chat view (which has its own full surface).
- `currentContext` for the floating button: dispute context on RC detail, `DASHBOARD_CONTEXT` on the dashboard, none on the RC list.

Non-functional-by-design shell affordances (visual fidelity only): Billing / Growth / Wallet nav, all TopNav icons and search, "Finish setup", sidebar app tiles and "+", settings/account buttons.

---

## 3. Global AI chat implementation

### 3.1 Surfaces (all render the same `ChatWorkspace`)

| Surface | File | When |
|---|---|---|
| Full Chat page | `src/pages/ChatPage.tsx` | Sidebar → Chat. `ChatHistoryList` (256px, "New chat" + Today/Yesterday/Earlier groups + hover-delete) + header with `CreditIndicator` + `ChatWorkspace` |
| Right-side panel | `src/components/chat/RightPanel.tsx` | Floating button or "Investigate with AI". Header: `AgentMark`, chat title, compact `CreditIndicator`, "Start new session" (dispute chats with messages — calls `deleteChat`), "Open in full Chat view", close |
| Floating button | `FloatingAIButton.tsx` | Opens the panel with the current page's context |

### 3.2 `ChatWorkspace` (`src/components/chat/ChatWorkspace.tsx`)

- Empty chat → `EmptyState`: `AgentMark`, greeting ("How can I help you today?" / "How can I help resolve this dispute?"), `DisputeSummaryHeader` for dispute chats (id · customer · $amount · reason), hero `ChatComposer`, `SuggestedCapabilities` chips, dismissible "Get better answers from your apps" strip with `SourceIcon`s that opens `ConnectedAppsModal`.
- Non-empty → `ChatMessageList` (bubbles via `ChatMessageBubble` → `renderLiteMarkdown` + collapsed `ToolSummary` "Checked N sources"; in-flight `ProgressBlock` with per-step `SourceIcon` + spinner/check, "Thinking…" fallback while `runSteps` is empty; inline `ApprovalCard` when `runPhase === "awaiting_approval"`) + `ContextChip` (dispute chats) + bar `ChatComposer`.
- Suggestion sets by context (`src/lib/mockData.ts`): `SUGGESTED_CAPABILITIES` (5 global), `DASHBOARD_SUGGESTED_CAPABILITIES` (4), `DISPUTE_SUGGESTED_CAPABILITIES` (7).

### 3.3 `ChatComposer`

Textarea (Enter sends, Shift+Enter newline), `SourcesMenu` controls button, Send / Stop (Stop calls `cancelRun`, which aborts the in-flight fetch). Disabled when credits are exhausted or another chat's run is in flight; exhausted state shows the "Buy Credits" CTA → `AddCreditsModal`.

### 3.4 Markdown

`src/lib/liteMarkdown.tsx` — deliberately tiny: `**bold**`, `### Heading` (→ `<h4>` uppercase overline style), `- item` runs (→ `<ul>`), paragraphs; segments line-wise so single-`\n` joins render correctly. No links, code, tables, or nested lists.

---

## 4. Chat history and conversation handling

All in `src/hooks/useChatStore.tsx` (575 lines) — `ChatStoreProvider` wraps the app in `App.tsx`.

**Data model** (`src/lib/types.ts`):
```ts
Chat { id, title, createdAt, updatedAt, status: "idle"|"running"|"error", enabledSources: SourceId[], context?: PageContext, messages: ChatMessage[] }
ChatMessage { id, role: "user"|"assistant", text, ts, toolSummary?: ToolSummaryItem[] }
PageContext { kind: "dispute"|"dashboard", id, label, dispute?: DisputeContextDetail }
```

**Behaviors:**
- **One `chats` array** backs every surface; dispute-context chats live in the same array but are filtered out of the main history list (`ChatHistoryList`: `!c.context || c.id === activeChatId`). No separate dispute store.
- `createChat(context?)` dedupes against an existing *empty* chat with the same context signature (reads `chatsRef.current` synchronously — a documented fix for a React updater-timing bug). Title = `context.label` or "New chat"; first user message re-titles context-less chats (`chatTitleFrom`, 60-char cap).
- `sendMessage(chatId, text)`: refuses if credits ≤ 0 or another chat is running; charges 1 credit synchronously; appends the user message; sets `status: "running"`; POSTs `/api/agent/run` with `history = last 20 messages as {role,text}`; on response `applyPlan()` reveals steps on timers then appends the assistant message (or `"I ran into a problem: …"` on `error`, or parks a `pendingApproval`).
- `approveWrite()/declineWrite()` → `POST /api/agent/approve` with the original prompt/history replayed; on an approved, successful `commas_mark_dispute_response_ready`, adds the dispute id to `markedReadyDisputeIds` (session-only) so `DisputeDetail` can show a "Marked ready by AI" badge.
- `cancelRun()`: aborts fetch, clears timers, appends "Stopped by you.", resets run state after 300ms.
- `deleteChat(id)`: removes the chat and clears run state if it was the running one.
- **Persistence:** `{ chats, sources, credits }` → `localStorage["commas-ai-agent:v2"]` on every change; hydrated on mount with shape validation, old-credit-shape fallback, and `reconcileInterruptedRuns()` (a chat persisted with `status: "running"` becomes `idle` + "This response was interrupted — ask again and I'll pick it up.").
- **Memory model:** the *only* conversation memory is the client-sent `history` window (text only, ≤ 20 turns; capped again server-side). Tool results from earlier turns are not remembered; there is no server session, thread id, or summary.
- `resetDemo()` restores `SEED_CHATS` / `SOURCES` / `INITIAL_CREDITS`, clears `markedReadyDisputeIds`; the "Reset all demo data" button then reloads the page (to reset `App.tsx`-local evidence state too).

Seed history (`SEED_CHATS`): two authored global chats ("Which discount codes get used the most?", "Sales summary — last 30 days") whose answers are hand-written text, not produced by the backend.

---

## 5. Current Resolution Center

`src/components/resolution/ResolutionCenter.tsx` (list) — ported from `commas-ai-copilot`:
- Tabs: Needs response (4 rows) · In review (empty state) · All disputes (5 rows + Status column) · Lost (empty) · Won (1 row).
- Filter pills: Reason (`ReasonPopover`, 8 checkboxes), Status (All tab only, no popover), Amount (`AmountFilterPopover` min/max), Dispute date / Evidence due by (`DateFilterPopover`). **Popovers open and hold local state but never filter the rows.** Toolbar search input and "Export" are non-functional.
- Table: customer (initials avatar + name), reason, amount, dispute date, evidence due (red for open, grey for won), status badge (All tab). Row click → `onOpenDispute(id)`.

`src/components/resolution/DisputeDetail.tsx` (detail, parameterised by `disputeId`):
- Back link, "Dispute #id" + status `Badge`, meta line (amount · reason · evidence due (label)), **"Investigate with AI"** `btn-blue` (hidden for resolved disputes) → `onInvestigate` → `openPanel(buildDisputeContext(id))`.
- Left column: `ManualEvidenceCard` (6 evidence categories from `evidenceCategories`, Added/Not-added badges, per-category "Add"/"Add another" → `AddEvidenceModal`, session-added and seeded items listed under their category with `AttachmentChip`s → `AttachmentPreviewOverlay` lightbox / honest no-preview card) and the response card: editable textarea + "Save draft" (2s "Draft saved" toast, text not persisted) + permanently disabled "Submit response" (tooltip: "Submission is simulated in this prototype"); "Marked ready by AI" badge when applicable. Resolved disputes render a read-only "Submitted response" card instead.
- Right column: Dispute details / Customer / Transaction `content-card`s with `DetailRow`s.
- `isResolved = dispute.status !== "Needs response"` drives every read-only branch (one implementation, conditionally rendered).

---

## 6. Current dispute / evidence flows

**Data:** `src/lib/disputeData.ts` — 5 `DisputeCase`s (see §9) + `evidenceCategories` (6) + `AIEvidenceItem` / `EvidenceFileMeta` types + `getDispute(id)`.

**Manual "Add evidence" flow** (`AddEvidenceModal.tsx` + `EvidenceUploadArea.tsx` + `src/lib/evidenceUpload.ts`): type pill (6 types) → title → optional details → dropzone (click or drag-drop, multi-file, `accept` = JPG/PNG/WEBP/PDF/DOC/DOCX, 10 MB cap) → per-file validation (duplicate → notice; empty / unsupported / oversized → error row with Retry) → simulated `selected → uploading (550ms) → processing (550ms) → ready` (filename containing "fail" deterministically errors at upload) → "Add evidence" enabled only when title present and all files ready → Review step → "Submit evidence" → `onAdd(AIEvidenceItem{ sourceType:"manual", addedBy:"seller", category, files[] })` → `App.tsx` appends to `evidenceByDispute[disputeId]` → card shows a 3s success line and the item under its category. Image `mockUrl`s are object URLs (revoked on unmount); other files get synthetic `mock://` URLs. **Nothing is uploaded anywhere; evidence does not survive a reload; the agent does not see it.**

**Agent-side evidence:** `AIEvidenceItem` has `addedBy: "ai"` in its type, but **no code path creates AI-added evidence** — there is no "propose evidence" tool, no approval-to-attach flow, and the Resolution Center never renders agent output outside the chat panel. The old `commas-ai-copilot` `EvidenceCopilot` cards and `SourceView` pages were deliberately not ported.

**Write action:** the single write tool `commas_mark_dispute_response_ready` (mock Commas MCP server) flips a mock in-memory flag; gated by the runtime's approval pause; surfaced on the page only as the "Marked ready by AI" badge.

---

## 7. Current AI behavior

### 7.1 Runtime (`server/agent/runtime.ts`)

- `runAgentTurn()` / `resumeAfterApproval()` share `runLoop()`: `MAX_ITERATIONS = 6`, `TOOL_TIMEOUT_MS = 10_000`.
- Tool set per turn = every registry tool whose `sourceId` is in the chat's `enabledSources` (read **and** write — the model must be able to see write tools to propose them).
- `classification === "write"` → return `pendingApproval { toolCallId, toolName, input, summary }` **before** executing. `/api/agent/approve` replays the prompt/history with the (executed or declined) result prepended to `toolHistory` and continues the loop from iteration 1.
- Tool-level failures are fed back to the LLM as `{ ok: false, data: message }` (recoverable); LLM-level failures become a top-level `error { code, message }` (`AgentError` codes: `auth_failed | server_unavailable | malformed_result | tool_error | timeout | empty_result | unknown`).
- Iteration cap → answer "I couldn't finish that within the step limit — try asking a narrower question."
- `buildSystemPrompt(context)`: a fixed persona line naming the six sources; for dispute context it appends the label and, when `context.dispute` is present, the structured facts (customer, email, transaction id, amount, reason, dates, evidence status) with "Use these directly — don't re-fetch what you already know."

### 7.2 Tool registry (`server/agent/registry.ts`)

Built at startup from every adapter's `listTools()` (real discovery, not a hardcoded list) joined with `KNOWN_TOOLS` presentation metadata. Unknown tool names **fail safe to `write`**. Registered today (11 tools, 6 sources):

| Source (`SourceId`) | Adapter kind | Tools | Classification |
|---|---|---|---|
| `commas` | mcp (in-proc mock, or real Streamable HTTP) | `fanbasis_list_customers`, `fanbasis_list_transactions`, `fanbasis_get_transaction`, `commas_list_disputes`, `commas_get_dispute` | read |
| | | `commas_mark_dispute_response_ready` | **write** |
| `fathom` | mcp (in-proc mock) | `fathom_search_calls` | read |
| `zoom` | mcp (in-proc mock) | `zoom_list_meetings` | read |
| `gmail` | api (mock) | `gmail_search_threads` | read |
| `google-calendar` | api (mock) | `calendar_list_events` | read |
| `crm` (user-facing "GoHighLevel") | api (mock) | `crm_get_contact` | read |

### 7.3 LLM clients (`server/llm/`)

- `LlmClient.nextStep({ systemPrompt, userPrompt, context, availableTools, conversationHistory, toolHistory })` → `{ type: "tool_call", … } | { type: "final", text }`. One model round-trip per loop iteration.
- **`AnthropicLlmClient`** — real `@anthropic-ai/sdk` usage: `claude-opus-5`, `max_tokens 4096`, `thinking: { type: "adaptive" }`, tools mapped from the registry, history + tool_use/tool_result pairs rebuilt from `toolHistory`, Anthropic error classes mapped to `AgentError`. Selected only when `ANTHROPIC_API_KEY` is set. **Has never been invoked in any recorded session** (no key available); it is untested against a live model. Note: it returns only the *first* `tool_use` block per response (parallel tool calls are serialised one per iteration) and drops any text preceding a tool call.
- **`StubLlmClient`** — what every test and every live check has run on. A deterministic keyword/regex router (priority order): hidden test phrase `all roads lead to` → no-sources guard → acknowledgment small-talk → dispute intents in dispute context (`draft` / `communications` / `evidence` / `summarize` / `recommend` / `why`, answered from the dispute record's authored fields after one `commas_get_dispute` call, plus a live `gmail_search_threads` for communications) → cross-source ("connected apps / across my") chain over Fathom→Zoom→Gmail→CRM→Calendar → global "disputes" portfolio via `commas_list_disputes` → multi-source dispute investigation chain (`commas_get_dispute` → `crm_get_contact` → `gmail_search_threads` → `fathom_search_calls` → `zoom_list_meetings`, synthesised into `### Situation summary / What I found / My read / Recommendation / Missing information`) → greeting → mark-ready write → `txn_…` id lookup → sales/revenue summary (`fanbasis_list_transactions`, unfiltered returns `MONTH_SUMMARY`) → "respond/reply" and customer lookups (`fanbasis_list_customers`, email/name extraction, pronoun follow-ups resolved via `findRecentEmail(history)`) → "source X isn't connected" reply → product-voice fallback. Every fact in every answer traces to a mock-data field; nothing is generated.

### 7.4 What the UI sees

`ProgressStep { id, sourceId, classification, label }` (safe registry labels — never tool names), `ToolSummaryItem { sourceId, label, ok }`, final `answer` text, optional `pendingApproval`. No streaming, no model thinking, no raw tool payloads cross the wire.

---

## 8. Current state management

| State | Owner | Persistence | Consumers |
|---|---|---|---|
| `chats`, `sources` (connection state), `credits` | `useChatStore` (React Context) | `localStorage["commas-ai-agent:v2"]` | every chat surface, `SourcesMenu`, `ConnectedAppsModal`, `CreditIndicator` |
| Run state: `runChatId`, `runPhase` (`idle\|running\|awaiting_approval\|done\|cancelled`), `runSteps`, `visibleStepIds`, `pendingApproval` | `useChatStore` | in-memory only (one run at a time, globally) | `ChatMessageList`, `ChatComposer`, `EmptyState` chips |
| `markedReadyDisputeIds` | `useChatStore` | in-memory (session) | `DisputeDetail` badge |
| `view`, `rcView`, `selectedDisputeId`, `panelOpen`, `panelChatId`, `chatPageActiveId` | `App.tsx` `useState` | none (reload → Dashboard) | shell |
| `evidenceByDispute` | `App.tsx` `useState` | none (reseeded from `seedEvidenceItems` each load) | `DisputeDetail` |
| Response draft text, "Draft saved" toast, modal open flags, filter popover values, lightbox | component-local `useState` | none | — |
| Mock Commas dataset (`DISPUTES[].responseStatus`) | `server/mcp/mockCommasServer.ts` module scope | server process memory | `commas_*` tools |

There is no server-side conversation, session, or run store, and no shared cache. The backend is fully stateless apart from the mock write flag.

---

## 9. Mock / demo data

**Two hand-synchronised copies of the dispute world** (ids/amounts/reasons/dates must match; nothing enforces it):

1. `src/lib/disputeData.ts` — what the Resolution Center renders. Five cases:

| # | Customer | Reason | Amount | Status | Story / seeded UI state |
|---|---|---|---|---|---|
| 2481 | Sarah Johnson | Product not received | $499 | Needs response | flagship; 0 evidence; heavy engagement (14 logins, 6/12 lessons, calls) |
| 2502 | Marcus Webb | Product unacceptable | $129 | Needs response | missing evidence; 1 category pre-added |
| 2417 | Elena Cruz | Duplicate charge | $899 | Needs response | evidence ready; 6/6 categories, 3 seeded items with attachments |
| 2455 | David Kim | Product not received | $249 | Needs response | high-risk / uncertain; 1 sparse seeded receipt |
| 2390 | Priya Nair | Product not received | $349 | **Won** | resolved read-only; 4 seeded items, submitted response |

2. `server/mcp/mockCommasServer.ts` — the same 5 disputes with agent-reasoning fields (`scenario`, `likelyReason`, `evidenceCollected/Missing`, `recommendedAction`, `draftResponse`, `uncertaintyNote?`, `resolutionOutcome?`, `communicationsSummary`), 5 customers, 5 transactions (one per customer), and `MONTH_SUMMARY` ($18,420 / 62 transactions / +12% / top products / LAUNCH20 87 redemptions / 3 refunds $960 / 4 open disputes $1,776) so agent answers agree with the Dashboard.

**Connected-source fixtures** — authored **only for Sarah Johnson** (`sarah.johnson@email.com`): Fathom 2 calls (Aug 4 onboarding 42 min, Aug 6 group 55 min), Zoom 2 matching meetings, Google Calendar 2 accepted events, Gmail 1 thread ("Welcome to Pro Coaching Program", 4 messages incl. "Got it, thanks! I'm in now."), GoHighLevel 1 active-client contact. Every other customer returns empty results from every external source.

**Other seeds:** `SOURCES` (6, with Gmail + GoHighLevel `not_connected`), `DEFAULT_ENABLED_SOURCES = ["commas","google-calendar","zoom","fathom"]`, `INITIAL_CREDITS = {300, 0}`, `CREDIT_PACKAGES` (+50/$30, +100/$50, +250/$100), `SEED_CHATS` (2 authored global chats), the three suggestion-chip sets, `buildDisputeContext(id)` / `DASHBOARD_CONTEXT`. Dashboard numbers are hardcoded JSX in `DashboardPage.tsx` / `RevenueModule.tsx`.

The app's implicit "today" is **August 21, 2026** (due-date labels like "Due in 2 days" are static strings computed against that date).

---

## 10. Current connected apps UI

- **Per-chat scoping — `SourcesMenu`** (composer controls button "Sources N"): Notion-style popover listing all 6 sources with brand `SourceIcon`s; connected ones toggle `chat.enabledSources` via a `checkbox-box`; not-connected rows are disabled with a "Not connected" label; "Manage connected apps" opens the modal. **Scoping is real** — it changes the tool set the backend exposes to the agent.
- **Workspace-level — `ConnectedAppsModal`**: solid-white card, one row per source (icon, name, "Primary" tag for Commas, description) with Connect / Disconnect / "Connecting…" spinner. `connectSource` = 900 ms fake delay then `connected`; `disconnectSource` is immediate; Commas cannot be disconnected. No OAuth, no failure states.
- **Empty-state strip**: "Get better answers from your apps" with all six icons, each opening the modal; dismissible per mount.
- **`SourceIcon`**: hand-drawn 24×24 SVG marks in brand colours (Google Calendar "31" tile, Zoom camera, Fathom waveform, Gmail M, GoHighLevel chevrons) + `CommaMark`. Used in progress lines, tool summaries, menus, modal.
- Source list is fixed by product decision (Commas CPO): Commas + Google Calendar, Zoom, Fathom, Gmail, GoHighLevel (internal id `"crm"`). Do not add sources.

---

## 11. Current credits system

- Model: `CreditsState { totalCredits, usedCredits }`; remaining is always derived (`max(0, total − used)`). Fresh workspace 300/300.
- Rule: **exactly 1 credit per `sendMessage()`**, charged synchronously before the network call; approve/decline continuations, tool steps, and write actions cost nothing extra. `sendMessage` hard-refuses at 0 (no fetch). This differs from `ARCHITECTURE.md` §14's backend-metered 1+1/read+5/write design, which was never built — **credits are entirely client-side**.
- UI: `CreditIndicator` pill (Chat header, panel header compact) — accent style normally, warning at ≤ 50 (`LOW_CREDIT_THRESHOLD`), danger at 0; `credits-flash` animation on change; clickable at any balance → `AddCreditsModal` (Lovable-inspired layout rebuilt in Commas tokens: 3 packages, "Buy Credits" → `addCredits(n)` increases `totalCredits` only, "N credits added" toast; **Demo tools** footer: "Set remaining: 50 / 10 / 1 / 0" → `setRemainingCreditsForDemo`, and "Reset all demo data" → `resetDemo()` + reload).
- Exhausted: composer and chips disabled, placeholder "You're out of AI credits", red line with inline "Buy Credits".
- No billing, no server ledger, no real cost.

---

## 12. Existing UI that must be preserved

Everything below is polished, production-referenced Commas UI (or the agent-surface language built to match it) and must survive the assistant implementation unchanged in look and feel. Behavior may be *extended* behind the same components; the components themselves should not be replaced with generic framework UI.

**Design system (`src/index.css`):** the `@theme` tokens (text/neutral/brand/semantic colours, `--color-agent-accent*` purple family, Inter/Geist fonts) and the shared recipes — `app-shell-bg`, `glass-card`, `main-surface`, `content-card`, `btn-dark`, `btn-secondary`, `btn-blue`, `btn-toolbar`, `filter-pill`, `toolbar-search`, `textarea-shell`, `detail-row`, `popover-card`, `checkbox-box`, `composer-shell`, `chat-bubble-user`, `chat-bubble-agent`, `suggestion-chip`, `progress-dot`, `credits-flash`, `segment-control`, `overview-pill`.

**Shell:** `Sidebar`, `TopNav`, `Badge`, `CommaMark`, `AgentMark`, the padded gradient frame and sibling-panel layout in `App.tsx`, `FloatingAIButton`.

**Dashboard:** `DashboardPage` and all six `components/dashboard/*` (built from production screenshots).

**Resolution Center:** `ResolutionCenter` (tabs, filter pills, popovers, table, per-tab empty states), `DisputeDetail` (header, evidence card, response card incl. disabled Submit, detail cards, read-only resolved variant), `AddEvidenceModal` + `EvidenceUploadArea` (the strongest flow in the app), `FilterPill`, `ReasonPopover`, `SimpleFilterPopover`, `PinwheelIcon`, `CardTitle`.

**Chat surfaces:** `ChatPage` two-column layout, `ChatHistoryList`, `RightPanel` (docked sibling, 380px, header controls), `ChatWorkspace`, `EmptyState` (+ `DisputeSummaryHeader`), `SuggestedCapabilities`, `ChatComposer` (hero + bar variants, Stop button), `ChatMessageList`, `ChatMessageBubble`, `ProgressBlock`, `ToolSummary`, `ApprovalCard`, `ContextChip`, `SourcesMenu`, `ConnectedAppsModal`, `SourceIcon`, `CreditIndicator`, `AddCreditsModal`, `liteMarkdown` rendering style.

**Product copy/decisions:** user-facing "Sources" / "Connected apps" (never MCP/tool jargon), "GoHighLevel" (never "CRM") in UI strings, the six-source list, "Submit response" stays simulated, resolved disputes stay read-only with no AI entry point, no model reasoning / raw tool names / raw payloads ever shown.

---

## 13. Known incomplete functionality (as of `main` @ `c3a250c`)

**AI / backend**
1. **No live LLM call has ever been made.** `AnthropicLlmClient` is complete but unexercised; all behavior observed to date is the scripted `StubLlmClient`. First real-model run will surface prompt-quality and tool-schema issues nobody has seen yet.
2. **No streaming.** Single synchronous response; long investigations show "Thinking…" until the whole loop completes; `ARCHITECTURE.md` §9 SSE contract unbuilt.
3. **No server-side conversation/session state.** Memory = last 20 message texts resent by the client; earlier turns' tool results are forgotten; nothing persists on the server; no run ids, no cancellation on the server (client just abandons the fetch).
4. **Iteration cap is 6** (spec said 12); no wall-clock run timeout; no approval auto-decline timeout.
5. **One write tool** (`commas_mark_dispute_response_ready`, simulated). None of the platform's real write actions (charge, refund, discount CRUD, subscription changes) exist.
6. **7 of the 11 documented `fanbasis_*` read tools are missing** (discount codes, checkout sessions, subscribers, payment methods…). Customers/transactions tools are thin (search/filter only).
7. **Connected-source data exists only for Sarah Johnson**; the multi-source investigation story is empty for the other four disputes.
8. **The agent cannot see seller-uploaded evidence** (`evidenceByDispute` never reaches `PageContext`), cannot add evidence to the Resolution Center, cannot draft into the response box, and cannot reference the manual checklist state (only the coarse `evidenceStatus`).
9. **No agent-driven Resolution Center actions** beyond the mark-ready flag; no proposal → review → approve → attach loop; `addedBy: "ai"` is a dead type value.
10. **Real Commas MCP mode** (`connectReal`) tested only against an unreachable address; the real server has no dispute tools, so the flagship flow is mock-only by platform limitation (no disputes API / evidence-submission API exists).
11. **`AnthropicLlmClient` handles one tool_use per response** and discards text emitted alongside tool calls; no prompt caching, no token/cost accounting.

**Frontend**
12. No URL routing — reload always lands on the Dashboard; panel/chat selection is not deep-linkable.
13. Resolution Center filters, search, Export, Status pill: visual only. Dashboard D/W/M/Y toggle, Overview controls, Announcements carousel, chart tooltips: visual only. Billing/Growth/Wallet/TopNav/settings: dead.
14. Response draft textarea is not persisted (Save draft is a toast); Submit is permanently disabled.
15. Session-added evidence does not survive reload; files never leave the browser; seeded image attachments are placeholder SVGs.
16. Chat history has no timestamps, rename, search, or pin; delete is hover-only; no message edit/regenerate; no touch/mobile layout (panel overlays below `lg`, nothing verified below 800px).
17. Composer placeholder is "Ask about your business…" even in dispute chats (audit P2-6).
18. Panel width (380px) is cramped for structured answers (audit P2-7).
19. `sources` connection state persists in localStorage, but connect/disconnect is a fake timer with no failure states.

**Repo hygiene / docs**
20. `README.md` still says "Scaffolding only. No implementation yet." and `src/agent`, `src/llm`, `src/mcp`, `src/connectors`, `src/context`, `tests/README.md`, `public/README.md` are stale placeholder READMEs — real code lives in `server/`.
21. `docs/ARCHITECTURE.md` / `IMPLEMENTATION_PLAN.md` describe several things that were built differently or not at all (SSE events, backend JSON store, backend-metered credits, tool-runner loop, Google Meet/ClickFunnels sources, Playwright suite, `npm run demo`). `active-context.md` is the accurate record.
22. `server/types.ts` and `src/lib/types.ts` are hand-mirrored with no shared module.
23. No committed Playwright/e2e suite; all UI verification has been ad-hoc. `npm install` reported dev-dependency vulnerabilities in an earlier session (not in the production bundle; not triaged).
24. Git: local only, **no remote**; 22 commits on `main`.

---

## 14. Build / run / test commands and environment

```bash
npm install
npm run dev          # Vite frontend (default :5173; picks the next free port), proxies /api → :8787
npm run dev:server   # Hono agent backend on :8787 (tsx watch)
npm run dev:all      # both, via concurrently
npm run build        # tsc -b && vite build → dist/
npm run typecheck    # tsc -b --noEmit (app + node + server projects)
npm run lint         # eslint .
npm test             # vitest run (94 tests)
```

Environment variables (server only, via `dotenv`; `.env` is gitignored, none exists):

| Variable | Default | Effect |
|---|---|---|
| `ANTHROPIC_API_KEY` | unset | unset → `StubLlmClient`; set → `AnthropicLlmClient` (`GET /api/health.llmMode` reports which) |
| `COMMAS_MCP_MODE` | `mock` | `real` → Streamable HTTP to `COMMAS_MCP_URL` with `x-api-key: COMMAS_API_KEY` (QA sandbox only) |
| `COMMAS_MCP_URL`, `COMMAS_API_KEY` | unset | required together in real mode |
| `PORT` | `8787` | backend port |

No environment variables are read by the browser bundle (verified in an earlier session by grepping `dist/`).

HTTP surface: `GET /api/health`, `GET /api/tools`, `POST /api/agent/run`, `POST /api/agent/approve`.

---

## 15. Architectural observations relevant to the unified-assistant goal

1. **The seams are clean and already exist.** `LlmClient` (one method), `SourceAdapter` (list/call), the registry, and the frontend's `agentApi.ts` are the four boundaries a real assistant needs; none of them require the UI to change. The hard part is what is *behind* them (stub reasoning, statelessness, no streaming), not the UI.
2. **Global chat and dispute chat are already the same system.** One store, one `ChatWorkspace`, one backend route; "context" is a data field on the chat, not a separate code path. A unified agent slots in without a second surface — the risk is regressing the context rules (`App.tsx` panel binding, `ChatHistoryList` filtering) that were hard-won.
3. **The stub encodes the demo script.** Seven dispute chips, five global chips, and four dashboard chips each map to a specific stub branch with authored answers, and 94 tests lock much of that in (`tests/server/disputeIntents.test.ts`, `runtime.test.ts`). Replacing the stub with a real model means either keeping the stub as the no-key fallback (so tests stay green) or rewriting those tests around behavior rather than exact strings.
4. **Memory is the weakest link for "persistent context".** Only text history travels; tool results, findings, and proposals from prior turns are lost, and nothing is keyed by dispute or user server-side. Any real investigation loop needs a server-side session/thread concept the current API has no slot for.
5. **The Resolution Center is a one-way street today.** The agent reads the dispute (via `PageContext.dispute` and `commas_get_dispute`) but has no channel back into the page except a boolean badge. "Human-approved Resolution Center actions" needs a proposal/decision model and executors that call the existing `onAddEvidence` / response-setter paths — `App.tsx` already lifts the state those would mutate.
6. **Dispute data is duplicated across three places** (`disputeData.ts`, `mockCommasServer.ts`, `buildDisputeContext`) and connected-source data lives inline in five adapter/server files, all Sarah-only. A unified tool layer will want one server-side dataset that every adapter and every context builder reads.
7. **The credit system is client-side and message-based**, which is fine for a prototype but means a longer-running real agent has no cost signal; keep the 1-credit rule and the UI, meter nothing new until the real model's behavior is known.
8. **`AnthropicLlmClient` is the only untested component in the pipeline**, and it is the one the goal depends on. Wiring a key and observing the first real turn is the single highest-information step available.
