# Commas AI Agent — Active Context

**Last updated:** 2026-08-21 · **Updated by:** Claude (UI foundation implementation session)

> **UI foundation is now implemented.** The app runs (`npm run dev`), typechecks, lints, and
> has a passing test suite. This is chat/agent **UI only** — see "What Remains Mocked" below.
> No backend, agent loop, or MCP exists yet.

> **Specification set now exists:** `PROTOTYPE_SPEC.md` (product + UX + agent behavior +
> demo flows), `ARCHITECTURE.md` (system design + event contract + request/response loop),
> `IMPLEMENTATION_PLAN.md` (Phases 0–6 with acceptance criteria and tests). Those three are
> the working spec; this file tracks state and decisions.

> **Read this file first in any new session.** It is the persistent source of truth for this
> repository. Update it after any meaningful implementation work. Everything below is labeled
> as CONFIRMED (verified against the repo, the old prototype, or commasdocs.com on 2026-08-21)
> or as assumption/unknown. Do not build on the unknowns without resolving them.

---

# Current Objective

Build a standalone prototype exploring what a **native AI agent experience inside Commas**
could look and behave like: a chat-first agent that performs multi-step tool use and reasoning
over Commas data (and connected external sources) until it reaches a satisfactory result,
exposing only safe user-facing progress — never chain-of-thought.

Conceptual runtime loop:

```
User
→ Commas AI Agent (our orchestration layer)
→ LLM
→ MCP client
→ Commas MCP server / external MCP servers
→ tool result
→ LLM
→ next tool call … or final answer
```

The flagship contextual experience is **Resolution Center**: the AI helps a seller investigate
and resolve a payment dispute using information from Commas and connected sources.

This repo is NEW and separate from `../commas-ai-copilot` (the earlier UI-only demo). That repo
is **reference material only** — do not modify it, and do not assume its architecture (scripted
fake AI, no backend) carries over here.

# Product Scope

What the prototype must demonstrate:

1. A real (not scripted) agent loop: LLM-driven multi-step tool selection over MCP tools, with
   live, safe progress streaming to the UI.
2. A chat-first UX woven through the Commas product surface (left-nav chat, side panel,
   floating button, contextual page-level AI) rather than a separate AI destination.
3. Connector/source management (Notion-AI-style) and contextual suggested actions
   (Claude-Desktop-style).
4. The Resolution Center dispute-investigation flow end to end.
5. AI/chat credits as a product concept (metering UI; billing itself mocked).

Out of scope: real submission of dispute evidence (not even possible via API — see Risks),
real money movement, multi-tenant auth, production hardening.

# Architecture

## Terminology (applies throughout)

- **MCP server** = the side that *exposes* tools/data (Commas operates one; external services
  would each be one).
- **MCP client** = the side that *calls* those tools (our agent backend — or Anthropic's API
  acting on our behalf via the MCP connector).

## Intended architecture (adopted into `ARCHITECTURE.md`, 2026-08-21 — that file is now the
authoritative, more detailed version of this sketch)

```
┌──────────────────────────── Browser (React UI) ────────────────────────────┐
│  Commas app shell · chat surfaces · Resolution Center · connector picker   │
└──────────────┬─────────────────────────────────────────────────────────────┘
               │ HTTP + SSE (safe progress events only)
┌──────────────▼──────────────── Node/TS backend ────────────────────────────┐
│  "Commas AI Agent" orchestration layer                                     │
│   · agent loop: Anthropic TS SDK (@anthropic-ai/sdk)                       │
│   · model: claude-opus-5, adaptive thinking                                │
│   · MCP client → tool dispatch                                             │
│   · progress mapper: tool events → user-safe status lines (never CoT)     │
│   · credits metering, chat session store                                   │
└───────┬──────────────────────────────┬─────────────────────────────────────┘
        │                              │
┌───────▼──────────────┐   ┌───────────▼───────────────────────────┐
│ Mock Commas MCP      │   │ Mock external MCP servers/connectors  │
│ server (in-process): │   │ Fathom · Zoom · Google Meet ·         │
│ fanbasis_* tool      │   │ ClickFunnels (hand-authored data)     │
│ shapes + disputes    │   └───────────────────────────────────────┘
│ mock data            │
└──────────────────────┘
   (config flag can later point at the REAL remote Commas MCP server —
    confirmed to exist, see Integrations — instead of the mock)
```

Why a backend at all: API keys (Anthropic + Commas) cannot ship to the browser; the agent loop,
MCP client, and CoT-filtering must run server-side. This is the single biggest architectural
difference from the old prototype (which was 100% client-side).

## MCP client — two viable mechanisms (decision pending)

1. **Self-hosted MCP client** via `@modelcontextprotocol/sdk` in our backend; tools surfaced to
   the LLM through the Anthropic SDK's tool runner (`client.beta.messages.toolRunner` +
   `betaZodTool`). Most control; works identically against mock and real servers; per-turn
   hooks give us the write-action confirmation gate. **Recommended.**
2. **Anthropic Messages API MCP connector** (beta `mcp-client-2025-11-20`): pass
   `mcp_servers: [{type:"url", url, name}]` plus `tools: [{type:"mcp_toolset",
   mcp_server_name}]` and Anthropic's server acts as the MCP client. Less code, but the MCP
   server must be reachable from Anthropic's infra (fine for the real remote Commas MCP; not
   for an in-process mock), and both halves are required or the request 400s.

Mock-first development pushes toward mechanism 1, with 2 as a later option for "real mode."

# UX

All items below are **requested/confirmed direction from the user (2026-08-21)**; visual
reference screenshots live in `docs/references/`:

- Chat entry in the left navigation; **New Chat**; chat history list.
- A **right-side AI panel** (see `notion-ai-chat-3.png`).
- A **floating AI/chatbot button** when working elsewhere in Commas.
- **Contextual AI inside pages** such as Resolution Center (`resolution-center.png` shows the
  real Commas page to reproduce).
- **Connector/source selection inside the chat composer** (`notion-mcp-2.png`).
- **AI/chat credits** surfaced in the UI.
- **Useful empty state** on a new chat (`notion-ai-chat-2.png`).
- **Contextual suggested actions** similar to Claude Desktop (`claude-desktop.png`).
- **Source/connector management** similar to Notion's AI/MCP settings (`notion-mcp.png`).
- Native Commas look and feel (`commas-dashboard.png`, `commas-integrations.png`); the old
  prototype's shell components are the working reference for this.

Fine-grained layout/interaction decisions within these surfaces are NOT yet made.

# Integrations

## Commas platform — CONFIRMED from commasdocs.com (fetched 2026-08-21)

- **Commas is the rebrand of FanBasis** (changelog, May 2026). API base URL is still
  `https://www.fanbasis.com/public-api`; QA/sandbox base is `https://qa.dev-fan-basis.com`.
  MCP tool names still carry the `fanbasis_` prefix.
- **Auth:** every request sends the seller API key in an `x-api-key` header (found in
  dashboard → Account → API Keys). No OAuth for the public API. Keys carry **granular scopes**
  (`checkout-sessions`, `refunds`, `payments`, `webhooks`, `customers`, `subscriptions`);
  missing scope → 403 naming the scope. A subset of endpoints lives on the Seller v1 API
  (`/api/seller/v1/…`, subscription proration/upgrades).
- **Commas MCP server EXISTS and is real.** Consumption paths documented:
  - Claude Desktop one-click `.mcpb` extension (API key stored in the OS keychain).
  - Manual config via `npx mcp-remote https://hearty-flow-production.up.railway.app/mcp
    --header x-api-key:<KEY>` — i.e., a **deployed Streamable-HTTP remote MCP server** exists
    today (on Railway, not on the branded domain).
  - An official `https://www.fanbasis.com/mcp` endpoint with OAuth (for ChatGPT/Grok) is
    documented as **"Coming Soon"** — explicitly not deployed yet.
- **MCP read tools (11 documented):** `fanbasis_list_products`, `fanbasis_list_customers`,
  `fanbasis_list_transactions`, `fanbasis_get_transaction`, `fanbasis_list_subscribers`,
  `fanbasis_get_checkout_session`, `fanbasis_get_session_transactions`,
  `fanbasis_get_session_subscriptions`, `fanbasis_list_discount_codes`,
  `fanbasis_get_discount_code`, `fanbasis_get_payment_methods`.
- **MCP write actions exist** (charge a customer, create/update/delete discount codes,
  extend/cancel subscriptions, refunds) and are "gated behind an explicit confirmation step."
  Docs are inconsistent on totals — "11 built-in tools," "30+ built-in tools," and the CLI's
  "27 tools available" all appear. Treat the 11 read tools as the confirmed floor; the exact
  write-tool list is **unknown**.
- **CLI:** `npm install -g commas-cli`, `commas login`, `--json` and `--yes` flags explicitly
  "built for AI agents," sandbox env switching, `commas tools` / `commas call <tool>` escape
  hatch. Full command table in the docs.
- **Webhooks:** 14 event types including `dispute.created` and `dispute.updated` with a full
  documented payload (dispute hashid, `status`, `reason`, `amount`/`dispute_fee`/`total_amount`
  in dollars, `due_by` deadline, customer id/name/email, `organization_id`). Delivery is
  **at-most-once and never retried**.
- **Dispute lifecycle statuses:** `needs_response → under_review → won | lost | lost_rdr`,
  plus `warning_needs_response` / `warning_closed` (Ethoca-style early warnings). Evidence
  requirements per dispute reason are documented (fraud / not-received / not-as-described).

## Critical CONFIRMED gap

- **There is NO REST endpoint to list or fetch disputes, no MCP dispute tool, and no API to
  submit dispute evidence.** Evidence is submitted "through your Commas dashboard" only;
  dispute data reaches integrators only via the two webhooks. The flagship Resolution Center
  scenario therefore **cannot run against real Commas dispute data** — dispute records must be
  mocked (or webhook-ingested, which is out of prototype scope).

## External integrations (Fathom, Zoom, Google Meet, ClickFunnels)

Candidate sources named by the user. **Nothing about them is confirmed** — no MCP servers,
APIs, or auth flows were investigated. For this prototype they will be mocked connectors.
(Context: the Commas CPO floated exactly this connect-external-sources idea for off-platform
fulfillment — see `../commas-ai-copilot/active-context.md` §5.)

# UI Foundation Pass (2026-08-21)

Implemented per explicit instruction: **UI only** — "Do not implement the real Agent yet. Do
not implement MCP yet." Everything agent-shaped is a scripted stand-in.

## What was built

- **Left nav Chat entry** (`Sidebar.tsx`) alongside Home and Resolution Center.
- **New Chat + chat history**, grouped Today/Yesterday/Earlier, with delete
  (`ChatHistoryList.tsx`).
- **Standalone chat workspace** (`ChatPage.tsx`, `ChatWorkspace.tsx`, `ChatMessageList.tsx`,
  `ChatMessageBubble.tsx`) — resumes the last conversation on nav, not always-empty.
- **Right-side AI panel** (`RightPanel.tsx`) — docks beside page content (not an overlay),
  shows a page-context chip, has a "switch to full Chat view" control.
- **Floating AI button** (`FloatingAIButton.tsx`) — opens the panel with the current page's
  context attached; hidden while the panel is open.
- **Chat composer** (`ChatComposer.tsx`) — hero variant (empty state) and bar variant
  (in-conversation), Enter-to-send, Stop button during a run.
- **Connector/source selector** — per-chat scoping in the composer's controls menu
  (`SourcesMenu.tsx`) plus a workspace-level "Connected apps" management modal
  (`ConnectedAppsModal.tsx`) with simulated connect/disconnect.
- **AI credit indicator** (`CreditIndicator.tsx`) — balance pill in both the Chat page header
  and the right-panel header, flashes on change, exhausted state + demo reset.
- **Empty state** (`EmptyState.tsx`) — Claude-Desktop-inspired greeting + centered composer +
  dismissible "connect your apps" strip.
- **Suggested capabilities** (`SuggestedCapabilities.tsx`) — global set + dispute-specific set
  swapped in automatically when the chat has dispute context.
- **Simulated agent progress** (`ProgressBlock.tsx`, `ToolSummary.tsx`) — sequential
  "Checking transaction history…" style lines with source icons, collapsing into "Checked N
  sources" after the answer — previews the real event contract in ARCHITECTURE.md §9 without
  implementing it.
- Both required contexts work: **standalone chat** (`/` → Chat nav) and **contextual AI**
  opened from another page (Resolution Center's "Investigate with AI" → right panel with a
  `Dispute #2481` context chip and dispute-specific suggestions).
- Minimal `DashboardPage.tsx` and `ResolutionCenterPage.tsx` placeholders — just enough
  Commas-native surface to host and prove the contextual-AI entry points; not full pages.

## Files / components created

```
package.json, vite.config.ts, tsconfig*.json, index.html, eslint.config.js  (scaffold)
src/index.css                                                              (ported design tokens + new agent/chat utilities)
src/main.tsx, src/App.tsx                                                  (routing/state wiring)
src/lib/types.ts, mockData.ts, mockEngine.ts, liteMarkdown.tsx             (mock domain + scripted engine)
src/hooks/useChatStore.tsx                                                 (shared chat/sources/credits state + run playback)
src/components/shell/CommaMark.tsx, AgentMark.tsx, Sidebar.tsx, TopNav.tsx, Badge.tsx
src/components/chat/SourceIcon.tsx, CreditIndicator.tsx, ContextChip.tsx, ProgressBlock.tsx,
  ToolSummary.tsx, ChatMessageBubble.tsx, ChatMessageList.tsx, SourcesMenu.tsx,
  ConnectedAppsModal.tsx, ChatComposer.tsx, SuggestedCapabilities.tsx, EmptyState.tsx,
  ChatWorkspace.tsx, ChatHistoryList.tsx, RightPanel.tsx, FloatingAIButton.tsx
src/pages/DashboardPage.tsx, ResolutionCenterPage.tsx, ChatPage.tsx
tests/setup.ts, mockEngine.test.ts, Sidebar.test.tsx, ChatFlow.test.tsx
```

Reused from `../commas-ai-copilot` (ported, not imported cross-repo, per Confirmed Technical
Decisions): the `index.css` design tokens, `CommaMark`, `Sidebar`/`TopNav` structure, `Badge`.

**Directory structure note:** the original scaffold's `src/chat/` and `src/ui/` placeholder
folders were removed — real UI code lives in conventional `src/components/`, `src/pages/`,
`src/hooks/`, `src/lib/` instead, which is clearer for a frontend-only pass. The other
scaffold placeholders (`src/agent/`, `src/llm/`, `src/mcp/`, `src/connectors/`,
`src/context/`) are left as-is for the future backend (Phases 2–3) — don't recreate
`src/chat/` or `src/ui/` without updating this note.

## What remains mocked (do not mistake for real)

- **`src/lib/mockEngine.ts`** is the entire "agent" — a `planMockRun()` function that
  keyword-matches the prompt (word-boundary regex, fixed after a test caught "hi" matching
  inside "this"/"which") against ~6 canned scenarios and returns a fixed step list + answer.
  No LLM call, no reasoning, no real tool execution.
- **`src/hooks/useChatStore.tsx`** plays that plan back with `setTimeout`s to simulate
  streaming/progress — this stands in for the SSE event stream in ARCHITECTURE.md §9, but
  is 100% client-side with no backend.
- **All five sources' data** (Commas, Fathom, Zoom, Google Meet, ClickFunnels) is hard-coded
  in `mockData.ts` / inline in `mockEngine.ts` — same Sarah Johnson / Dispute #2481 scenario
  as the old prototype, extended, not yet reconciled line-by-line with it.
- **Connect/disconnect** in `ConnectedAppsModal` is a fake 900ms delay, no OAuth.
- **Credits** deduct via a hardcoded formula in the store (1/message + 1/step) — matches
  ARCHITECTURE.md §14's read-cost numbers but has no write-cost path since no write tool
  exists yet.
- **No write actions or approval cards exist.** The mock engine only performs reads; spec
  §4.5–4.6 (write approval) is entirely unbuilt.
- **Persistence is in-memory only** (React Context) — refreshing the page resets everything
  to the seed data.

## Known issues

- No responsive/mobile layout — `Sidebar` hides below 900px, `RightPanel` hides below 1024px
  (Tailwind `lg:`), matching the reference screenshots' desktop-only scope but not tested or
  designed for narrower viewports.
- `resetDemo()` restores seed data wholesale, discarding any chats created during the demo
  session — intentional for a demo reset control, but worth knowing before relying on it
  mid-demo.
- `npm install` reported 5 dev-dependency vulnerabilities (3 moderate, 1 high, 1 critical) —
  not investigated or fixed this session; none are in the production bundle (build output is
  188KB JS / 27KB CSS, no dev tooling shipped), but should be triaged before this repo is
  made public or a remote is added.
- No committed Playwright e2e suite yet — visual verification this session used an ad-hoc
  script (`node` + `playwright`) run from job scratch space, not saved into the repo.
- `ChatHistoryList` delete affordance is hover-only (no touch-friendly alternative) —
  acceptable for a desktop-only prototype pass, flagged for later.

# Current Repository State

- `docs/` — full spec set (`PROTOTYPE_SPEC.md`, `ARCHITECTURE.md`, `IMPLEMENTATION_PLAN.md`,
  this file) + `docs/references/` (10 UX screenshots).
- **A real, running Vite + React 18 + TypeScript + Tailwind v4 app** implementing the chat/
  agent UI foundation (see "UI Foundation Pass" below for the full file list). No backend —
  everything is client-side React state + a scripted mock engine standing in for the real
  agent loop.
- `tests/` — Vitest unit/integration tests (10 passing): `mockEngine.test.ts`,
  `Sidebar.test.tsx`, `ChatFlow.test.tsx`, `setup.ts`. No Playwright e2e suite committed yet
  (IMPLEMENTATION_PLAN.md Phase 4's acceptance criteria calls for one — see Not Implemented).
- `package.json` now has real dependencies (React, Vite, Tailwind v4, lucide-react, Vitest,
  Testing Library, ESLint) and working `dev`/`build`/`typecheck`/`lint`/`test` scripts.
- Git: local repo on `main`, **no remote**.

# Completed

- Repo scaffold + reference screenshots (committed).
- Technical reconnaissance of commasdocs.com, the old prototype, and this repo (verified by
  direct fetch/inspection on 2026-08-21; findings recorded in this file).
- Full specification set: `PROTOTYPE_SPEC.md`, `ARCHITECTURE.md`, `IMPLEMENTATION_PLAN.md`.
- **UI foundation implementation** (2026-08-21) — see the dedicated section below. Verified:
  `npm run typecheck`, `npm run lint`, `npm test` (10/10), and `npm run build` all pass;
  the app was run in a real headless-Chromium browser and visually inspected across all
  required surfaces with zero console errors.

# In Progress

- Nothing. **Next up:** replace the mock engine with the real backend + agent loop + MCP
  client (`IMPLEMENTATION_PLAN.md` Phases 2–3), and/or the full Resolution Center port
  (Phase 1) — see "Next Step" below for the recommended order.

# Not Implemented

- **Backend, agent loop, LLM calls, MCP client, mock or real MCP servers.** Everything
  agent-shaped in the UI is driven by `src/lib/mockEngine.ts`, a pattern-matched script — see
  "What Remains Mocked."
- **Full Resolution Center** (list/filters/evidence-copilot port from `commas-ai-copilot`) —
  `ResolutionCenterPage.tsx` is a deliberately minimal placeholder (one dispute card), not
  the full page. IMPLEMENTATION_PLAN.md Phase 1.
- **Write-action / approval-card flow** (spec §4.5–4.6) — the mock engine only performs
  reads; no write tool, no approval card UI exists yet.
- **Persistence** — chat/credits/sources state lives only in React context; a page reload
  loses everything (ARCHITECTURE.md §10's JSON-snapshot store isn't built).
- **Playwright e2e suite** committed to the repo (Phase 4's acceptance criteria). This
  session's visual verification used an ad-hoc Playwright script run from scratch space, not
  a committed test.
- Real LLM/MCP "real mode," authentication, deployment — unchanged from before, still Phase
  3+/deferred.

# Confirmed Technical Decisions

- **Language:** TypeScript end to end.
- **What can be reused from `../commas-ai-copilot`** (copy/adapt as reference, never import
  across repos): the Commas visual shell (`Sidebar.tsx`, `TopNav.tsx`, `ResolutionCenter.tsx`,
  `DisputeDetail.tsx`, `FilterPill`/popovers, `Badge`, icon components), Tailwind v4 + Vite
  setup, the internally-consistent dispute mock dataset (`mockData.ts`, 304 lines), and the
  Playwright e2e approach. **What must NOT be reused:** its architecture — scripted fake AI,
  all state in `App.tsx`, no backend.
- **Recon method decisions:** commasdocs.com is a single-page JS-rendered site — WebFetch
  truncates it; fetch raw HTML via curl and extract (content is embedded in script payloads).

Decisions adopted into the specification set (2026-08-21; defaults chosen by Claude where
the user hadn't answered — flagged in Open Questions where an override is still possible):

- **Frontend:** React 18 + Vite + Tailwind v4 + `lucide-react` (visual reuse from old repo) —
  **implemented and running**, not just decided. State management is React Context
  (`ChatStoreProvider`), no external state library — sufficient for the UI-only pass; revisit
  if backend integration (Phase 3) makes the context provider awkward.
- **Backend:** Node 20+ / TypeScript / **Hono**, REST + SSE, single process.
- **LLM:** `@anthropic-ai/sdk`, model `claude-opus-5`, adaptive thinking, SDK beta
  tool-runner loop (manual loop as documented fallback), streaming; **real LLM calls**
  in demo mode, **scripted LLM stub** in all automated tests.
- **MCP:** `@modelcontextprotocol/sdk` self-hosted client; in-process mock MCP servers
  (Commas + fathom/zoom/google-meet/clickfunnels); mock-first, with a guarded real-mode
  config path (`COMMAS_MCP_MODE=real` + `COMMAS_ALLOW_REAL=1`, QA sandbox key only) that no
  phase builds UI for.
- **Mock dispute tools are namespaced `commas_*`** (not `fanbasis_*`) because they have no
  real-platform equivalent — never blur that line.
- **Persistence:** in-memory store + JSON file snapshot (`data/state.json`, gitignored),
  behind a `ChatStore` interface.
- **Credits pricing:** 1/message + 1/read call + 5/write call, backend-metered.
- **Safety rails:** server-side write-approval gate, iteration cap (12 rounds), run
  timeout, approval auto-decline after 10 min, unknown tools classified `write`.
- **Terminology:** user-facing = "Sources" / "Connected apps"; MCP terms only in
  engineering docs.
- **Event contract:** the SSE vocabulary in `ARCHITECTURE.md` §9; no CoT, raw prompts, raw
  payloads, or internal tool names ever cross it.
- **Testing:** Vitest (unit/integration, stub LLM) + Playwright (e2e, visual baselines);
  live-model verification via a manual smoke script only.

# Open Questions

1. **Real LLM calls** are now baked into the spec (demo mode) — still needs the user to
   supply `ANTHROPIC_API_KEY` and accept per-demo cost before Phase 3's live smoke test.
   Automated tests never need it.
2. **Real Commas MCP mode** is specced as guarded-optional and deferred; only becomes
   actionable if the user supplies a QA sandbox key.
3. **GitHub:** create a remote for this repo? (None exists; old repo is public.) Ask before
   pushing.
4. Exact write-tool list of the real Commas MCP server (docs inconsistent: 11 vs 27 vs 30+).
   Mock write tools follow the documented write *actions*; reconcile if real mode is used.
5. Whether Commas plans an in-app agent surface of their own (interview said yes, per-org
   sandboxed agents + credits) — relevant for framing, unknowable from docs.

Resolved since recon (defaults adopted into the specs; user may still override): chat
persistence (in-memory + JSON snapshot), loop mechanism (tool runner), Hono over Express,
stub-LLM testing strategy, credits pricing, `commas_*` namespacing for mock dispute tools.

# Risks / Blockers

- **[Blocker-shaped] No disputes API/MCP/evidence-submission API.** The flagship scenario can
  only be demonstrated on mock dispute data, and "submit response" must stay simulated. This
  is now a *confirmed* platform limitation, not a prototype shortcut.
- **Remote MCP endpoint fragility:** the only live endpoint is an unbranded Railway URL found
  in the docs' config generator; the official `/mcp` + OAuth endpoint is unreleased. Real-mode
  demos could break without notice.
- **Write tools move real money** (charges, refunds, cancellations). Any real-mode testing
  must use the QA sandbox base URL and a sandbox key, never production.
- **Webhook delivery is at-most-once, never retried** — any future real dispute ingestion
  needs API reconciliation, which… doesn't exist for disputes. Circular gap.
- **CoT safety:** the UI must render only tool-level progress ("Checking transaction history…"),
  never model reasoning. Anthropic's current models default to omitted thinking text, which
  helps, but the progress mapper is still our responsibility.
- **Docs internal inconsistencies** (tool counts; Seller v1 auth shown as both `x-api-key` and
  Bearer). Verify against the live server before relying on either.
- **Rebrand residue:** `fanbasis_*` names and `fanbasis.com` URLs are the real identifiers;
  don't "clean them up" to `commas_*` in mock tools if fidelity to the real server matters.

# Next Steps

The build order lives in `IMPLEMENTATION_PLAN.md` (Phases 0–6). This session delivered the
frontend half of Phase 0 plus most of Phase 4's UI surface **ahead of schedule and with mocks
in place of Phases 2–3**, per this session's explicit "UI only, no agent, no MCP yet"
instruction. Concretely still open from the plan:

1. **Phase 0 (remainder):** no backend exists yet — no Hono server, no SSE, no shared types
   package with a server side to share with.
2. **Phase 1 (remainder):** `ResolutionCenterPage.tsx` is a placeholder, not the full port
   (list, filters, evidence copilot) from `commas-ai-copilot`.
3. **Phase 2:** no mock MCP servers exist — `mockEngine.ts` fakes their effect without the
   MCP protocol, tool registry, or five actual servers described in ARCHITECTURE.md §7–8.
4. **Phase 3:** no agent runtime, no LLM calls, no real event stream — `useChatStore.tsx`'s
   `setTimeout` playback stands in for all of it.
5. **Phase 4 (remainder):** no write/approval-card flow; no committed Playwright e2e suite.

**Recommended next step:** build Phase 2 (mock MCP servers + tool registry) and Phase 3
(agent runtime, wired to the *same* `useChatStore` UI surface built this session) so the real
architecture replaces the mock engine without a UI rewrite — the components were built
against the `Chat`/`ProgressStep`/`ToolSummaryItem` shapes in `src/lib/types.ts`, which
already mirror ARCHITECTURE.md's real types. Obtain `ANTHROPIC_API_KEY` from the user before
Phase 3's live smoke test (Open Question 1 — still unresolved).

# Session Handoff

Future Claude Code sessions must:

1. **Read this file first, in full**, before meaningful work; verify specific claims against
   the repo/docs only as needed rather than re-deriving everything.
2. **Update this file after meaningful implementation** — move items between
   Completed / In Progress / Not Implemented, record new decisions, resolve or add Open
   Questions. Nothing goes in Completed without being actually verified (run/tested).
3. Treat `../commas-ai-copilot` as read-only reference. Its own `active-context.md` holds the
   product/interview background — but its architecture is explicitly NOT the template for this repo.
4. Never put API keys in the repo; environment variables only. Real Commas calls (if ever
   enabled) use the QA sandbox.
5. Do not create a GitHub remote or push without asking (Open Question 4).
6. Do not present unconfirmed capabilities as real: anything not in the CONFIRMED sections
   above is an assumption — say so.
7. The commasdocs.com fetch method that works is documented under Confirmed Technical
   Decisions (curl the raw HTML; content is inside script payloads).
