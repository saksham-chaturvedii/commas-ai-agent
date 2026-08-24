# Commas AI Agent — Active Context

**Last updated:** 2026-08-25 · **Updated by:** Claude (Production deployment + Evidence UI overhaul: source-reference chips, review-state removal)

> **The prototype is now live in production, password-protected, at a real custom domain, on
> a genuinely free LLM.** Deployed to Vercel at **addmorecommas.com** behind HTTP Basic Auth
> (password `,,,`). The LLM provider chain is `ANTHROPIC_API_KEY` > `OPENROUTER_KEY` >
> `GEMINI_API_KEY` > deterministic stub; **OpenRouter is what's actually live** (model
> `nvidia/nemotron-3-super-120b-a12b:free`, after two other free models were found retired/
> congested), because Anthropic and Gemini were either unavailable or too rate-limited for a
> demo. See "Production Deployment" below for the full account, including two live-breaking
> bugs this pass caught and fixed (an em-dash in the auth header, a Vercel catch-all routing
> gap). The repo also moved to a **private GitHub remote** this pass — Open Question 3 (no
> remote existed) is resolved.

> **The Resolution Center evidence experience was substantially reworked**: source provenance
> is now a connector-agnostic chip component (no more per-connector hardcoding, no more
> "Inspect underlying source" text), and the evidence review/approval state (`verifiedByHuman`,
> "Mark as reviewed", "AI found" badge on added items) was removed entirely in favor of a
> single Edit/Delete lifecycle via a 3-dot row menu. See "Evidence UI Overhaul" below for the
> full account. 231/231 tests pass; typecheck/lint/build all clean; verified live in production
> via API health checks (browser automation wasn't available for this project this session).

> **The PRODUCT_READINESS_AUDIT.md P0/P1 recommendations are implemented** (see "Audit
> Implementation Pass" below): all 8 P0 answer-quality/rendering defects fixed, Phase-2 state
> hygiene (stale panels, busy-guard, interrupted-run reconciliation, product-voice errors,
> v2 storage key), Phase-3 story completeness (Elena/David seed evidence, communications
> intent, mark-ready badge, context-chat history row), plus the connected-apps requirement:
> recognizable brand-colored icons and CRM → **GoHighLevel** everywhere user-facing. 94/94
> tests pass; a 20-check live browser walkthrough of the 12 required flows passed with zero
> console errors. Deliberately skipped audit items are recorded at the end of that section.

> **Resolved disputes are now strictly read-only, and a real bug in the dispute AI panel's
> session handling is fixed.** See "Resolved Disputes Are Read-Only" and "Dispute AI Session
> Identity" below. The second one caught and fixed a genuine React state-timing bug in
> `useChatStore.tsx`'s `createChat()` — the same bug class as the Evidence Upload fix below —
> that made the dispute AI panel render nothing at all after starting a new session post-
> deletion. 82/82 tests pass (was 79); verified live across every case the task specified.
> **Follow-up same day:** per direct user feedback on the live result, "Investigate with AI" is
> now hidden entirely on resolved disputes (an earlier pass had deliberately kept it enabled —
> see the amended note in "Resolved Disputes Are Read-Only" above).

> **The "Add evidence" flow now supports real (mocked) file uploads** — multi-file selection,
> drag & drop, client-side validation, a simulated Selected→Uploading→Processing→Ready
> pipeline, image thumbnails/lightbox, and a review-before-submit step. See "Evidence File
> Upload" below. 79/79 tests pass (was 70); verified live in a browser across all 10 scenarios
> the task specified, including catching and fixing a real bug (files getting stuck
> mid-pipeline) during that testing.

> **Resolution Center now has 5 realistic dispute cases with deterministic Agent answers, and
> the chat credit system was rebuilt into a real total/used/remaining model with a mock
> purchase flow.** See "Resolution Center Demo-Readiness" and "Chat Credit System" below for
> the full account. 70/70 tests pass (was 48; +22 net this session); verified live in a
> browser — all 5 dispute cases × all 5 demo-script questions, the hidden pipeline-test phrase,
> and all 6 credit scenarios (A–F) from the task — zero console errors.

> **Two small polish fixes from the prior session:** the Chat sidebar's redundant "+" button
> (duplicate of "New chat") is removed — see "Chat Sidebar Cleanup" below — and the Connected
> apps modal no longer lets page content bleed through it (was using the shared `main-surface`
> class's 88%-opacity background, now solid white for that modal only).

> **The Dashboard has been rebuilt against real Commas production screenshots** (not invented,
> not ported from `commas-ai-copilot` — that repo has no Dashboard). See "Dashboard Visual
> Fidelity Pass" below for the full account: components built, what's faithfully reproduced vs.
> intentionally adapted for narrative coherence with Resolution Center, and what's still
> visually approximate. Resolution Center and the AI Agent were verified untouched. 48/48 tests
> pass, 0 console errors across a full click-through (Dashboard → AI panel → Resolution Center
> → Dispute Detail → contextual AI panel).

> **Persistent multi-turn conversations, a real multi-source adapter layer, and a write/
> approval flow now exist.** See "Conversation System, Source Adapters & Write-Approval Flow"
> below for the full account of this session — including what was explicitly requested but
> NOT attempted (the stabilization audit and the visual polish pass; see that section's closing
> note). 48/48 tests pass; verified live in a browser (multi-turn memory, reload persistence,
> multi-source dispute investigation, write approval, source scoping, insufficient credits —
> 0 console errors).

> **A real agent backend now exists.** User → Agent → LLM → MCP client → Commas MCP server →
> tool result → LLM → final answer is implemented and tested end-to-end (see "Commas Tool
> Layer" below) — not just designed. The chat UI calls it over `POST /api/agent/run`. The
> MCP connection defaults to an in-process **mock** Commas MCP server (real MCP protocol,
> mock data) because no Commas credentials are available in this environment; the LLM
> defaults to a **deterministic stub** because no `ANTHROPIC_API_KEY` is available — both are
> swappable for the real thing via env vars with no code changes.

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

- ~~No responsive/mobile layout~~ **Superseded by the UI Review Fix Pass below:** `Sidebar` no
  longer hides at any width and `RightPanel` now overlays (instead of vanishing) below
  `lg`. Still no true mobile/touch layout — this only fixes the dead-end/no-nav failure
  modes at tablet-ish widths (800–1023px); phone-width layouts remain untested.
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

# UI Review Fix Pass (2026-08-21)

A visual review of the UI Foundation Pass against the Notion AI / Claude Desktop / Commas
reference screenshots (`docs/references/`) found 1 P0 and 6 P1 issues. All were fixed this
session; no P2 (polish) items were touched, and no unrelated parts were redesigned.

## Fixes applied

- **P0 — right panel dead end below 1024px.** `RightPanel.tsx`'s `<aside>` was `hidden
  lg:flex`, so between 900–1023px the floating AI button hid itself on click and nothing
  appeared — no panel, no way back short of resizing. Fixed by making the aside always
  render and switching to a `max-lg:fixed` overlay (right-docked, `z-40`, drop shadow) below
  the `lg` breakpoint instead of `hidden`. Verified: panel visible and functional at 1000px.
- **P1 — right panel duplicated the Chat view.** Opening the panel then navigating to Chat
  showed two parallel conversations (two composers, two credit pills). `App.tsx` now gates
  `RightPanel`'s `open` prop on `view !== "chat"` and closes the panel via a `useEffect` on
  `view` whenever it becomes `"chat"` (covers Sidebar clicks, not just the panel's own
  "open in full chat" button, which already did this explicitly). Verified: 0 `<aside>`
  elements render on the Chat view.
- **P1 — "New chat" spawned unlimited empty chats.** `useChatStore.tsx`'s `createChat` now
  looks for an existing empty chat with the same context signature (inside the `setChats`
  updater, so it reads current state safely) and reuses it instead of always creating a new
  one; `ChatHistoryList.tsx` also hides empty chats that aren't the active selection, as a
  second guard. Verified: 3 rapid "New chat" clicks produce exactly one chat row.
- **P1 — source-toggle checkboxes had no checkmark.** `SourcesMenu.tsx`'s `checkbox-box` div
  rendered as a solid black square with no glyph in either state. Added a `lucide-react`
  `Check` icon inside, shown only when `enabled`. Verified visually — white check now visible
  on enabled sources (Commas, Fathom, Zoom).
- **P1 — shell looked nothing like Commas.** The app used a flat `#f5f6f8` background with no
  gradient/glass, unlike every Commas reference screenshot. Copied
  `commas_bg_draft.webp` from `../commas-ai-copilot/public/` into this repo's `public/`,
  restored the `.app-shell-bg` recipe in `index.css` (and restored `.glass-card`'s actual
  translucency/blur, which had been flattened to 90%-opaque with no backdrop-filter and was
  unused until now), applied `app-shell-bg` to `App.tsx`'s root wrapper, and rewrote
  `TopNav.tsx`: the org-switcher is now a real `glass-card` pill, and a new non-functional
  glass search field ("Search apps…") sits where Commas' dashboard has one. The header itself
  dropped its solid `bg-white/80 border-b` in favor of floating glass elements directly over
  the gradient, matching `docs/references/commas-dashboard.png`.
- **P1 — flagship investigation answer was one unstructured paragraph.** `liteMarkdown.tsx`
  only supported `**bold**` and paragraph breaks; spec §5.5 calls for a case summary,
  timeline, itemized evidence, and a labeled draft. Extended the renderer to also handle
  `### Heading` blocks (→ `<h4>`) and consecutive `- item` lines (→ `<ul><li>`), then rewrote
  `mockEngine.ts`'s dispute-investigation answer into four blocks — Case summary / Timeline /
  Evidence / Drafted response — each list item naming its source, still respecting the
  per-enabled-source conditionals and the "couldn't check X" note. Verified visually: distinct
  TIMELINE and EVIDENCE headings with bulleted, source-attributed items.
- **P1 — no navigation below 900px.** `Sidebar.tsx` was `hidden min-[900px]:flex` with no
  fallback, stranding the user with zero navigation at smaller widths. Changed to always
  `flex` (the rail is only 48px wide). Verified nav visible at 1000px, 900px, and 800px.

## Verification

- `npm run typecheck` — pass (0 errors).
- `npm run lint` — pass (0 errors/warnings).
- `npm test` — **14/14 passing** (up from 10; added `tests/liteMarkdown.test.tsx` for the new
  heading/list rendering, per the review's own recommendation).
- `npm run build` — pass (190KB JS / 26KB CSS gzipped, no regression from the prior 188KB/27KB).
- Ran the app in headless Chromium across four viewport widths (1400px, 1000px, 900px, 800px)
  and drove every affected flow end to end (dashboard, Resolution Center → Investigate with
  AI → full multi-source investigation with structured answer, Sources menu, spam-clicking
  New Chat, navigating to Chat with the panel open, floating button at narrow widths) — zero
  console errors throughout. Screenshots confirm each fix visually (gradient/glass shell,
  checkmarks, structured TIMELINE/EVIDENCE sections, no duplicate panel, no duplicate empty
  chats, panel overlay at 1000px, nav present down to 800px).

## Not touched (explicitly out of scope for this pass)

All 14 P2 polish items from the review remain open — see the review notes (not reproduced
here to avoid drift; re-run a review pass to get current line references). None are asked for
in this pass. Also unchanged: the mock-engine-vs-real-agent boundary — every fix above is
UI-layer only and survives the eventual Phase 2–3 backend swap.

# Commas Foundation Migration (2026-08-21, after the review-fix pass)

Direction correction from the user: the AI Agent UI was "visually and structurally too
generic" — a generic chat sidebar in a Commas-looking dashboard. The corrected intent:
**`commas-ai-copilot` is the visual/interaction foundation; we are evolving the Commas AI
Copilot experience into the Commas AI Agent.** This pass executed that migration.

## What was ported from `commas-ai-copilot` (copied/adapted, still standalone)

- **Shell layout**: the padded gradient frame (`app-shell-bg` + `min-[992px]` padding), glass
  `Sidebar` (full version: logo tile, Home/Billing/Growth/Wallet/Resolution Center nav + new
  Chat entry, divider, installed-app tiles, settings/account cluster) and glass `TopNav`
  (org pill + Sparkles "Search apps..." field + icon cluster) — old versions replaced my
  generic simplified ones. Billing/Growth/Wallet are visual-only (non-functional, as in the
  old prototype).
- **CSS recipes** restored verbatim into `index.css`: `filter-pill`, `toolbar-search`,
  `btn-toolbar`, `textarea-shell`, `detail-row`, the full inset-shadow `main-surface`,
  original `content-card` metrics.
- **Resolution Center list** (`src/components/resolution/ResolutionCenter.tsx`): tabs
  (Needs response / In review / All / Lost / Won), filter pills with working
  Reason/Amount/Date popovers, toolbar search + Export, the dispute table row. The old
  `phase` prop was dropped (no submitted state in this repo).
- **Dispute Detail** (`resolution/DisputeDetail.tsx`): back link, header + meta, manual
  evidence checklist (6 categories, working `AddEvidenceModal`), "Your response" draft box
  (Save draft works; Submit disabled — submission is simulated per platform reality), and
  the Dispute details / Customer / Transaction cards. **The evolution point:** the old
  "Collect evidence with AI" scripted-copilot button is now **"Investigate with AI"**
  (same `btn-blue` treatment) and opens the contextual agent panel instead of the old
  inline scripted flow.
- Supporting components: `FilterPill`, `ReasonPopover`, `SimpleFilterPopover`,
  `PinwheelIcon`, `AddEvidenceModal`, `CardTitle` — all in `src/components/resolution/`.
- **Dispute dataset** (`src/lib/disputeData.ts`): the old repo's audited August 2026 story
  (purchase Aug 2 14:32 UTC, access 14:33, 14 logins, 6/12 lessons, dispute Aug 9, due
  Aug 13, sarah.johnson@email.com). The chat mock engine now tells the SAME story — the
  earlier February variant is gone.

## Sources corrected (per the CPO's list — do not extend)

Native: **Commas** (primary). External connected sources: **Google Calendar, Zoom, Fathom,
Gmail, CRM** (vendor-neutral). The previous Google Meet/ClickFunnels set was replaced.
Google Calendar/Zoom/Fathom mocked as connected; Gmail/CRM connect via the simulated flow.
`DEFAULT_ENABLED_SOURCES` = all connected. No MCP terminology anywhere in the UI.

## Contextual AI now context-aware by page

- **Dashboard** → floating button opens panel with `DASHBOARD_CONTEXT`; suggestions include
  "Help me understand why revenue dropped this month" (new mock-engine branch with a
  structured "What changed" answer). No context chip — the page itself is the context.
- **Resolution Center → Dispute Detail** → "Investigate with AI" or floating button opens
  the panel with `DISPUTE_CONTEXT` (chip + dispute suggestions, first one now "Help me
  resolve this dispute"). Investigation answer sources each timeline/evidence item to
  Commas/Fathom/Zoom/Google Calendar/Gmail/CRM per enabled scope.
- **RC list** → floating button opens a generic (no-context) panel chat.
- Global suggestions revised to the requested set: Summarize my sales · Look up a customer ·
  Analyze my disputes · Help me respond to a customer · Find information across my connected
  apps (each backed by a real mock-engine branch).

## Layout integration

The AI panel is now a **sibling `main-surface` column** inside the padded shell (gap-2.5 from
the page surface) — Notion-style docking with Commas materials; the underlying page stays
visible. Below `lg` it still overlays (P0 fix preserved). Chat view and Dashboard are also
`main-surface` pages now. `ResolutionCenterPage.tsx` (placeholder) was deleted; RC routing is
`list | detail` inside App.

## Verification (this pass)

- typecheck ✓, lint ✓ (one ported ternary-statement fixed), **16/16 tests** (added
  revenue-drop and cross-app-scoping engine tests; updated source ids/labels), build ✓
  (222KB JS / 34KB CSS pre-gzip).
- Headless-Chromium walkthrough, zero console errors: dashboard → panel → revenue-drop
  answer; RC list (tabs/filter popover) → dispute detail → Investigate with AI → full
  sourced investigation; sources menu (checkmarks, Not-connected states) → Connected apps
  modal; Chat view → continue seed conversation → New chat empty state with the five
  suggestions. Screenshots confirm visual parity with the old prototype's shell.

## What remains after this pass

Unchanged scope boundaries: no real agent/LLM/MCP (mock engine only), no OAuth (simulated
connect), no write/approval flow, no persistence, no committed e2e suite. The old repo's
`SourceView` (evidence source-record pages) and `EvidenceCopilot` scripted cards were
deliberately NOT ported — the agent panel supersedes the copilot cards, and source-record
inspection is a candidate for a later pass if evidence traceability returns as a requirement.

# Commas Tool Layer (2026-08-21, after the UI migration pass)

Prior sessions built UI only, with everything agent-shaped scripted client-side
(`src/lib/mockEngine.ts`). That premise was checked at the start of this session — confirmed
by inspecting the repo directly (`src/agent/`, `src/llm/`, `src/mcp/` were empty placeholder
READMEs, no backend, no `@anthropic-ai/sdk`/`@modelcontextprotocol/sdk` deps) — and found not
to match the task's framing that "the agent orchestration layer is complete." This session
builds it for real, deleting the client-side mock engine it replaces.

## Architecture actually implemented

```
Browser (React) → POST /api/agent/run → Hono backend (server/)
                                          Agent (server/agent/runtime.ts)
                                            → LlmClient.nextStep()  [server/llm/]
                                            → CommasMcpClient.callTool()  [server/mcp/client.ts]
                                              → real MCP protocol (JSON-RPC)
                                              → mock Commas MCP server  [server/mcp/mockCommasServer.ts]
                                            → result fed back to LlmClient
                                            → loop until final answer
```

The Agent never touches Commas endpoints directly — it only calls `CommasMcpClient`, which
only speaks MCP. `server/llm/` and `server/mcp/` are both swappable behind their interfaces
(`LlmClient`, the MCP client's mock/real factory methods) with zero changes to
`server/agent/runtime.ts`.

## Commas MCP inspection (grounded in docs/active-context.md's earlier commasdocs.com recon)

- **Authentication:** `x-api-key` header, seller API key from the dashboard. No OAuth for the
  public API or documented MCP server.
- **Real MCP server exists**, Streamable HTTP, at the Railway URL already recorded in this
  file's Integrations section — not the branded domain, not guaranteed stable.
- **Read tools (11 documented):** this pass implements 3 of them (`fanbasis_list_customers`,
  `fanbasis_list_transactions`, `fanbasis_get_transaction`) — the minimum needed for
  customers + transactions/orders per the task's scope, not the full 11.
- **Disputes: confirmed no real tool exists.** `commas_get_dispute` is prototype-only
  (namespaced `commas_`, not `fanbasis_`, exactly per the earlier-recorded convention) —
  mock data only, matching the documented `dispute.created` webhook shape.
- **Write capabilities:** documented as real (charge, refund, discount CRUD, subscription
  changes) but **not implemented here** — this repo has no approval-card UI yet
  (PROTOTYPE_SPEC.md §4.6), so shipping a write tool with no confirmation gate would be
  unsafe. Deferred, not faked.
- **Local development option:** commasdocs.com documents a QA sandbox
  (`qa.dev-fan-basis.com`) as the real platform's local-dev path. No sandbox key is
  available here, so the actual local-dev implementation is the in-process mock MCP server
  instead — architecturally equivalent (same protocol, same tool contracts), just without
  real data behind it.

## What was built

- **`server/mcp/mockCommasServer.ts`** — a real `McpServer` (from
  `@modelcontextprotocol/sdk`) exposing the 4 tools above over mock data matching
  `src/lib/disputeData.ts`'s story (Sarah Johnson, txn_8b3f2a1c9d, $499, Dispute #2481).
- **`server/mcp/client.ts`** — `CommasMcpClient`: `connectMock()` (in-process
  `InMemoryTransport` linked pair — real MCP protocol, no secrets) and `connectReal(url,
  apiKey)` (Streamable HTTP + `x-api-key` header — wired, live-tested only against an
  unreachable address to prove the failure path, never against a real Commas account).
- **`server/agent/registry.ts`** — tool discovery: the registry is built from the MCP
  server's `tools/list` response, not a hardcoded name list. Unrecognized tools default to
  `write` classification (fail-safe). `GET /api/tools` exposes it.
- **`server/agent/errors.ts`** — `classifyError()` maps any caught error to one of
  `auth_failed | server_unavailable | malformed_result | tool_error | timeout | unknown`;
  `empty_result` is handled as a normal (non-error) outcome by the LLM layer instead (an
  empty customer search isn't a failure — see stubClient.ts's `finalize()`).
- **`server/agent/runtime.ts`** — the loop: filters tools by `enabledSources`, calls
  `llmClient.nextStep()`, dispatches tool calls through `mcpClient.callTool()` with a
  10s timeout, feeds results back, loops (cap 6), returns `{steps, answer, toolSummary,
  error?}`. Tool-level failures are recoverable (fed back to the LLM, which explains what it
  couldn't do); LLM-level failures (auth, connectivity) populate the top-level `error` field.
- **`server/llm/`** — `LlmClient` interface; `StubLlmClient` (deterministic, routes real
  prompts to real tool calls by keyword/pattern — this is what ran in all testing, since no
  `ANTHROPIC_API_KEY` exists in this environment); `AnthropicLlmClient` (real
  `@anthropic-ai/sdk` usage, `claude-opus-5`, adaptive thinking, proper tool-use loop —
  written but **never actually invoked** this session, no key available to test it live).
- **`server/app.ts` / `server/index.ts`** — Hono app (`GET /api/health`, `GET /api/tools`,
  `POST /api/agent/run`) split from the entry point specifically so tests can drive it via
  Hono's in-memory `app.request()` with no port binding.
- **`src/lib/agentApi.ts` + `useChatStore.tsx` (minimal frontend wiring)** — `sendMessage`
  now calls `POST /api/agent/run` instead of the deleted `planMockRun()`. The existing
  per-step reveal timers, `ProgressBlock`'s "Thinking…" fallback, `ToolSummary`, credits, and
  cancellation (now aborts the in-flight fetch too) are all **unchanged** — only where the
  plan data comes from changed. On error, the assistant message becomes `"I ran into a
  problem: {message}"` — no new UI components.
- **Deleted:** `src/lib/mockEngine.ts` and `tests/mockEngine.test.ts` (superseded, would
  otherwise be dead/confusing code sitting next to the real thing).

## Security

- `ANTHROPIC_API_KEY` / `COMMAS_API_KEY` are read via `process.env` only inside `server/`
  (Node), which the frontend build never touches. Verified directly: `grep`'d the production
  `dist/assets/*.js` bundle for API key env var names and the server-only SDK package names
  — none present.
- `.env` is gitignored (already was); `.env.example` documents the shape with empty values.
  No real key was ever entered anywhere.
- The real-mode MCP path requires two explicit signals (`COMMAS_MCP_MODE=real` +
  both `COMMAS_MCP_URL` and `COMMAS_API_KEY` set) and was only exercised in tests against an
  intentionally-unreachable address — never against a live Commas account.

## Verification

- `npm run typecheck` (3 tsconfig projects: app, node, **server** — new), `npm run lint`,
  `npm run build` all pass clean.
- **36/36 tests pass** (was 16; net +20, minus the 6 deleted mockEngine tests = the new
  backend suite is ~26 tests): `tests/server/{errors,registry,mcpClient,runtime,app}.test.ts`
  + updated `tests/ChatFlow.test.tsx` (now mocks `fetch` at the network boundary and covers
  both the success path and both frontend error paths — backend-reported error and
  network-unreachable).
- **The 5 requested validation scenarios**, all passing against real code (mock LLM, real
  everything else): user query needing Commas data → successful tool call → result passed
  back to the agent → final answer (`tests/server/runtime.test.ts`, scenario 1); tool failure
  produces a clean, non-crashing response (`runtime.test.ts` + `app.test.ts`, scenario 2 —
  additionally verified **live in a browser** against the real running backend, see below).
  Also covered beyond the minimum: empty result, disabled source, MCP-connection-unavailable,
  malformed request body, unreachable real-mode MCP server (genuine `ECONNREFUSED` against
  `127.0.0.1:1`).
- **Live end-to-end browser verification** (both servers actually running, Playwright
  driving real network calls, not mocks): "Look up customer sarah.johnson@email.com" →
  correct answer; "Look up transaction txn_8b3f2a1c9d" → correct answer; "Look up transaction
  txn_doesnotexist" → clean "I couldn't complete that — Transaction not found:
  txn_doesnotexist." (the failure case, rendered exactly like a normal message, no crash, no
  raw error); "help me resolve this dispute" → correct dispute lookup using page context.
  4/4 network calls returned 200, 0 console errors, credits decremented correctly each turn.
  Screenshots retained in job scratch space.

## What's still not real (be precise about this)

- **No live LLM call was ever made.** `AnthropicLlmClient` is real, complete code, but this
  environment has no `ANTHROPIC_API_KEY`, so every test and every live-browser check above
  ran on `StubLlmClient`. The "reasoning" is scripted; the tool-call/MCP/error-handling
  machinery around it is not. Anyone continuing this: get a key, set it in `.env`, restart
  `npm run dev:server`, and the exact same UI/tests should work against the real model —
  nothing else should need to change. Confirm `llmMode` in `GET /api/health` flips to
  `"anthropic"`.
- **No real Commas MCP connection was ever made.** `connectReal()` is real code, tested only
  against a deliberately-unreachable address. No Commas API key exists here.
- **No write tools.** Documented as available on the real platform; deliberately not
  implemented because there's no approval-card UI to gate them yet.
- **7 of the 11 documented Commas read tools aren't implemented** (only customers,
  list-transactions, get-transaction). `fanbasis_list_discount_codes`,
  `fanbasis_get_checkout_session`, `fanbasis_get_payment_methods`, etc. would follow the
  exact same pattern in `mockCommasServer.ts` + `registry.ts`'s `KNOWN_TOOLS` map if needed.
- **Only the "Look up a customer" / "Analyze my disputes" / transaction-id-shaped prompts
  route to real tools.** The stub's other suggestion-chip prompts ("Summarize my sales" →
  now hits `fanbasis_list_transactions`, fine; "Find information across my connected apps",
  "Help me respond to a customer" beyond a customer name) either fall through to the
  honest fallback text or a partial match — this session did not attempt to replicate every
  scenario the old client-side `mockEngine.ts` covered (revenue-drop analysis, non-Commas
  external sources like Zoom/Fathom/Gmail/CRM) because those aren't backed by any real Commas
  tool. Non-Commas sources (Google Calendar, Zoom, Fathom, Gmail, CRM) remain entirely UI/
  sources-menu mocks with no backend behind them at all — out of scope for "the Commas tool
  layer."
- **Persistence unchanged:** still in-memory only; a reload loses chat history.
- **No SSE/streaming:** `POST /api/agent/run` is a single synchronous request/response, not
  the SSE event stream ARCHITECTURE.md §9 describes. The frontend's client-side step-reveal
  timers only pace the *display* of steps the backend already finished — a deliberate scope
  cut (task said "do not build elaborate backend infrastructure merely to demonstrate UI");
  real streaming would need this endpoint rewritten as SSE and is a reasonable next step.

# Conversation System, Source Adapters & Write-Approval Flow (2026-08-21)

The user's task this session opened with one fully-specified request ("implement the
conversation system") and, while that was already being worked, five more complete task
blocks arrived in the same turn (source/connector architecture, contextual AI in Resolution
Center, agent-interaction-model polish, a 7-flow stabilization audit, and a final visual
polish pass — each its own "STOP."-terminated spec). Given the scope, the explicit decision
made and stated back to the user was to implement the first four with real rigor and
**explicitly not attempt** the stabilization audit or the visual polish pass this session,
rather than rush all six and risk false claims of completion. That decision held: items 1–3
below are done and verified; the stabilization audit and visual polish pass were **not
started** — see "Explicitly not attempted" at the end of this section.

## 1. Conversation system

- **Model** (`src/lib/types.ts` / mirrored in `server/types.ts`): `Chat { id, title, createdAt,
  updatedAt, status: "idle"|"running"|"error", enabledSources, context?, messages }`. Titles
  are generated heuristically from the first user message (`useChatStore.tsx`).
- **Left nav**: existing Chat entry now shows New Chat + a Today/Yesterday-grouped history
  list (`ChatHistoryList.tsx`, unchanged visual language from the earlier UI passes).
- **Context retention without duplication**: a chat stores only a `PageContext` reference
  (`kind`, `id`, `label`, optional `dispute` detail block) — not a copy of the underlying
  dispute/dashboard data — plus its own `enabledSources` and `messages`. Nothing else is
  duplicated per-chat.
- **Multi-turn memory, threaded end to end**: `ConversationTurn {role, text}[]` built from
  each chat's prior messages (`historyFor()`, capped at 20 turns) is sent as `history` on
  every `POST /api/agent/run` call, consumed by `AnthropicLlmClient` (prepended to the real
  message array) and by `StubLlmClient` (a `findRecentEmail()` heuristic that resolves
  pronoun-style follow-ups like "What about her transactions?" against the prior turn).
  Verified live: asking about "Sarah Johnson" then "What about her transactions?" correctly
  resolves the referent (see live verification below).
- **Credits**: `CREDIT_COST_PER_MESSAGE = 1`, `CREDIT_COST_PER_STEP = 1`,
  `CREDIT_COST_PER_WRITE = 5`; declined write actions cost 0. Balance shown in a pill in both
  the Chat header and the right panel; exhausted state disables the composer with a clear
  message and a "Reset demo" affordance (mocked, no real billing anywhere).
- **New Chat empty state**: Claude-Desktop/Notion-AI-style greeting + suggested capability
  chips (Summarize my sales, Look up a customer, Analyze my disputes, Help me respond to a
  customer, Find information across my connected apps) that feed directly into the normal
  send-message flow.
- **Persistence**: `useChatStore.tsx` hydrates `{chats, sources, credits}` from
  `localStorage` (`commas-ai-agent:v1`) on mount and persists on every change via a
  `useEffect`. Verified both automated (Vitest, simulated unmount/remount) and live in a
  real browser (see below) — a chat's full message history, including a second turn's
  answer, survives a real page reload.

## 2. Source adapter architecture

Replaced the single hardcoded Commas MCP client wiring with a uniform `SourceAdapter`
interface (`server/adapters/types.ts`: `sourceId`, `kind: "mcp"|"api"`, `listTools()`,
`callTool()`) so the Agent talks to one abstraction regardless of what's behind it — per the
explicit instruction not to force every integration to look like MCP.

- **MCP-backed adapters** (`server/adapters/commasAdapter.ts`, `meetingsAdapters.ts` +
  `server/mcp/mockFathomServer.ts` / `mockZoomServer.ts`, connected in-process via
  `server/mcp/connectInProcess.ts`): Commas (existing), plus new mock Fathom and Zoom MCP
  servers — used because MCP is the real mechanism for Commas and is a reasonable stand-in
  for meeting-recording tools.
- **API-style adapters** (`server/adapters/gmailAdapter.ts`, `calendarAdapter.ts`,
  `crmAdapter.ts`): plain mock-data adapters with no MCP layer, because OAuth/REST is the
  real mechanism for these — no invented capabilities beyond one lookup tool each, all mock
  data for the existing Sarah Johnson / Dispute #2481 story.
- **Genuine multi-source reasoning, not a hardcoded sequence**: the runtime
  (`server/agent/runtime.ts`) exposes all enabled adapters' tools to the LLM/stub uniformly;
  nothing in the architecture forces a fixed call order. `StubLlmClient`'s dispute
  investigation *does* follow a fixed Commas → CRM → Gmail → Fathom → Zoom chain, but that
  ordering lives only in the stub's scripted approximation of reasoning (documented inline as
  such) — `AnthropicLlmClient` receives the identical tool set and decides freely. Verified
  live: the investigation answer cites each connected source individually (Fathom call
  transcripts, Zoom meeting logs) and lists a "Missing information" note naming exactly the
  sources that were disabled for that chat.
- **`GET /api/health`** now reports `commasConnected` plus a `sources` array (id/kind/status)
  for all 6 adapters.

## 3. Contextual AI + write action with confirmation (Resolution Center)

- **Structured context, no DOM scraping**: `PageContext.dispute` carries customer name/email,
  transaction id, amount, reason, opened/evidence-due dates, and evidence status — built once
  when the panel opens and passed as data, never re-derived from the rendered UI.
- **One real write tool, safety-gated**: `commas_mark_dispute_response_ready` (added to the
  mock Commas MCP server) flips a mock "evidence ready" flag — explicitly documented in its
  own tool description as simulated, since the real Commas platform has no evidence-submission
  API (confirmed earlier this project — see "Critical CONFIRMED gap" above). The runtime
  (`server/agent/runtime.ts`) pauses **before executing** any tool classified `"write"` and
  returns a `pendingApproval` to the client instead; a new `POST /api/agent/approve` endpoint
  resumes the same loop only after an explicit user decision. Declining a write action
  provably never executes it (covered by a runtime test asserting no state change on decline).
- **UI**: `ApprovalCard.tsx` renders inline in the message list — a one-line plain-English
  summary plus Approve/Decline buttons, using the existing `content-card`/`btn-dark`/
  `btn-secondary` treatments, no new visual system.

## Live verification (this session, real browser, both servers actually running)

Ran a Playwright script against `npm run dev` (Vite, 5173) and `npx tsx server/index.ts`
(Hono, 8787) — mock LLM (no `ANTHROPIC_API_KEY` in this environment, as before), mock/
in-process MCP for all adapters. All six checks passed, zero console errors:

1. New chat → "Look up customer sarah.johnson@email.com" → correct answer → follow-up "What
   about her transactions?" → correctly resolves to the same customer's transaction (proves
   multi-turn memory works live, not just in tests).
2. Real page reload (no app router exists, so a raw reload always lands back on the default
   Dashboard view — expected SPA behavior, not a bug) → navigate to Chat → the conversation
   from step 1 is in history → reopening it shows both turns' full content (proves
   `localStorage` persistence survives an actual reload, not just a simulated unmount).
3. Resolution Center → open the dispute row → "Investigate with AI" → "Help me resolve this
   dispute" → structured multi-source answer citing Fathom and Zoom by name with a "Missing
   information" note for the two disabled sources (CRM, Gmail).
4. In that same dispute chat, "mark the response ready" → approval card renders with a plain-
   English summary → Approve → tool actually runs → confirmation message, no page-level
   evidence-submission claim (matches the documented platform gap).
5. New chat → Sources menu → toggle a source off/on, "My sources" panel matches the
   Commas-integrations-style reference.
6. Draining the mocked credit balance to 0 (via localStorage, then reload) → composer
   disables with "You're out of AI credits" placeholder + a red explanatory line + a working
   "Reset demo" control — no crash, no silent failure.

Screenshots for all 6 retained in job scratch space (not committed — same convention as
prior sessions' ad-hoc Playwright verification).

## Automated verification

- `npx tsc -b` — clean, 0 errors (3 tsconfig projects unchanged: app/node/server).
- `npm run lint` — clean, 0 errors/warnings.
- `npx vitest run` — **48/48 passing** (was 36; +12 net for this session: new/updated
  `tests/server/{registry,runtime,app,mcpClient}.test.ts` covering multi-source scoping,
  the approval/decline flow, and multi-turn history threading, plus `tests/ChatFlow.test.tsx`
  additions for approval-card rendering and a corrected persistence test).

## A real bug this session's tests caught and fixed

`EMAIL_REGEX` in `server/llm/stubClient.ts` originally used `/[\w.+-]+@[\w-]+\.[\w.-]+/`,
which greedily matched a sentence-ending period after an email address in assistant reply
text (e.g. "...sarah.johnson@email.com." from a prior answer), producing an email string that
didn't exactly match the stored customer record and silently broke the "What about her
transactions?" follow-up. Fixed to `/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/` (no longer captures a
trailing non-domain period); caught by the new multi-turn Vitest test, confirmed fixed both
there and in the live browser check above.

## Explicitly not attempted this session (flag honestly, do not claim done)

Two of the six task blocks that arrived this session were **deliberately not started**,
per the scope decision stated at the top of this section:

- **The 7-flow stabilization audit** (Dashboard AI, Chat history, Sources, Resolution Center,
  Agent loop, Failure states, Credits) — no systematic pass was run checking each flow against
  existing Playwright/test infrastructure or against the Notion AI / Claude Desktop / Commas
  reference screenshots. The live verification above exercises most of these flows once each,
  successfully, but that is spot-checking, not the audit that was asked for (which calls for a
  written report of passing/failing tests, known limitations, mocked functionality, and
  production gaps as its own deliverable).
- **The final visual polish pass** — no dedicated typography/spacing/border/radius/shadow/
  icon-alignment comparison against the five reference screenshot sets was performed. The UI
  is visually consistent with the existing Commas AI Copilot language (confirmed via the live
  screenshots above and by construction — no new components introduced this session, only
  reuse of `content-card`/`btn-dark`/`btn-secondary`/existing chat components), but that is not
  the same as the requested dedicated polish pass.

Both remain open — see "Next Steps" below.

# Dashboard Visual Fidelity Pass (2026-08-21)

The task opened by explicitly correcting a wrong assumption from an earlier session: this
repo's Dashboard was "visually too simplified" (a bare 3-stat placeholder), and — critically —
**`commas-ai-copilot` has no Dashboard to port from at all.** Reconnaissance confirmed this
directly (`find src -iname "*dashboard*"` in that repo returns nothing; it only has the Commas
application shell + Resolution Center + the old scripted `EvidenceCopilot`). So the Dashboard
had to be built fresh, using four new production Commas screenshots
(`docs/references/Screenshot 2026-08-21 at 4.27.*.png`, captured live from `commas.com`) as the
structural source of truth, while everything *around* the Dashboard (shell, typography, cards,
Resolution Center) had to keep using this repo's already-established design language rather
than inventing a second one.

## What was built

- **`src/components/dashboard/`** (new directory, 6 components):
  - `MiniChart.tsx` — a hand-rolled SVG sparkline (no charting library added, per the explicit
    "no unnecessary dependencies" constraint): faint gridlines, a stroked line, a dot at the
    last point, x-axis labels. Reused by every chart-bearing card.
  - `RevenueModule.tsx` — the hero Revenue card: heading, D/W/M/Y segmented toggle (mock,
    `D` active), dollar amount, date with chevron, a small "‹ Updated 4:27 AM" time/range line
    (added in the correction pass below — the task's own Revenue-module checklist named this
    explicitly and the first draft missed it), and the chart.
  - `AnnouncementsModule.tsx` — heading, prev/next nav arrows, an image area, title/caption,
    pagination dots. The production card's photo (a branded truck) is replaced with a gradient
    + wordmark placeholder — deliberately not attempting to fabricate realistic product
    photography; the structure and copy ("Welcome to Commas" / "The new era for making money on
    the internet.") are reproduced, the image is an honest mock.
  - `OverviewControls.tsx` — the Date range / Daily / Compare-to pill row plus Add/Edit buttons,
    matching production's toolbar exactly. Non-functional, as instructed for this phase.
  - `OverviewCard.tsx` — exports two variants: `OverviewCard` (populated metric: heading, value,
    "X last period" delta, sparkline) and `OverviewEmptyCard` (heading, illustration, caption,
    optional CTA) — production's genuine empty-state treatment.
  - `EmptyIllustration.tsx` — a small stacked-card mock (two overlapping rounded rectangles)
    standing in for production's blurred illustration inside empty cards.
- **`src/pages/DashboardPage.tsx`** — fully rewritten to compose the above: welcome heading,
  Revenue + Announcements hero row, "Overview" heading, controls, then an 8-card 3-column grid
  (Gross revenue, Top payment methods, Spend per customer, New customers, Credit score
  distribution, Disputed payments, Dispute activity, Net revenue) — the exact card set and
  layout from the production screenshots, including the asymmetric last row (2 cards, one
  empty cell), which production also has.
- **`src/components/shell/TopNav.tsx`** — added the trailing black "Finish setup" pill visible
  in every production screenshot (static circle icon + label, non-functional, matching
  position/order after the existing +/settings/help/bell cluster). Nothing else in `TopNav` or
  `Sidebar` changed — both already matched production closely from an earlier session's
  "Commas Foundation Migration" pass (glass org pill, AI search field, icon-rail nav with the
  same active-state treatment), confirmed by direct comparison against the new screenshots
  rather than assumed.
- **`src/index.css`** — two new utility classes, added next to the existing shared recipes
  rather than a new stylesheet: `.segment-control` (the D/W/M/Y toggle) and `.overview-pill`
  (the Overview toolbar pills). Both reuse the existing color tokens/radius scale, no new design
  system introduced.

## Deliberate departure from a literal production copy: coherent mock numbers, not $0.00

Production's screenshots show a genuinely empty demo account — every figure is `$0.00` / `0`,
and the Disputed payments card reads "All clear — no disputes this period." Copying that
literally would have put a "no disputes" claim on the Dashboard one click away from Resolution
Center's actual open dispute (#2481, Sarah Johnson, $499) — a direct contradiction, and exactly
the kind of incoherence Phase 4 of the task asked to avoid ("must feel like they belong to the
same product"). The judgment call made here: reproduce production's *structure and empty-state
treatment* exactly, but populate most cards with plausible mock numbers consistent with this
prototype's existing world (the same $18,420/62-transaction figures the old placeholder
Dashboard already used, plus a Disputed payments / Dispute activity pair that reflects the real
$499 dispute) — while still keeping two cards as **faithful, verbatim empty states** (Top
payment methods: "Payment methods will appear here once sales come in"; Credit score
distribution: "Enrich your first lead to see credit insights" + "Go to Qualifier App" CTA),
since this prototype genuinely has no backing mock data for either and the task was explicit
that empty states must never be blank white space.

## Resolution Center & AI Agent — verified untouched, not just assumed

No files under `src/components/resolution/` were opened for editing this session. No files
under `src/hooks/useChatStore.tsx`, `src/components/chat/`, or `server/` were touched either —
this was a frontend-only Dashboard pass. Verified live (screenshots retained in job scratch
space), not just by inspection:

1. Dashboard renders fully, floating AI button visible bottom-right.
2. Opening the AI panel from the Dashboard shows the Notion-AI-style docked layout — the
   Dashboard stays completely visible and interactive to its left, matching Phase 5's explicit
   requirement (not an overlay, not a separate app).
3. Navigating to Resolution Center → the dispute list (Sarah Johnson row, tabs, filter pills,
   Export) renders pixel-identical to before.
4. Opening the dispute detail → the evidence checklist, dispute/customer/transaction cards, and
   "Investigate with AI" button are all unchanged.
5. Clicking "Investigate with AI" → the right panel correctly re-contextualizes from
   "Dashboard" to "Dispute #2481 — Sarah Johnson" with the dispute-specific suggestion chips
   ("Help me resolve this dispute," "Draft an evidence response," etc.) — the existing
   contextual-AI wiring from an earlier session is completely intact.

Zero console errors across the entire click-through.

## Automated verification

- `npx tsc -b` — clean, 0 errors.
- `npm run lint` — clean, 0 errors/warnings.
- `npx vitest run` — **48/48 passing, unchanged** from before this pass (no test touches
  Dashboard markup directly, so this is a true no-regression signal, not just a re-run).

## Remaining visual differences from production (honest gaps, not hidden)

- **The Announcements card's image is a gradient placeholder**, not the branded photograph
  production shows — an intentional mock, not an oversight (see above).
- **No carousel motion.** Production's Announcements card visibly peeks a second card at its
  right edge (implying horizontal scroll/carousel); this version renders one static card with
  non-functional nav arrows and pagination dots. The `<`/`>` buttons and dots are present for
  structural fidelity but don't do anything yet.
- **The D/W/M/Y toggle and Overview pills are visual-only** — clicking them doesn't change any
  data, per this phase's explicit scope ("build the UI... for now").
- **Chart tooltips aren't implemented.** Production's Net revenue chart shows a hoverable
  tooltip with a draggable point (`Net Revenue / Aug 16: $0.00 / Aug 9: $0.00`); this version's
  `MiniChart` is a static SVG with no interaction.
- **No responsive/narrow-width Dashboard testing was done this pass** — verification ran at
  1440px only. The existing Sidebar/RightPanel responsive fixes from an earlier session
  (P0/P1 fix pass) are untouched and should still hold, but the new Dashboard grid specifically
  wasn't checked below 1440px.

## What this pass explicitly did NOT do (per the task's own constraints)

No real OAuth, no real MCP calls, no real LLM calls, no Agent/MCP architecture changes, no
Resolution Center rewrite, no new design system, no new dependencies. This was scoped
exclusively to Dashboard visual fidelity + confirming the existing AI Agent integration and
Resolution Center survive it — nothing else was in scope and nothing else was touched.

# Chat Sidebar Cleanup + Connected Apps Modal Opacity (2026-08-21)

Two small, targeted fixes — no layout or architecture changes.

## Chat sidebar: removed the redundant "New chat" action

`src/components/chat/ChatHistoryList.tsx` had two controls that both called the exact same
`handleNewChat` — the "New chat" text button and a separate icon-only `+` button beside it
(`aria-label="New chat"`). Removed the `+` button and its now-unused `Plus` import; "New chat"
is the sole entry point now. Nothing else in the header row changed (`justify-between` was
dropped since there's only one child left, but padding/height/position of the remaining button
are untouched).

No changes were needed to `useChatStore.tsx`'s `createChat()` — it already satisfied every
behavior the task asked to preserve: it dedupes against an existing empty chat rather than
piling up blank rows, stamps a fresh `updatedAt` so a genuinely new chat naturally sorts to the
top of "Today" (the history list sorts by `updatedAt` descending), leaves every other
conversation in place, and an empty `messages: []` array is exactly what makes
`ChatWorkspace`/`EmptyState` render the "How can I help you today?" empty state. This pass was
purely removing the duplicate button, not touching the conversation logic underneath it.

Verified live: exactly one "New chat" control renders (`getByLabel("New chat")` now matches 0
elements — that aria-label belonged only to the removed icon button), clicking it creates a new
"New chat" entry at the top of Today while "Sales summary — last 30 days" and yesterday's
discount-code chat both remain in history, and the empty-state greeting, suggested prompts,
Sources control, and credit indicator all render unchanged. 0 console errors.

## Connected apps modal: solid instead of translucent

`src/components/chat/ConnectedAppsModal.tsx` used the shared `.main-surface` class, whose
`rgba(255, 255, 255, 0.88)` background is correct for page-level panels floating over the
gradient app-shell background but let Resolution Center's text visibly bleed through when used
for a modal (reported with a screenshot: dispute detail text readable behind the card). Fixed
by overriding just this component's background to solid `#ffffff` via an inline style — `
main-surface`'s shared definition in `index.css` is untouched, so every other surface using it
(Dashboard, Resolution Center, Chat) keeps its existing translucency.

## Verification (both fixes)

- `npx tsc -b` — clean, 0 errors.
- `npm run lint` — clean, 0 errors/warnings.
- Live Playwright checks against the running dev server for both fixes, 0 console errors in
  either. No test suite changes were needed — no existing test asserted on the removed button
  or the modal's exact background value.

# Resolution Center Demo-Readiness (2026-08-21)

The Resolution Center previously had exactly one hardcoded dispute (#2481, Sarah Johnson).
This pass expands it to 5 realistic cases, one per Agent workflow the task asked to
demonstrate, without touching the Resolution Center's existing UI/styling — only its data
source became dynamic (per-dispute lookups instead of one hardcoded import).

## 5 mock dispute cases added

All in `src/lib/disputeData.ts` (UI-facing fields) and `server/mcp/mockCommasServer.ts`
(agent-reasoning fields, kept in sync by hand — same ids/amounts/reasons/dates):

| # | Dispute | Customer | Workflow | Status |
|---|---|---|---|---|
| 1 | #2481, $499.00 | Sarah Johnson | **Needs response** — Agent identifies a likely reason and recommends + drafts a response | Needs response |
| 2 | #2502, $129.00 | Marcus Webb | **Missing evidence** — Agent names exactly what's missing before it will draft anything | Needs response |
| 3 | #2417, $899.00 | Elena Cruz | **Evidence ready** — Agent confirms no gaps and recommends acting now | Needs response |
| 4 | #2455, $249.00 | David Kim | **High-risk/uncertain** — Agent explicitly states it can't be confident, never guesses | Needs response |
| 5 | #2390, $349.00 | Priya Nair | **Won/resolved** — Agent explains what happened and why it resolved in the seller's favor | Won |

`ResolutionCenter.tsx` now renders all 5, filtered per tab by each case's `status` ("Needs
response" tab shows 4, "Won" shows 1, "All disputes" shows all 5 with a Status column) — the
previous single hardcoded `<button>` row became a `.map()` over `DISPUTES`, same markup per
row. `DisputeDetail.tsx` takes a `disputeId` prop and looks up the case (`getDispute(id)`)
instead of importing a single `dispute` constant; `App.tsx` tracks `selectedDisputeId` and
remounts `DisputeDetail` (via `key={selectedDisputeId}`) on row click so per-dispute UI state
(the manual evidence checklist, the draft textarea) never leaks between cases. Each case also
seeds the manual evidence checklist's initial "Added" state (`initialEvidenceAdded`) — e.g.
Elena Cruz's case opens with all 6 categories already marked Added, David Kim's with only 1 —
so switching cases visibly feels like different real disputes, not one static screenshot
reused 5 times.

## Deterministic Agent answers, per case

`server/llm/stubClient.ts` gained a new routing branch, checked *before* the existing
multi-source "help me resolve this dispute" investigation chain (which is unchanged and still
reachable): when the chat's `PageContext.kind === "dispute"` and the prompt matches one of 5
intents (draft / evidence / summarize / recommend / why — specificity-ordered so
"recommended" doesn't get misrouted), the stub issues a single `commas_get_dispute` tool call
(shows "Checking dispute record…" in the UI — real tool-call demonstration, not skipped) and
then answers deterministically from that dispute's mock-authored fields (`likelyReason`,
`evidenceCollected`/`evidenceMissing`, `recommendedAction`, `draftResponse`, and — only for the
high-risk and resolved cases — `uncertaintyNote`/`resolutionOutcome`). Every fact in every
answer traces to a field on the dispute record; nothing is invented at answer time.

**The uncertainty requirement (case 4) is real, not cosmetic**: David Kim's `why`/`recommend`/
`summarize` answers all include the literal line "the evidence here doesn't clearly point one
way or the other" and "I wouldn't commit to a response strategy without gathering more first"
— verified both by an automated test and live in the browser (screenshot retained).

## Demo-script suggested prompts

`DISPUTE_SUGGESTED_CAPABILITIES` in `src/lib/mockData.ts` now shows exactly the task's 5
prompts ("Why is this dispute open?", "What evidence do I need?", "Summarize this case",
"Draft my response", "What should I do next?") instead of the previous 4 (which included
"Help me resolve this dispute" and "Check delivery across connected apps" — still fully
functional if typed manually, just no longer a suggestion chip, since the task asked for these
5 specifically as the demo script).

## Hidden deterministic test response

Typing exactly `all roads lead to` (case-insensitive, whitespace-trimmed, checked before
anything else in `nextStep()` so it works in any chat/context) gets the exact reply
`info, my dawg.` — no tool call, no UI label anywhere referencing it, purely a pipeline
smoke-test per the task's explicit instruction not to expose it as a visible feature.

## Verification

- `npx tsc -b`, `npm run lint` — clean.
- **16 new backend tests** (`tests/server/disputeIntents.test.ts`): the hidden phrase (exact
  match + case-insensitivity + non-substring-match), and at least 2 intents each for all 5
  cases, asserting case-specific facts (e.g. case 2's evidence answer names the exact missing
  categories; case 4's why/recommend answers contain the uncertainty language; case 5's
  summarize answer contains the resolution date and evidence count).
- **Live browser walkthrough** (screenshots retained in job scratch space): Resolution Center
  tabs (Needs response shows 4, Won shows 1, All shows 5 with correct status badges) → each of
  the 5 disputes opened in turn, AI panel re-contextualizing correctly every time → case-1 "why"
  and "draft" questions answered correctly → hidden phrase confirmed inside a real dispute chat
  → case 2's evidence gaps, case 3's "ready" recommendation, case 4's uncertainty language, and
  case 5's resolution summary each confirmed against the live rendered text. Zero console
  errors across the entire walkthrough.

## Known limitations

- Only the 5 demo-script intents get case-specific deterministic answers; other phrasings
  (e.g. "help me resolve this dispute") still run the original multi-source investigation
  chain, which remains hardcoded to dispute #2481's Sarah Johnson story regardless of which
  dispute is actually selected — not extended to the other 4 cases in this pass (out of scope:
  the task's 5 demo questions don't include it, and the chain's CRM/Gmail/Fathom/Zoom mock data
  only exists for Sarah Johnson).
- The manual evidence checklist's "Added" seed state is a UI-only convenience
  (`initialEvidenceAdded`) — clicking "Add" for a new item still opens the same generic
  `AddEvidenceModal`, unchanged from before this pass.
- No "In review" or "Lost" tab cases exist yet — both tabs still show their original empty
  state. Not required by the task's 5-case minimum, but a natural next case set if needed.

# Chat Credit System (2026-08-21)

Rebuilt the prototype's credit model from a single `balance`/`startingBalance` pair (which
conflated "how much is left" with "how much was purchased") into the explicit total/used/
remaining model the task specified, added a real mock purchase flow, and fixed the
consumption rule to the task's explicit "1 message = 1 credit" (previously it also charged per
tool step and 5 extra for write actions).

## Credit state model

`CreditsState` (`src/lib/types.ts`) is now:
```ts
interface CreditsState { totalCredits: number; usedCredits: number; }
```
`remainingCredits` is never stored — always derived as `max(0, totalCredits - usedCredits)`
(`remainingCredits()` helper in `useChatStore.tsx`), so it can't drift out of sync. A fresh
workspace starts at `{ totalCredits: 300, usedCredits: 0 }` (`INITIAL_CREDITS` in
`mockData.ts`) — 300/300, per the task's explicit initialization (the old seed was 284/300;
that was a "lived-in demo" choice from an earlier pass, superseded here since the task was
explicit about starting fresh). Credits persist across navigation/reload via the existing
localStorage mechanism; `loadPersisted()` now validates the persisted shape has
`totalCredits`/`usedCredits` as numbers and falls back to a fresh 300/0 if old-shape data
(`{balance, startingBalance}`) is still in someone's browser storage from before this pass.

## Consumption rule

Exactly 1 credit per `sendMessage()` call, charged synchronously the moment the send executes
— not per tool step, not extra for write actions, and not charged again when an approve/
decline continues the same turn (that's a continuation of the same message, not a new one
sent). Opening a chat, switching conversations, opening the AI panel, and viewing history never
touch credits — none of those code paths call `sendMessage`. `sendMessage` also refuses to run
at all (no network call, no charge) if `remainingCredits(credits) <= 0` — defense in depth
beyond the composer's own `disabled` state, so credits can never go negative even from a
non-UI-mediated call.

## Low-credit and exhausted states

- **≤ 50 remaining** (`LOW_CREDIT_THRESHOLD` in `mockData.ts`): the credit pill switches to a
  warning (orange) style. The pill is a real `<button>` now (was a non-interactive `<div>`) —
  clicking it at any balance opens the Add More Credits modal.
- **0 remaining**: the pill switches to a danger (red) style, the composer's textarea and Send
  button are disabled (placeholder becomes "You're out of AI credits"), and a red message
  appears below the composer — "Your workspace has run out of AI credits. **Buy Credits** to
  keep chatting." — with an inline link straight into the same modal. The conversation itself
  stays fully visible; nothing is hidden or reset.

## Add More Credits modal

New `src/components/chat/AddCreditsModal.tsx` — visually inspired by the Lovable credit modal
the task referenced (icon badge → heading → subtext → bordered "Top up credits" section →
selectable package rows → Cancel/Buy Credits), rebuilt entirely with Commas' own visual
language (the agent-accent purple icon badge, `btn-dark`/`btn-secondary`, the app's existing
card/border/radius tokens) — no Lovable branding, colors, or copy reused. 3 mock packages
(`CREDIT_PACKAGES` in `mockData.ts`): +50/$30 (default selected), +100/$50, +250/$100, each a
radio-style row with a black filled circle + checkmark on the selected one.

**Mock purchase flow** (`addCredits(amount)` in `useChatStore.tsx`): clicking "Buy Credits"
increases `totalCredits` by the package's credit amount — `usedCredits` is never touched, which
is exactly what makes the task's edge case work: 271/300 remaining (29 used) + buy 50 → total
becomes 350, used stays 29, remaining is `350 - 29 = 321` → **321/350**, not a reset to 350/350
or a naive "just add to remaining" that would lose track of usage. The modal closes
immediately, the credit pill and composer both react instantly (plain React state, no refetch
needed), and a small green "N credits added" confirmation renders next to whichever control
opened the modal (the header pill or the composer's exhausted-state CTA) for ~2.5s.

## Development/demo testing mechanism

A "Demo tools" section inside the Add More Credits modal — visually separated by a divider,
labeled in small caps, distinct from the real purchase UI — has 4 small buttons ("Set
remaining: 50 / 10 / 1 / 0") that call `setRemainingCreditsForDemo(remaining)`, which sets
`usedCredits = totalCredits - remaining` directly. This is the "quickly exhaust credits without
sending 300 messages" mechanism the task asked for. It's deliberately not a separate hidden
surface — this is a demo prototype with no real prod/dev environment split, so the pragmatic
choice was a small, clearly-labeled, visually de-emphasized control co-located with the one
place a seller would naturally go to manage credits, rather than inventing a whole separate
"dev mode."

## Verification — all 6 scenarios (A–F) from the task

- **A. Normal usage**: 300/300 → send → 299/300, confirmed both by an automated test and live
  (watched the pill decrement 300→299→...→293 across 7 real messages sent across 5 different
  dispute chats during the Resolution Center walkthrough above — proving the charge is global
  to the workspace, not per-chat).
- **B. Low credits**: dev-set to 50 → pill renders with the warning style → clicking it opens
  Add More Credits. Confirmed both ways.
- **C. Last credit**: dev-set to 1 → send → 0/300 → composer disabled → "Buy Credits" CTA
  appears. Confirmed both ways.
- **D. Exhausted**: at 0/300, attempting to send (including firing a raw `Enter` keydown at the
  disabled textarea, bypassing the normal click path) never calls `fetch` — no request reaches
  the agent — and the balance never goes negative. Confirmed by an automated test asserting the
  mocked `fetch` was never invoked.
- **E. Purchase from zero**: 0/300 → Buy Credits (composer CTA) → modal → Buy Credits (default
  +50 selected) → 50/350, "50 credits added" toast, composer re-enabled. Confirmed both ways.
- **F. Purchase while credits remain**: dev-set to 271/300 → open modal via the header pill →
  Buy Credits (+50 default) → **321/350**, matching the task's worked example exactly.
  Confirmed both ways.

Automated coverage lives in `tests/CreditSystem.test.tsx` (6 tests, one per scenario, using the
same `ChatStoreProvider` + `ChatWorkspace` harness pattern as `tests/ChatFlow.test.tsx`, with
`CreditIndicator` mounted alongside it since credits render in the page header, not inside
`ChatWorkspace` itself). A real bug was caught by test E while writing it: the purchase
confirmation toast was originally rendered *inside* the composer's `{exhausted && ...}` block,
so it vanished the instant the purchase succeeded and `exhausted` flipped to `false` — fixed by
moving the toast to its own unconditional block.

## Known limitation

**No real billing or payment integration** — this is entirely mocked, as the task required.
`addCredits()` just increments a number in React state (persisted to localStorage like
everything else in this prototype); there is no Stripe, no subscriptions, no server-side
credit ledger, and no real cost is ever charged. If this prototype needs real billing later,
that's a new integration layer entirely, not an extension of `addCredits()`.

# Evidence File Upload (2026-08-21)

Upgraded the existing "Add evidence" form (evidence type / title / details / Add evidence)
into a full file-upload flow, without redesigning the modal or the Resolution Center around
it. No real storage, no real backend — every requirement was explicit that this stays mocked.

## What was built

- **`src/lib/evidenceUpload.ts`** (new) — pure logic module, no JSX: file-type/size constants,
  `formatFileSize()`, and the `useEvidenceFiles()` hook owning the file list and its mock
  upload pipeline.
- **`src/components/resolution/EvidenceUploadArea.tsx`** (new) — the presentational dropzone +
  per-file row list + image lightbox. Purely props-driven (`files`, `notice`, `onFilesAdded`,
  `onRemove`, `onRetry`) so all state/timing logic stays in the hook.
- **`src/components/resolution/AddEvidenceModal.tsx`** (rewritten) — gained a `"form" |
  "review"` step machine and an `EvidenceUploadArea` between Details and the footer buttons.
  Same 480px-wide modal chrome, same type-pill/title/details fields, same `btn-dark`/
  `btn-secondary` buttons as before — nothing about the existing visual language changed, the
  body just grew a step and a section.
- **`src/lib/disputeData.ts`** — `AIEvidenceItem` gained `category: string` (which checklist
  row this item belongs to) and `files: EvidenceFileMeta[]` (`{name, type, size, mockUrl}`,
  matching the task's requested shape).
- **`src/components/resolution/DisputeDetail.tsx`** — `ManualEvidenceCard` now renders each
  session-added evidence item under its category row (title + attachment count via a
  `Paperclip` icon), and shows a green "Evidence added successfully — …" confirmation for 3s
  after a submission.
- **`src/App.tsx`** — added `evidenceByDispute: Record<string, AIEvidenceItem[]>` state in
  `AppShell` (not inside `DisputeDetail`) specifically so evidence survives the seller
  navigating back to the Resolution Center list and returning — `DisputeDetail` fully unmounts
  while `rcView === "list"`, so anything stored in its own local state would have been lost;
  lifting it to the component that never unmounts satisfies the task's "remain represented for
  the duration of the session" requirement without adding a persistence layer.

## File constraints (new — none existed before this pass)

No file-type or size limits existed anywhere in the prototype before this pass. Used the
task's own suggested defaults, since there was nothing established to match:
**Supported: JPG, PNG, WEBP, PDF, DOC, DOCX. Maximum size: 10 MB per file.** Shown directly in
the UI (`src/lib/evidenceUpload.ts`'s `SUPPORTED_LABEL`/`MAX_FILE_SIZE_BYTES`).

## Validation (client-side, never silent)

Checked per file on selection, in this order: **duplicate** (same name + size as an existing
file — rejected with an inline notice under the dropzone, not added as a second row, since a
literal duplicate has no value as a separate list entry) → **empty** (0 bytes — "This file
appears to be empty or corrupted") → **unsupported type** → **oversized** (states the file's
actual size against the 10 MB limit). Unsupported/oversized/empty files ARE added to the list
(status `"error"`, red-outlined row, inline reason + Retry), per the task's explicit "do not
silently reject" — the seller sees exactly which file failed and why, and can remove or retry
it. The primary button stays disabled while any file is present in a non-`"ready"` state
(including `"error"`), so a bad file must be dealt with before continuing — attachments
themselves are optional, so 0 files never blocks the flow.

## Upload/processing simulation

Every valid file runs `selected → uploading (550ms) → processing (550ms) → ready`, timers
owned by `useEvidenceFiles()` and cleaned up on unmount. **Deterministic failure demo**: a
filename containing "fail" (case-insensitive) always fails at the upload step instead of
reaching "processing" — same convention as the chat pipeline's hidden "all roads lead to" test
phrase, giving a reproducible way to demo the "Upload failed" + Retry state without real
randomness. Retry re-runs the exact same pipeline (so retrying a permanently-"fail"-named file
fails again by design — the seller is expected to remove and replace it, which the UI
supports).

## Review step

Clicking "Add evidence" on the form only advances to a review screen if `title` is non-empty
and every file is `"ready"` — it does not submit immediately (per the task, section 6). The
review screen shows Evidence type / Title / Details / Attachments (name + size per file, with
a count in the section header) inside the existing `content-card` treatment, plus Cancel /
Back / **Submit evidence**. Back returns to the form with every field and file intact (the
form component doesn't unmount between steps — same `AddEvidenceModal` instance, just a
`step` state flip).

## Success state & Agent-context data shape

On submit, the modal closes and `ManualEvidenceCard` shows "Evidence added successfully —
"{title}" added — N files." for 3 seconds, the category row's badge flips to "Added" (or "Add
another" becomes available), and a compact sub-line lists the item's title + attachment count
— visible immediately and again on any later visit to the same dispute within the session.
Each stored `AIEvidenceItem` carries exactly the shape the task asked for future Agent
reasoning to use:
```ts
{ id, title, record, why, sourceType, sourceLabel, addedBy, category,
  files: [{ name, type, size, mockUrl }] }
```
Per the task's explicit scope, this phase does **not** wire that data into the Agent/stub LLM
— no ingestion, OCR, embeddings, or LLM processing were implemented; the "mock ingestion
pipeline" the task asked for is the Selected→Ready state machine itself, and the stored
metadata is what a later phase would hand to the Agent.

## A real bug this feature caught during its own testing

`addFiles()` originally computed which files to schedule for upload (`toSchedule`) by mutating
an array *inside* the `setFiles()` updater callback, then read that array immediately after —
React does not guarantee an updater function runs before the next line of code executes, so
`toSchedule` was empty when `.forEach()` ran, and newly selected files silently never left the
"selected" state (stuck showing "Waiting…" forever). Caught by the live-verification pass
below (files never reached "Ready"), fixed by building the new `EvidenceFile` entries with
plain synchronous JS against `filesRef.current` *before* calling `setFiles`, then scheduling
directly from that plain array — no dependency on React's update timing. Locked in by
`tests/EvidenceUpload.test.tsx`'s first test (asserts the full Selected→Ready transition under
fake timers).

## Verification

- `npx tsc -b`, `npm run lint`, `npm run build` — clean.
- **9 new tests** (`tests/EvidenceUpload.test.tsx`): the Selected→Ready pipeline under fake
  timers, each validation rule (unsupported type, oversized, empty, duplicate), the disabled→
  enabled button transition on removing a bad file, the deterministic failure trigger +
  retry, the full form→review→submit flow asserting the exact `AIEvidenceItem` payload
  (category, ready-files-only), and Back preserving form state.
- **Live browser walkthrough** (screenshots retained in job scratch space) covering all 10
  scenarios the task asked to manually test: one image (thumbnail preview, reaches Ready), one
  PDF, multiple mixed files together, an invalid file type (`.txt`, shown as an error row),
  an oversized file (11 MB, shown with its actual size), removing attachments (invalid ones,
  confirmed the button re-enables), adding more files afterward, the review step (correct
  type/title/details/attachment count and list), a successful submission (toast +
  category-row update), and evidence still present after navigating back to the Resolution
  Center list and returning to the same dispute. Also exercised beyond the required 10: the
  duplicate-file notice and the image lightbox. Zero console errors throughout.

## Known limitations

- **Files are never actually uploaded anywhere.** `EvidenceFileMeta.mockUrl` is a browser
  object URL (image files, revoked on removal/unmount) or a synthetic `mock://evidence/…`
  string (everything else) — nothing leaves the browser tab, and nothing survives a real page
  reload (evidence lives in `AppShell` React state only, not localStorage — a deliberate choice
  since the task scoped this to "for the duration of the session," not persistent storage).
- **The AI Agent doesn't know these files exist yet.** Per the task's explicit "do NOT
  implement... for this phase," `PageContext`/the stub LLM were not touched — a future pass
  would need to decide how `AIEvidenceItem.files` surfaces into the Agent's dispute context.
- **Drag-and-drop shares its handler with the file-picker input** (`onDrop` calls the identical
  `addFiles()` the `<input>`'s `onChange` calls), so it was verified by code review and a
  visual hover-state check rather than a simulated OS drag gesture — Playwright's synthetic
  `DataTransfer` drag simulation was judged not worth the added script complexity here since
  the two paths converge immediately into the same, already-tested function.
- **Image "corruption" detection is limited to 0-byte files.** A file with a valid extension
  and non-zero size but genuinely corrupted image data would still be accepted and attempted
  as a thumbnail (which would just fail to render) — full content-sniffing validation is out
  of scope for a client-side mock.

# Audit Implementation Pass (2026-08-21)

Executed `PRODUCT_READINESS_AUDIT.md`'s roadmap (Phases 1–3) plus a new connected-apps
branding requirement, in three phase-sized commits. Everything below was verified live in the
browser (20-check Playwright walkthrough covering the 12 flows the task listed, zero console
errors, screenshots in job scratch space) on top of 94/94 automated tests.

## Phase 1 — answer quality & rendering (all 8 P0s)

- **P0-1**: `liteMarkdown.tsx` rewritten to segment line-wise — `###` headings and `-` lists
  render correctly whether joined by `\n` or `\n\n`; the flagship investigation answer no
  longer shows literal `###` markup. The stub keeps single-`\n` joins; the renderer is now
  robust to both (belt-and-suspenders was judged unnecessary once the renderer handles it).
- **P0-2/P0-5**: unfiltered `fanbasis_list_transactions` returns a `MONTH_SUMMARY` rollup
  ($18,420 / 62 transactions / top products / LAUNCH20 / 3 refunds / 4 open disputes worth
  $1,776) so "Summarize my sales" and the Dashboard's revenue chip produce a structured
  narrative that matches the Dashboard by construction. The dashboard chip was reworded to
  "What's driving my revenue this month?" — the old "why did revenue drop" contradicted the
  +12% the page itself shows.
- **P0-2/§8.1**: new prototype-only `commas_list_disputes` tool; "Analyze my disputes" in a
  global chat now yields the real 4-dispute portfolio (sorted by due date, resolved case
  noted) instead of a #2481 deep-dive. Dashboard "Disputed payments" card and the seed sales
  chat updated to the same 4-disputes/$1,776 story.
- **P0-3/P0-8**: `synthesizeDisputeInvestigation` grounds its "My read"/"Recommendation" in
  the specific dispute's authored fields (uncertainty preserved for David Kim, resolution for
  Priya), and reports each checked source honestly — empty results say "no email threads
  found", never "no connected apps were available" under a "Checked 5 sources" receipt.
- **P0-4**: cross-apps prompts keep their own flow (checked before the dispute chain; chain
  continuation now requires `commas_get_dispute` in this turn's history) and end in a
  per-source synthesis (P1-2) instead of a bare count.
- **P0-6**: fallback rewritten in product voice (never "preview"/"demo"); acknowledgments
  ("thanks", "ok") get an in-character reply.
- **P0-7**: "Help me respond to a customer" asks *who*, listing recent customers; the named
  follow-up routes through the existing lookup branch.

## Phase 2 — context & state hygiene

- **P1-1**: the AI panel closes on any page navigation (sidebar, RC list↔detail) — no more
  "Dispute #2481" panel floating over the Dashboard as if current.
- **P1-3**: context-less panel opens (RC-list floating button) create/reuse a general chat
  instead of resurfacing the last contextual one.
- **P1-4**: agent-unreachable copy is product-voice ("temporarily unreachable") — the
  "npm run dev:server" text is gone from both error paths.
- **P1-5/P1-6**: suggestion chips render disabled at 0 credits or while another chat's run is
  in flight, and `sendMessage` itself refuses a second concurrent run (chips bypassed the
  composer's disabled state and could strand the first chat in "running" forever).
- **P1-8**: chats persisted mid-run reconcile to `idle` on load with a "response was
  interrupted" note.
- **P2-10**: storage key bumped to `commas-ai-agent:v2` so stale rehearsal stores don't serve
  the old contradictory seed copy.

## Phase 3 — story completeness + GoHighLevel branding

- **Connected apps requirement**: `SourceIcon.tsx` now renders hand-drawn, brand-colored
  simplified marks for Google Calendar (blue "31" tile), Zoom (blue camera squircle), Fathom
  (violet waveform), Gmail (multicolor M envelope), and GoHighLevel (navy double-chevron) —
  shared 24×24 viewBox, consistent at every size the app uses. **CRM → GoHighLevel** in every
  user-facing string (sources menu, connected-apps modal, agent answers, progress labels,
  Missing-information lists); the internal `SourceId` stays `"crm"` deliberately — renaming
  the id would ripple through persisted chats/tests for zero visible benefit.
- **P1-7**: Elena Cruz (#2417) ships 3 inspectable seed evidence items (two duplicate-charge
  receipts on one item, checkout retry log, her own support email); David Kim (#2455) gets
  exactly one sparse receipt, matching his inconclusive story.
- **P1-9**: new "communications" dispute intent — fetches the dispute, pulls live Gmail
  threads when the source is enabled (says so plainly when it isn't), and answers from a new
  per-case `communicationsSummary` field authored for all 5 disputes.
- **P1-10**: an approved "mark response ready" write action now shows a "Marked ready by AI"
  success badge on the dispute's response card (`markedReadyDisputeIds` in the chat store,
  set only on a successful approved execution; session-only, mirroring the backend's
  in-memory flag).
- **P1-11**: a dispute chat opened "in full Chat view" gets a highlighted, gavel-marked row
  in the history list instead of existing nowhere.
- **§11.2/§11.3**: a missing GoHighLevel contact is an honest empty result (was a connector
  error); naming a disconnected source gets a specific "turn it on in Sources" reply.

## Audit recommendations deliberately NOT implemented (and why)

- **Phase 4 / P2 items** (P2-1 D/W/M/Y data, P2-2 announcement carousel, P2-3 RC search,
  P2-4 live context rebuild, P2-5 agent-sees-uploaded-evidence, P2-6 dispute composer
  placeholder, P2-7 panel width, P2-8 history timestamps, P2-9 connect confirmation line,
  P2-11 approved-line cosmetic): the audit itself gates Phase 4 behind "only after everything
  else is done and verified" and the task said not to overbuild — P0/P1 exhausted the
  materially-demo-improving set. All remain open, documented, and small.
- **Everything in audit §6 "Do Not Build"** (real OAuth/MCP/LLM wiring, router, backend
  persistence, SSE, connector failure simulations, new dispute statuses, message
  edit/regenerate): explicitly out of scope, unchanged.
- **Audit's suggested `\n\n` re-join in the stub (half of P0-1)**: skipped as redundant once
  the renderer handles single-`\n` input — one robust fix beats two coupled ones.

## Verification

- `npx tsc -b`, `npm run lint`, `npm run build` — clean. **94/94 tests** (was 82: +8 P0
  regression tests incl. the required liteMarkdown/#2455/cross-apps/$18,420/no-"preview"
  assertions, +2 busy-guard & interrupted-run tests, +2 communications-intent tests).
- Live 20-check walkthrough of the task's 12 flows: global chat (sales narrative matches
  Dashboard, portfolio answer, in-character fallback), history + deletion, dispute AI with
  context header and 7 chips, investigation rendering with real headings and honest findings,
  mark-ready → visible badge, panel closing on navigation, dashboard revenue narrative,
  GoHighLevel branding in menu/modal, communications intent, resolved read-only, Elena's
  seeded evidence, credit pill consistency across surfaces. Zero console errors.

# Resolved Disputes Are Read-Only (2026-08-21)

Previously, `DisputeDetail.tsx` showed the same editable checklist/response UI regardless of
dispute status — a resolved case (Priya Nair, #2390, Won) still displayed "Add another"
buttons and an empty "Your response" textarea with active Save draft/Submit response buttons,
which is wrong for a closed historical record.

## Read-only rule

`isResolved = dispute.status !== "Needs response"` (written as a negation, not `=== "Won"`,
so a future "Lost" status is read-only too without another branch). One `DisputeDetail`
implementation, conditionally rendered — not two page variants, per the task's explicit
instruction.

- **Evidence card** (`ManualEvidenceCard`): the Add/Add-another button is hidden entirely when
  `isResolved`; the category checklist, Added/Not-added badges, and item counts are unchanged
  either way. Every evidence item (seeded or session-added) now renders its full title +
  description, not just a count — a strictly richer display applied uniformly to both resolved
  and active disputes, so there's no separate "historical" rendering path.
- **Attachments are clickable in both states**: a new `AttachmentChip` (icon + filename) opens
  `AttachmentPreviewOverlay` — images render directly (including resolved cases' seeded
  placeholder images, see below); other file types show an honest "Preview isn't available for
  this file type in the prototype" card rather than pretending to open a real document.
- **Response section**: resolved disputes show a new read-only "Submitted response" card
  (`dispute.submittedResponse.text` + "Submitted on" + "Status: Submitted") instead of the
  editable textarea/Save draft/Submit response controls. Active disputes are completely
  unchanged.
- **"Investigate with AI" is hidden entirely for resolved disputes** (`!isResolved &&`,
  header row). An earlier pass of this same task deliberately kept it enabled — the stub LLM's
  dispute-intent branch already answers resolved-case questions safely ("already resolved",
  "nothing left to draft") — but the user reviewed the live result and asked for the button
  removed outright for closed cases regardless, so a resolved dispute now shows no AI entry
  point on the page at all. Active disputes are unaffected. The stub's resolved-case answers
  (still exercised by `tests/server/disputeIntents.test.ts`) remain correct and available via
  any other dispute-context chat that already exists for that record — this change only
  removes the *button that starts one* from the resolved dispute's own page.

## Demo data added (Priya Nair, #2390)

`DisputeCase` gained `seedEvidenceItems: AIEvidenceItem[]` (pre-existing historical evidence,
merged into `App.tsx`'s `evidenceByDispute` state via a lazy `useState` initializer) and
`submittedResponse?: { text, submittedAt }`. Priya's case ships with 4 seeded items across 4
categories — one with 2 attachments (a signed PDF + a screenshot, satisfying the task's "at
least one item with multiple attachments") — and a full submitted-response paragraph dated
August 8, 2026. All other cases get `seedEvidenceItems: []` (unchanged, badge-only checklist
behavior). Seeded image attachments use `mockImageDataUri()` — a real, valid, honestly-labeled
inline SVG data URI ("Mock evidence preview") rather than fabricating a fake real photo; no
actual file bytes exist for historical data, consistent with the Evidence Upload pass's "no
real storage" constraint below.

## Verification

- `npx tsc -b`, `npm run lint`, `npm run build` — clean.
- Live browser: Priya's dispute shows 6/6 evidence items added, zero Add/Add-another buttons
  anywhere, all 4 seeded items' titles visible with clickable attachment chips, a working image
  lightbox and an honest non-image fallback, a "Submitted response" card with no textarea/Save
  draft/Submit response, and "Submitted on"/"Status: Submitted" fields. Sarah Johnson's active
  dispute (#2481) confirmed unchanged in the same pass — Add buttons and the editable response
  card still present (regression check).

# Dispute AI Session Identity (2026-08-21)

Fixed the relationship between the global Chat history and a dispute's contextual AI session,
and — while verifying it — found and fixed a real bug that made the dispute AI panel go
completely blank under a specific sequence.

## What the investigation found

Before writing any fix, the architecture was read and then verified live (not assumed):
`RightPanel`, `ChatHistoryList` (the main Chat page's history), and the dispute panel's
"Investigate with AI" flow all already read from the **same single `chats` array** in
`useChatStore.tsx` — there was never a separate/stale copy of chat history for disputes.
`ChatHistoryList.tsx` deliberately filters dispute-context chats out of the *main* history
list (`!c.context`), which is correct (a dispute's working chat shouldn't clutter the general
list) — but it also meant there was **no delete affordance reachable anywhere** for a
dispute's chat, so the task's Case D (delete a dispute's session, confirm it doesn't come
back) wasn't even triggerable through the UI as it stood.

## What was built

- **`RightPanel.tsx`** gained a "Start new session" button (only shown on a dispute-context
  chat with at least one message) that calls the exact same `deleteChat()` the main sidebar's
  trash icon uses, then closes the panel. This is the single, real delete path for a dispute's
  chat — not a new parallel mechanism.
- **`mockData.ts`**'s `DISPUTE_SUGGESTED_CAPABILITIES` grew from 5 to 7 chips ("Investigate
  this dispute," "Why is this dispute open?," "Find missing evidence," "Review customer
  communications," "Draft my response," "Summarize this case," "What should I do next?"),
  matching the task's example set. Every prompt was written to hit a real, already-tested stub
  branch (either the dispute-intent why/evidence/draft/recommend/summarize router, or the
  multi-source investigation chain via the word "dispute") — none fall through to the generic
  "This preview only knows…" fallback the task explicitly said not to show.
- **`EmptyState.tsx`** gained a `DisputeSummaryHeader` (shown above the greeting, dispute
  context only): "Dispute #{id}" + "{customer} · ${amount} · {reason}" at a glance, so a fresh
  session is unmistakably scoped to the right record. The greeting itself changed from
  "Investigating {label}" to "How can I help resolve this dispute?" for dispute chats.
  `ChatWorkspace.tsx` now passes `context` through to `EmptyState` instead of rendering a
  `ContextChip` above it for the empty-state case specifically; the in-conversation `ContextChip`
  (shown once messages exist) is completely unchanged.

## A real bug found and fixed: `createChat()`'s returned id was sometimes empty

Live-testing Case D (delete → reopen) surfaced a genuine bug: after "Start new session" →
"Investigate with AI" again, the panel rendered **nothing** — not stale content, not a fresh
empty state, just gone. Diagnosed by reading `chats` directly out of `localStorage` at each
step: the new chat *was* being created correctly in the data layer, but `RightPanel` had bound
to an empty-string `chatId`. Root cause: `createChat()` mutated a `resultId` variable *inside*
the `setChats()` updater callback and returned it immediately after — the exact same bug class
already found and fixed in `src/lib/evidenceUpload.ts`'s `addFiles()` this session (React does
not guarantee an updater function runs before the next line of code executes). Fixed the same
way: added a `chatsRef` mirror and rewrote `createChat()` to compute the existing-or-new chat
with plain synchronous JS against `chatsRef.current`, then apply it via one `setChats` call —
the return value no longer depends on reading anything out of React's update timing. Audited
the rest of `useChatStore.tsx` for the same pattern (`let result`/`let target` mutated inside
an updater); no other instances found.

## Verification — all 4 cases from the task

- **Case A** (new global chat unrelated to disputes): confirmed live — a message sent in a
  fresh global chat appears in the main Chat history, and does not appear anywhere in a
  separately-opened dispute's AI panel.
- **Case B** (fresh dispute-resolution suggestions when no session exists): confirmed live —
  opening a dispute with no prior chat shows the `DisputeSummaryHeader` + "How can I help
  resolve this dispute?" + all 7 contextual chips, not generic content.
- **Case C** (existing session reopens): confirmed live — sending a message, closing the
  panel, and reopening via "Investigate with AI" resumes the exact same conversation.
- **Case D** (deleted session never resurrects): confirmed live, including the intermediate
  bug above — after the fix, "Start new session" → "Investigate with AI" shows the fresh
  empty state (not the old conversation, not a blank panel), and `localStorage` confirms the
  old chat is genuinely gone (0 dispute-context chats immediately after delete, exactly 1 new
  one after reopening).
- **3 new automated tests** (`tests/DisputeChatSession.test.tsx`): `createChat()`'s returned id
  is always immediately resolvable to a real chat; delete-then-reopen produces a different,
  real chat (not the stale id, not nothing); repeated opens on an untouched empty chat reuse
  the same id (no pile-up, the pre-existing dedup behavior — confirmed still intact).
- `npx tsc -b`, `npm run lint`, `npx vitest run` (82/82, +3 net), `npm run build` — all clean.

## What was explicitly not changed

Per the task's "do not redesign the global Chat UI": `ChatHistoryList.tsx`, the composer, the
credit indicator's placement/styling, and the main Chat page's navigation are all untouched.
The fix is scoped entirely to the dispute-context path (`RightPanel`, `EmptyState`,
`ChatWorkspace`'s dispute branch, `DISPUTE_SUGGESTED_CAPABILITIES`) plus the one shared-store
bug in `createChat()` that affected correctness regardless of UI surface.

# Post-Audit Fixes: Due Dates, GoHighLevel Naming, Demo Reset (2026-08-21)

Three small, user-flagged fixes made after the audit implementation pass above.

## Evidence due date = 14 days from dispute date

The seller flagged (via screenshot of the Resolution Center list) that "Evidence due by"
dates weren't a consistent 14 days after each dispute's `openedAt` — leftover from earlier
demo-data edits across sessions. Recomputed all 5 cases in `src/lib/disputeData.ts` and its
backend mirror `server/mcp/mockCommasServer.ts` (`DISPUTES` array, ISO dates):

| Case | Opened | Evidence due (was → now) |
|---|---|---|
| #2481 Sarah Johnson | Aug 9 | Aug 13 → **Aug 23** |
| #2502 Marcus Webb | Aug 15 | Aug 22 → **Aug 29** |
| #2417 Elena Cruz | Aug 11 | Aug 25 (already correct) |
| #2455 David Kim | Aug 17 | Aug 24 → **Aug 31** |
| #2390 Priya Nair (resolved) | Aug 3 | Aug 7 → **Aug 17** |

`evidenceDueLabel` strings (`"Due in N days"`) were recomputed against the app's implicit
"today" of August 21, 2026 (consistent with the 3 labels that were already correct — #2502/
#2417/#2455 all implied today = Aug 21 before this fix; only #2481's label was stale).
Updated the one seed-chat mention of #2481's due date in `src/lib/mockData.ts`, and the
hardcoded due-date strings in `tests/server/app.test.ts` / `tests/server/runtime.test.ts` that
feed a manually-constructed dispute context (values only need to be well-formed for those
tests, but kept them consistent for readability). 94/94 tests still pass.

## Remaining "CRM" references renamed to GoHighLevel

The audit pass (Phase 3 above) already renamed CRM → GoHighLevel in every user-facing surface
and most code comments; a few were missed: the LLM system prompt in
`server/agent/runtime.ts` (`buildSystemPrompt` — this text can appear in real-LLM-mode
reasoning, not just the stub), and doc comments in `src/lib/types.ts`, `server/app.ts`,
`server/adapters/types.ts`, `tests/server/app.test.ts`. The internal `SourceId` value stays
`"crm"` (identifier, not user-facing) — only prose mentions were renamed.

## Reset demo data button

The seller's workflow during a live demo: use the credit modal's existing "Demo tools" (Set
remaining: 50/10/1/0) to show the low/exhausted-credit UI states, then need to get back to a
clean slate to demo chat normally — previously the only way was clearing localStorage by hand.
Added a "Reset all demo data" button to `AddCreditsModal.tsx`'s existing Demo Tools footer
(same section, same audience — dev/demo-only, not a production affordance). It calls the
`resetDemo()` action that already existed on `useChatStore` (chats/sources/credits back to
seed) but was never wired to any UI, then force-reloads the page — the reload is needed
because evidence added via "Add evidence" lives in `App.tsx`'s own `evidenceByDispute` state,
not the chat store, and isn't persisted to localStorage in the first place (it's reseeded from
`DISPUTES[].seedEvidenceItems` on every load), so a reload resets it for free. Also fixed
`resetDemo()` itself to clear `markedReadyDisputeIds` (previously missed — a mark-ready badge
from a prior demo run would have survived a reset). The credit pill (`CreditIndicator`) that
opens this modal is clickable at any balance, including 0, so it's reachable from the exact
"credits exhausted" state the seller described wanting to escape.

## Verification

Playwright, fresh localStorage: all 4 open disputes' Resolution Center rows show the corrected
dates (Aug 23/29/25/31); Sarah's detail page shows "August 23, 2026 (Due in 2 days)"; the
dispute chat's Sources menu shows "GoHighLevel" with no bare "CRM" anywhere on the page;
draining credits to 0/300 via the demo buttons then clicking "Reset all demo data" restores
300/300 credits after reload. `npx tsc -b`, `npx vitest run` (94/94) both clean.

# Production Deployment (2026-08-2x, most recent phase before the Evidence UI Overhaul)

The prototype moved from "runs locally" to "live on the internet, password-gated, on a real
domain, on a real (free) LLM" this pass. Repo moved to a **private GitHub remote** —
`Open Question 3` from earlier in this file is resolved.

## What was built

- **`api/index.ts`** — Vercel serverless entry point. Must export a Web-standard
  `async function fetch(req: Request)` (named export, from `hono/vercel`'s `handle()`) — a
  legacy `(req, res)` default export **silently hangs every request** on Vercel's Node
  runtime. `createApp()` is memoized across invocations.
- **`vercel.json`** — explicit `{"rewrites": [{"source": "/api/(.*)", "destination": "/api"}]}`.
  Vercel's filesystem-based `api/[...path].ts` catch-all convention was tried first and found
  to **only match single path segments in production** (worked for `/api/health`, broke for
  `/api/agent/stream`) — not documented behavior, discovered live. The explicit rewrite is the
  fix and is now the required pattern for any new API route.
- **`middleware.ts`** — Vercel Edge Middleware, HTTP Basic Auth checked against
  `process.env.SITE_PASSWORD`. **The `WWW-Authenticate` realm string must be pure ASCII** — an
  em dash in it broke *every* unauthenticated request in production (Edge Middleware headers
  reject non-ASCII silently in a way that never surfaced locally). Fixed to plain ASCII.
- **LLM provider chain** (`server/app.ts`), in priority order: `ANTHROPIC_API_KEY` >
  `OPENROUTER_KEY` > `GEMINI_API_KEY` > `StubLlmClient`. All three real providers are fully
  implemented (`server/llm/{openrouterClient,geminiClient}.ts` +
  `server/llm/streaming/{openrouterStreamClient,geminiStreamClient}.ts`), swappable via env
  vars with zero code changes, matching the existing `AnthropicLlmClient`/`StubLlmClient`
  pattern from "Commas Tool Layer" above.
  - **OpenRouter is what's actually live in production.** Model settled on
    `nvidia/nemotron-3-super-120b-a12b:free` after two failed attempts:
    `meta-llama/llama-3.3-70b-instruct:free` was found **retired** live, and
    `google/gemma-4-31b-it:free` was found routed through Google's own congested shared free
    pool (constant 429s). OpenRouter's OpenAI-compatible tool-calling gives each tool call a
    real `id`, which sidesteps the Gemini issue below.
  - **Gemini was tried first and abandoned as the primary** because Gemini 3.x's free tier
    requires a `thought_signature` on every tool-call turn to replay history, which broke
    multi-turn tool-history replay; worked around by rendering tool history as plain text
    turns instead of structured `functionCall` parts (same fix applied to both
    `geminiClient.ts` and `geminiStreamClient.ts`), but the free-tier rate limit still proved
    too restrictive for live demo use, hence the fallback to OpenRouter as primary.
  - `GET /api/health`'s `llmMode` field now reports `"openrouter"` in production (verified
    live, see below) — Open Question 1 ("real LLM calls") is **partially resolved**: a real
    (non-Anthropic) LLM is live and demo-tested; `AnthropicLlmClient` itself remains real,
    complete code that has still never been exercised (no Anthropic key was added).
- **Domain:** live at **addmorecommas.com** (corrected mid-session from an initially-assumed
  "makemorecommas.com" — the user does not own that domain). DNS configured via Namecheap,
  aliased through Vercel.
- **Password protection:** password is `,,,` (Basic Auth, any username). This is a demo gate,
  not real auth — do not treat it as a security boundary beyond "keep casual visitors out."
- **Commas app icon/favicon:** `public/commasdefault.png` (the real Commas app icon, provided
  by the user) is wired into `index.html` (favicon + apple-touch-icon) and
  `src/components/shell/Sidebar.tsx`'s logo tile, replacing the placeholder `CommaMark` SVG and
  the old `public/favicon.svg` (deleted).
  - **Near-miss:** this exact file was accidentally deleted mid-session by an overbroad
    `git add -A` that swept it up as if it were a stray artifact, before it had ever been
    wired into the UI (so its purpose wasn't yet obvious from the diff). Recovered via
    `git show <commit>:commasdefault.png` from git history. **Lesson for future sessions:**
    before running `git add -A` / `git rm` on files that look unfamiliar or unreferenced,
    check whether the user just added them for upcoming work — don't assume "unreferenced yet"
    means "safe to delete."
- **Prompt/behavior fixes found during live testing on the deployed instance:**
  - The model was leaking raw internal tool names (e.g. `fanbasis_list_customers`) and raw
    snake_case reason codes (e.g. `product_not_received`) into user-facing chat responses.
    Fixed via explicit instructions in `BASE_PERSONA` (`server/agent/context/buildContext.ts`)
    never to surface internal tool names, plus a `humanizeReason()` helper that strips
    underscores from machine reason codes only when rendering them into the prompt.
  - "Recommended next steps" in chat responses were verbose paragraphs; the user asked for
    them to be "very very crisp: like 1-2 sentence long max and in numbered pointers as less as
    possible" — added as an explicit `BASE_PERSONA` instruction.
  - The model sometimes asked for confirmation in chat text before a write action, redundant
    with the existing approval-card UI (see "Conversation System... Write-Approval Flow"
    above) — fixed via an explicit system-prompt instruction (`server/agent/runtime.ts`'s
    `toolsPrefix`) to call write tools directly and let the approval card be the only gate.

## Standing git workflow instruction (must persist across sessions)

**Do not merge everything to `main` directly.** Commit locally and push to
`experiment/unified-ai-assistant` as work proceeds; only push/merge that branch into `main`
when the user explicitly says so ("at the very end"). `npx vercel deploy --prod --yes` deploys
whatever is in the local working directory regardless of which branch is checked out — a
production deploy is **not** a signal that `main` has been (or should be) updated.

## Verification

- Full test suite, typecheck, lint, and build all clean at time of deploy.
- Live production checks via `curl` (no browser automation available for this project):
  unauthenticated request → 401; correct password → 200; `GET /api/health` → `{"ok":true,
  "commasConnected":true,"llmMode":"openrouter", sources: [commas, fathom, zoom, gmail,
  google-calendar, crm]}`.

## What's still open from this pass

- `AnthropicLlmClient` remains real, complete, and **never live-tested** — no Anthropic key
  was ever added to this environment. If/when one is added, `llmMode` should flip to
  `"anthropic"` automatically per the existing priority chain, no code changes expected.
- OpenRouter's free-tier model landscape is volatile (two models were already found
  retired/congested before landing on the current one) — if `nvidia/nemotron-3-super-
  120b-a12b:free` stops working, check https://openrouter.ai/models?max_price=0 for a current
  free alternative and swap the model string in `server/llm/openrouterClient.ts` +
  `server/llm/streaming/openrouterStreamClient.ts`.
- The password gate is Basic Auth against one shared static password — fine for a demo, not a
  real access-control system. Don't extend this pattern if the project ever needs real
  multi-user auth.

# Evidence UI Overhaul: Source-Reference Chips, Accordion Drawer, Review-State Removal
(2026-08-25)

A large, multi-message UI/UX request arrived this session covering (a) an accordion-style
evidence checklist with a detail drawer (superseding the old flat evidence list), (b)
generalizing evidence source provenance into a reusable, connector-agnostic chip component,
(c) folding file upload into the same edit modal, and (d) removing the evidence review/
approval state entirely. All four landed in this pass. `docs/AI_ASSISTANT_BASELINE.md`,
`src/pages/DashboardPage.tsx`, and `src/components/shell/TopNav.tsx` were also updated to say
**addmorecommas** instead of **makemorecommas**, matching the live domain corrected in the
deployment pass above.

## 1. Evidence checklist accordion + detail drawer

- Each evidence **category** (e.g. "Access & activity records") is now a collapsible accordion
  section (`src/components/resolution/DisputeDetail.tsx`); expanding it reveals its individual
  evidence entries, each showing its own title, source/file-count metadata, and attachment
  chips — a "case-file" hierarchy replacing the old flat preview list.
- Clicking an entry opens **`EvidenceDetailDrawer`** (new file,
  `src/components/resolution/EvidenceDetailDrawer.tsx`) as a **center modal** (higher-opacity
  background, not a translucent side drawer — an earlier translucent right-side drawer draft
  was rejected by the user for letting page content bleed through). Shows title, record/
  description, and all attached files; editable when the dispute is open, read-only when
  resolved.
- Real DOM-nesting bug caught by a test warning: an `<button>` was nested inside another
  `<button>` (an attachment chip inside a clickable accordion row) — browsers silently
  un-nest this, breaking clicks. Fixed by using `role="button"` divs with keyboard handlers
  for the category header and entry rows instead of literal nested `<button>`s.

## 2. Connector-agnostic source-reference chips (replaces "Inspect underlying source")

- **Removed entirely:** the plain-text "Inspect underlying source" affordance, everywhere it
  appeared (`EvidenceDetailDrawer`, `InvestigationReportCard`).
- **New model** (`src/lib/types.ts` + mirrored in `server/types.ts`):
  `EvidenceSourceRef { sourceId: SourceId; raw?: Record<string, unknown> }`. Both
  `ProposedEvidenceCandidate` and `AIEvidenceItem` gained an optional `sources?:
  EvidenceSourceRef[]`. This is deliberately **not** part of the `propose_add_evidence` LLM
  tool's JSON schema — a real model can't fabricate `raw` tool-result payloads as output, so
  only `StubLlmClient` attaches `sources` directly (bypassing the schema); real-model-proposed
  candidates fall back to a derived single source.
- **New reusable component** (`src/components/chat/SourceReferenceList.tsx`): renders one
  clickable chip per source (icon + connector name + external-link glyph, ChatGPT-citation
  style), driven purely by `sourceId` against the existing `SOURCES` registry
  (`src/lib/mockData.ts`) and `SourceIcon` (`src/components/chat/SourceIcon.tsx`) — **zero
  per-connector conditionals**. Any connector added to `SOURCES` automatically gets chip
  support with no UI changes. Clicking a chip opens the existing `EvidenceInspectorModal` with
  the connector's real mock payload.
- **Derivation helper** (`src/lib/mockData.ts`): `deriveEvidenceSourceRefs(item)` prefers
  `item.sources` if present, else attempts a strict label match (new private
  `matchSourceIdFromLabel`, no fallback guessing), else returns `[]` — deliberately never
  guesses a source for an unmatched label like a seller's own manual entry (the existing
  lenient `sourceIdFromLabel` helper, which *does* default to `"commas"`, is kept for other
  call sites that need a guaranteed value).
- `InvestigationReportCard`'s read-only "AI found" badge on **not-yet-added** findings
  (`evidenceFound`) was **deliberately kept** — judged a distinct concept from added case
  evidence per the removal request's own scoping language ("once the seller has chosen to ADD
  the evidence..."). If this reads as inconsistent to a future reviewer, that's the reasoning;
  revisit only on explicit user feedback.

## 3. Unified edit + upload modal

- `updateEvidenceItem`'s signature changed from `{title, record}` to `{title, record, files}`
  — this single action now covers what used to be two separate actions (edit, and the removed
  `confirmEvidenceProof`). `proofConfirmed` is recomputed on every save:
  `!item.proofRequired || files.length > 0`.
- Clicking Edit on an evidence item now opens the **same** `EvidenceDetailDrawer` in edit mode
  with a full upload experience inline: a dropzone when empty, a compact removable file list
  when files exist, "+ Add more files," and an inline validation message ("Supporting proof is
  required for evidence from external sources") blocking Save when proof is required and
  missing. No separate upload modal was introduced.
- Pre-existing attached files (plain metadata, not real `File` blobs) can't be fed into the
  existing upload-simulation pipeline (`useEvidenceFiles`) designed for real file objects — this
  was resolved by keeping them in a separate `keptFiles` array (simple removable list) merged
  with newly-uploaded files only at Save time.

## 4. Evidence review/approval state removed entirely

- **Deleted:** `verifiedByHuman` field, the `verifyEvidenceItem` action, the "Mark as
  reviewed" button, and the "Reviewed"/"AI found" badges **on added case evidence**
  (distinguish from the InvestigationReportCard exception in §2 above — that's unconfirmed
  *findings*, not added evidence).
- Added evidence is now **active immediately** — no review/approval step exists in the product
  at all for it. Each evidence row now exposes only **Edit** and **Delete** via a contextual
  3-dot menu (new `EvidenceRowMenu` component in `DisputeDetail.tsx`); Edit opens
  `EvidenceDetailDrawer` in edit mode, Delete removes the item (with the same confirm-dialog
  pattern as before).
- Category "Added"/"Not added" counts are unchanged: still `!item.proofRequired ||
  item.proofConfirmed`, from the earlier "third-party evidence requires proof" pass.

## Verification

- **231/231 Vitest tests pass** (across 24 files) — includes new/updated coverage in
  `tests/EvidenceAccordion.test.tsx`, `tests/EvidenceProofRequired.test.tsx`,
  `tests/InvestigationReport.test.tsx` asserting: no "AI found"/"Reviewed" text anywhere on
  added evidence, the 3-dot menu offers only Edit/Delete, source chips (`getByTitle("Open
  Fathom source")`) open the inspector in place of the old "Inspect" text link, and the
  unified modal's Save button is what the proof-required flow now gates (was "Confirm
  evidence").
- `npx tsc -b`, `npm run lint`, `npm run build` all clean.
- Committed to `experiment/unified-ai-assistant`, pushed there, then — on explicit user
  instruction this same session — fast-forward merged and pushed to `main` too. Also deployed
  to the live Vercel production instance (`addmorecommas.com`) and re-verified via the same
  `curl`-based health checks used in the deployment pass above (password gate, `/api/health`
  reporting `llmMode: "openrouter"` and all 6 sources).
- **Not done this pass:** a live-browser walkthrough of the new accordion/drawer/chip/menu UI
  specifically — no browser automation was available for this project this session (unlike
  most prior passes in this file, which used ad-hoc Playwright scripts). The claim of
  correctness for this UI rests on the Vitest coverage above plus the clean build, not a
  visual/interactive check. **A future session should do a live walkthrough of this specific
  UI** (expand a category, open the drawer, click a source chip, edit with file upload, delete
  via the 3-dot menu) the first time browser automation is available for this project, to
  catch anything a DOM-level test wouldn't (visual regressions, click-target sizing, the
  center-modal opacity actually reading as intended against the reference screenshots the user
  provided).

# Current Repository State

- `docs/` — full spec set (`PROTOTYPE_SPEC.md`, `ARCHITECTURE.md`, `IMPLEMENTATION_PLAN.md`,
  this file) + `docs/references/` (14 UX screenshots — 10 earlier + 4 new production Commas
  Dashboard captures used for "Dashboard Visual Fidelity Pass" above).
- `src/components/dashboard/` — the Dashboard's 6 new components (`MiniChart`, `RevenueModule`,
  `AnnouncementsModule`, `OverviewControls`, `OverviewCard`/`OverviewEmptyCard`,
  `EmptyIllustration`) — see "Dashboard Visual Fidelity Pass" above.
- **A real, running Vite + React 18 + TypeScript + Tailwind v4 frontend** on the ported
  Commas shell, plus **a real Node/TypeScript/Hono backend** (`server/`) implementing the
  agent runtime, MCP client, and mock Commas MCP server — see "Commas Tool Layer" above for
  the full file list. `npm run dev:all` runs both together (or `dev` + `dev:server`
  separately); Vite proxies `/api` to the backend.
- `tests/` — **94 Vitest tests passing**: frontend (`liteMarkdown`, `Sidebar`, `ChatFlow`,
  `CreditSystem`, `EvidenceUpload`, `DisputeChatSession` — mocks `fetch` at the network
  boundary, covers multi-turn history, the approval flow, persistence, all 6 credit scenarios
  A–F, the evidence upload/validation pipeline, and dispute chat-session identity/delete
  semantics) + `tests/server/` (errors, registry, mcpClient, runtime, app, `disputeIntents` —
  exercising the real backend with 6 source adapters, the write-approval pause/resume path,
  and all 5 demo dispute cases' stub answers). No Playwright e2e suite committed yet
  (IMPLEMENTATION_PLAN.md Phase 4's acceptance criteria calls for one; every session so far has
  verified live behavior via ad-hoc scripts instead).
- `server/adapters/` — the `SourceAdapter` abstraction (`types.ts`) plus 6 adapters:
  `commasAdapter.ts` and `meetingsAdapters.ts` (Fathom, Zoom — all MCP-backed) and
  `gmailAdapter.ts` / `calendarAdapter.ts` / `crmAdapter.ts` (API-style, no MCP). See
  "Conversation System, Source Adapters & Write-Approval Flow" above.
- `src/lib/disputeData.ts` now holds 5 dispute cases (was 1) and `server/mcp/mockCommasServer.ts`
  mirrors them with deeper agent-reasoning fields; `src/hooks/useChatStore.tsx`'s credit model
  is `{totalCredits, usedCredits}` (was `{balance, startingBalance}`) — see "Resolution Center
  Demo-Readiness" and "Chat Credit System" above.
- `package.json` has both frontend and backend dependencies now (`@anthropic-ai/sdk`,
  `@modelcontextprotocol/sdk`, `hono`, `@hono/node-server`, `zod`, `dotenv`, `tsx`,
  `concurrently`, plus the existing frontend stack) and `dev`/`dev:server`/`dev:all`/
  `build`/`typecheck`/`lint`/`test` scripts. Three tsconfig projects now: app (frontend),
  node (Vite config), **server** (backend — new).
- `.env.example` documents `ANTHROPIC_API_KEY`, `OPENROUTER_KEY`, `GEMINI_API_KEY`,
  `SITE_PASSWORD`, `COMMAS_MCP_MODE`, `COMMAS_MCP_URL`, `COMMAS_API_KEY`, `PORT`. No real
  `.env` exists locally, but `OPENROUTER_KEY` and `SITE_PASSWORD` are set as real Vercel
  production env vars (see "Production Deployment" above).
- **`api/index.ts`, `vercel.json`, `middleware.ts`** — the Vercel serverless deployment layer
  (entry point, API rewrite, Basic Auth), new this session. See "Production Deployment" above
  for the two live-only bugs this uncovered (catch-all routing, ASCII-only auth header).
- **`src/components/chat/SourceReferenceList.tsx`,
  `src/components/resolution/EvidenceDetailDrawer.tsx`** — new components from the Evidence UI
  Overhaul pass; `EvidenceRowMenu` lives inline in `DisputeDetail.tsx`.
- Git: local repo on `main`, remote is a **private GitHub repo**
  (`experiment/unified-ai-assistant` is the working branch; **do not push directly to `main`
  without explicit user instruction** — see the standing git-workflow note under "Production
  Deployment" above). **Live production deploy:** https://addmorecommas.com (Vercel,
  password-gated, `llmMode: "openrouter"`).

# Completed

- Repo scaffold + reference screenshots (committed).
- Technical reconnaissance of commasdocs.com, the old prototype, and this repo (verified by
  direct fetch/inspection on 2026-08-21; findings recorded in this file).
- Full specification set: `PROTOTYPE_SPEC.md`, `ARCHITECTURE.md`, `IMPLEMENTATION_PLAN.md`.
- **UI foundation implementation** (2026-08-21) — see "UI Foundation Pass" below. Verified:
  `npm run typecheck`, `npm run lint`, `npm test` (10/10), and `npm run build` all pass;
  the app was run in a real headless-Chromium browser and visually inspected across all
  required surfaces with zero console errors.
- **UI review + P0/P1 fix pass** (2026-08-21) — a review against the reference screenshots
  found 1 P0 + 6 P1 issues; all fixed same session — see "UI Review Fix Pass" below. Verified:
  `npm run typecheck`, `npm run lint`, `npm test` (14/14), `npm run build` all pass; re-ran
  the app in headless Chromium across 4 viewport widths with zero console errors.
- **Commas foundation migration** (2026-08-21) — ported the commas-ai-copilot shell,
  Resolution Center, and Dispute Detail; corrected sources to the CPO's connector list;
  contextual AI per page; agent panel as sibling main-surface — see "Commas Foundation
  Migration" below. Verified: typecheck/lint/16 tests/build + full browser walkthrough,
  zero console errors.
- **Commas tool layer / real agent backend** (2026-08-21) — real Node/Hono backend, real
  MCP client + mock Commas MCP server (`@modelcontextprotocol/sdk`), real agent runtime loop,
  real (untested-live) Anthropic client + tested-live deterministic stub, minimal frontend
  wiring to call it — see "Commas Tool Layer" above. Verified: typecheck/lint/36 tests/build
  + live browser walkthrough against the real running backend (4/4 scenarios incl. a real
  tool failure), zero console errors, zero secrets in the client bundle (grepped).
- **Conversation system, source adapters, write-approval flow** (2026-08-21) — persistent
  multi-turn chats (localStorage), a uniform `SourceAdapter` layer with 6 real adapters
  (Commas/Fathom/Zoom over MCP, Gmail/Calendar/CRM over mock API), genuine multi-source agent
  reasoning with per-chat source scoping, one real write tool gated by a pause/resume approval
  flow — see "Conversation System, Source Adapters & Write-Approval Flow" above. Verified:
  typecheck/lint/48 tests/build + a 6-scenario live browser walkthrough, zero console errors.
  **Explicitly not done this session** (see that section's closing note): the 7-flow
  stabilization audit and the dedicated visual polish pass — both were part of the same
  request batch but out of scope for this session's rigor budget.
- **Dashboard visual fidelity pass** (2026-08-21) — rebuilt the Dashboard from scratch against
  4 new production Commas screenshots (`commas-ai-copilot` has no Dashboard to port from),
  keeping Resolution Center and the AI Agent completely untouched — see "Dashboard Visual
  Fidelity Pass" above for the full account, including the deliberate departure from
  production's literal `$0.00` empty-account numbers (for narrative coherence with Resolution
  Center's real dispute) and the honestly-listed remaining gaps (carousel motion, chart
  tooltips, narrow-width testing). Verified: typecheck/lint/48 tests (unchanged, true
  no-regression signal) + a live 5-screenshot browser walkthrough (Dashboard → AI panel →
  Resolution Center list → dispute detail → contextual AI panel), zero console errors.
- **Chat sidebar cleanup + Connected apps modal opacity fix** (2026-08-21) — see "Chat Sidebar
  Cleanup + Connected Apps Modal Opacity" above. Verified: typecheck/lint clean, live browser
  checks for both, zero console errors.
- **Resolution Center demo-readiness + chat credit system** (2026-08-21) — 5 realistic dispute
  cases (needs-response, missing-evidence, evidence-ready, high-risk/uncertain, won/resolved)
  each with deterministic per-case Agent answers to 5 demo-script questions, a hidden pipeline
  test phrase, and a full total/used/remaining credit model with low/exhausted states and a
  mock purchase flow — see "Resolution Center Demo-Readiness" and "Chat Credit System" above.
  Verified: typecheck/lint/70 tests (+22 net) + an extensive live browser walkthrough covering
  every dispute case, every demo question, the hidden phrase, and all 6 credit scenarios
  (A–F) from the task, zero console errors throughout.
- **Evidence file upload flow** (2026-08-21) — upgraded "Add evidence" with multi-file
  selection/drag-drop, client-side validation (unsupported type, oversized, empty, duplicate —
  never silent), a deterministic Selected→Uploading→Processing→Ready simulation with a
  reproducible failure/retry demo path, image thumbnails + a lightbox preview, and a
  review-before-submit step, without redesigning the modal or touching the Agent/MCP
  architecture — see "Evidence File Upload" above, including a real bug it caught (files
  getting stuck mid-pipeline due to a React state-timing bug) and its fix. Verified:
  typecheck/lint/build clean, 79 tests (+9 net), and a live 10-scenario browser walkthrough
  matching the task's own manual test list, zero console errors.
- **Resolved disputes are read-only + Dispute AI session identity fix** (2026-08-21) — Priya
  Nair's resolved dispute (#2390) now shows a read-only evidence record (no Add buttons,
  clickable attachments with a lightbox/honest-fallback preview) and a "Submitted response"
  card instead of the editable draft textarea, driven by one conditionally-rendered
  `DisputeDetail` implementation. Separately, found and fixed a real bug where the dispute AI
  panel rendered nothing after deleting a session and starting a new one — root cause was the
  same React state-timing anti-pattern already fixed once this session in
  `evidenceUpload.ts`, this time in `useChatStore.tsx`'s `createChat()` — plus added a
  reachable "Start new session" delete affordance for dispute chats (there wasn't one before)
  and a richer contextual empty state (structured dispute summary + 7 suggestion chips, all
  mapped to real stub behavior). See "Resolved Disputes Are Read-Only" and "Dispute AI Session
  Identity" above. Verified: typecheck/lint/build clean, 82 tests (+3 net), and a live
  walkthrough of every case both tasks specified, zero console errors.
- **Audit implementation pass** (2026-08-21) — executed PRODUCT_READINESS_AUDIT.md Phases 1–3
  (all 8 P0s, the selected P1s, connector items) plus the connected-apps branding requirement
  (brand-colored icons, CRM → GoHighLevel) in three phase-sized commits — see "Audit
  Implementation Pass" above, including the deliberately-skipped items. Verified:
  typecheck/lint/build clean, 94 tests (+12 net), 20-check live walkthrough of the 12
  required flows, zero console errors.
- **Production deployment** (2026-08-2x) — live at https://addmorecommas.com on Vercel,
  password-gated, on a real free-tier LLM (OpenRouter) with the same code path also
  supporting real Anthropic/Gemini keys with zero changes — see "Production Deployment"
  above, including two live-only bugs found and fixed (Vercel API catch-all routing, a
  non-ASCII auth-header byte). Repo also moved to a private GitHub remote this pass.
- **Evidence UI overhaul** (2026-08-25) — accordion + center-modal detail drawer, a
  connector-agnostic source-reference chip component (no more per-connector UI branching, no
  more "Inspect underlying source" text), a unified edit+upload modal, and full removal of the
  evidence review/approval state (no more "Mark as reviewed"/"AI found"/"Reviewed") in favor
  of a 3-dot Edit/Delete menu — see "Evidence UI Overhaul" above. Verified: typecheck/lint/
  build clean, 231/231 tests (+137 net this session across several stacked features), and live
  production `curl` health checks. **Not done:** a live-browser walkthrough of this specific
  UI — no browser automation was available for this project this session; flagged as the top
  follow-up in "Evidence UI Overhaul" above.

# In Progress

- Nothing implementation-wise. **Next up, in priority order:** (1) a live-browser walkthrough
  of the new evidence accordion/drawer/source-chip/3-dot-menu UI, deferred this session for
  lack of browser automation availability — see "Evidence UI Overhaul" above; (2) the 7-flow
  stabilization audit and a dedicated cross-surface visual polish pass (typography/spacing/
  border/shadow comparison), both requested several sessions ago and still deferred; (3)
  Dashboard's own listed gaps if visual completeness matters more than new features right now:
  Announcements carousel motion, chart hover tooltips, narrow-width (<1440px) testing of the
  new grid; (4) get a real `ANTHROPIC_API_KEY` from the user and confirm `AnthropicLlmClient`
  live in production (OpenRouter is live and demo-tested, but Anthropic itself still isn't);
  (5) remaining `fanbasis_*` read tools / SSE streaming, unchanged from before this session.

# Not Implemented

- ~~Live-tested real LLM calls~~ **Partially done (2026-08-2x)** — `OPENROUTER_KEY` is set in
  production and `GET /api/health` reports `llmMode: "openrouter"` live; a real (non-stub,
  non-Anthropic) LLM is genuinely answering user messages in production. `AnthropicLlmClient`
  itself is still complete, real code that has **never** been exercised — no Anthropic key
  exists anywhere in this environment. See "Production Deployment" above.
- **Live-tested real Commas MCP connection.** `connectReal()` is complete, real code, tested
  only against a deliberately unreachable address. No Commas API key exists here.
- ~~Full Resolution Center~~ **Done** (list + detail ported). Still not ported from the old
  repo: `SourceView` (per-evidence source-record pages) and the scripted `EvidenceCopilot`
  cards (superseded by the agent panel).
- ~~Write-action / approval-card flow~~ **Done** (2026-08-21) — one real write tool
  (`commas_mark_dispute_response_ready`) gated by a runtime-level pause/resume approval flow;
  see "Conversation System, Source Adapters & Write-Approval Flow" above. Still only **one**
  write tool exists — the other documented real-platform write actions (charge, refund,
  discount CRUD, subscription changes) remain unimplemented; would follow the same
  classification + approval pattern if added.
- **7 of the 11 documented `fanbasis_*` read tools** (discount codes, checkout sessions,
  payment methods, etc.) — only customers/list-transactions/get-transaction/dispute are
  implemented, per the task's "small set of useful capabilities" scope. Unchanged this
  session.
- ~~Non-Commas connected sources have no backend~~ **Now have real adapters** (2026-08-21) —
  Fathom/Zoom via mock MCP servers, Gmail/Calendar/CRM via mock API-style adapters; see
  "Source adapter architecture" above. All 6 sources are now uniformly callable by the agent,
  still all mock data (no real OAuth/API credentials exist in this environment).
- ~~Persistence~~ **Done** (2026-08-21) — `localStorage`-based, not the backend JSON-snapshot
  store ARCHITECTURE.md §10 describes, but chat/credits/sources state now survives a real page
  reload; verified live.
- **SSE/streaming** — `POST /api/agent/run` is synchronous request/response, not
  ARCHITECTURE.md §9's SSE event stream (deliberate scope cut, documented above). Unchanged
  this session.
- **Playwright e2e suite** committed to the repo. Visual/functional verification this and all
  prior sessions used ad-hoc Playwright scripts run from job scratch space, not committed
  tests.
- **The 7-flow stabilization audit and the final visual polish pass** — both explicitly
  requested this session, both explicitly not attempted; see the closing note in
  "Conversation System, Source Adapters & Write-Approval Flow" above for exactly why and what
  a future session should do instead of re-deriving the decision.

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
- **Backend:** Node 20+ / TypeScript / **Hono** — **implemented and running**
  (`server/index.ts` + `@hono/node-server`). REST only so far, no SSE (deliberate scope cut,
  see "Commas Tool Layer" § What's still not real).
- **LLM:** `@anthropic-ai/sdk`, model `claude-opus-5`, adaptive thinking — **implemented**
  (`server/llm/anthropicClient.ts`) but **never live-tested** (no API key in this
  environment); manual per-turn loop (not the SDK's beta tool-runner — kept simple/explicit
  for this scope) in `server/agent/runtime.ts`; **scripted stub** (`server/llm/stubClient.ts`)
  is what every test and live check actually ran on.
- **MCP:** `@modelcontextprotocol/sdk` self-hosted client — **implemented**
  (`server/mcp/client.ts`). In-process mock Commas MCP server implemented
  (`server/mcp/mockCommasServer.ts`, 4 tools: customers/transactions/transaction-detail/
  dispute); external-source mock servers (fathom/zoom/etc.) were **not** built — those
  sources have no MCP layer at all, still pure UI mocks. Guarded real-mode config path
  implemented as designed: `COMMAS_MCP_MODE=real` + `COMMAS_MCP_URL` + `COMMAS_API_KEY`
  (the `COMMAS_ALLOW_REAL` extra guard from the original design was simplified away — both
  URL and key being unset is already a sufficient guard against accidental real-mode).
- **Mock dispute tool is namespaced `commas_get_dispute`** (not `fanbasis_*`) because it has
  no real-platform equivalent — implemented exactly per this decision, never blurred.
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

1. **Real Anthropic LLM calls.** The code path (`AnthropicLlmClient`) is fully implemented and
   wired — the only missing piece is the user supplying `ANTHROPIC_API_KEY` and accepting
   per-request cost. Nothing else should need to change; `GET /api/health`'s `llmMode` field
   flips to `"anthropic"` automatically once the key is set (it currently reports
   `"openrouter"` in production — see "Production Deployment" above — proving the priority
   chain and swap mechanism both work).
2. **Real Commas MCP mode.** The code path (`CommasMcpClient.connectReal`) is now fully
   implemented and wired — needs `COMMAS_MCP_MODE=real`, `COMMAS_MCP_URL` (the Railway URL
   recorded in this file's Integrations section, or whatever the current real endpoint is),
   and a QA sandbox `COMMAS_API_KEY`. Only ever use a sandbox key, never production — write
   tools aren't implemented yet, but the read tools would hit a real account.
3. ~~**GitHub:** create a remote for this repo?~~ **Resolved (2026-08-2x)** — a private GitHub
   repo now exists as the remote; `experiment/unified-ai-assistant` is the working branch,
   `main` receives fast-forward merges only on explicit user instruction (see the standing
   git-workflow note under "Production Deployment" above).
4. Exact write-tool list of the real Commas MCP server (docs inconsistent: 11 vs 27 vs 30+).
   Mock write tools follow the documented write *actions*; reconcile if real mode is used.
5. Whether Commas plans an in-app agent surface of their own (interview said yes, per-org
   sandboxed agents + credits) — relevant for framing, unknowable from docs.

Resolved since recon (defaults adopted into the specs; user may still override): chat
persistence (in-memory + JSON snapshot), loop mechanism (tool runner), Hono over Express,
stub-LLM testing strategy, credits pricing, `commas_*` namespacing for mock dispute tools,
GitHub remote (private repo, now exists), production hosting (Vercel + custom domain +
password gate), which free LLM provider to run live (OpenRouter, not Gemini — see "Production
Deployment" above for why).

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
- **Free-tier LLM volatility (new, 2026-08-2x):** the production instance runs on OpenRouter's
  free model tier, which has already forced two model swaps in one session (one model
  retired, one routed through a congested shared pool). Treat `llmMode: "openrouter"` in
  `GET /api/health` as something to spot-check before a demo, not something to assume stays
  working — see "Production Deployment" above for the current model and how to swap it.

# Next Steps

Phases 2 (mock MCP servers + tool registry) and 3 (agent runtime) from `IMPLEMENTATION_PLAN.md`
are substantially done, and this session added persistent conversations, the full 6-source
adapter layer, and a write/approval flow on top — see "Conversation System, Source Adapters &
Write-Approval Flow" and "Commas Tool Layer" above for exactly what's real vs. still stubbed.
What's concretely left, in priority order:

1. **The stabilization audit and the visual polish pass** — both were explicitly requested
   this session as their own deliverables and both were explicitly deferred (see that
   section's closing note above) rather than rushed. The audit wants a written report (passing/
   failing tests, known limitations, mocked functionality, production gaps) across 7 named
   flows; the polish pass wants a dedicated typography/spacing/border/shadow/icon comparison
   against the five reference screenshot sets. Neither should be attempted with anything less
   than the rigor the rest of this file demonstrates — don't rubber-stamp them.
2. **Get `ANTHROPIC_API_KEY` from the user and verify `AnthropicLlmClient` live** — set it in
   `.env`, run `npm run dev:server`, confirm `GET /api/health` reports `llmMode: "anthropic"`,
   and re-run this session's live-browser checks (multi-turn memory, multi-source
   investigation, write approval, persistence, insufficient credits) against the real model to
   confirm it behaves the same way the stub does.
3. **More write tools**, following the same classify-as-`"write"` + approval-pause pattern as
   `commas_mark_dispute_response_ready` — the real platform documents charge/refund/discount
   CRUD/subscription-change actions that aren't implemented yet.
4. **Remaining `fanbasis_*` read tools** (discount codes, checkout sessions, payment
   methods, subscribers) — same pattern as the 4 already implemented in
   `mockCommasServer.ts` + `registry.ts`'s `KNOWN_TOOLS` map.
5. **SSE streaming** for `POST /api/agent/run`, if the synchronous request/response proves
   limiting for longer multi-step investigations — currently the client just waits for the
   full response and paces step-reveal client-side.
6. **Real OAuth/API credentials for Gmail/Calendar/CRM**, and a real Fathom/Zoom API/MCP
   integration, if/when this prototype needs to move past mock data for those 5 sources.
7. **Committed Playwright e2e suite** — every session so far, including this one, has
   verified live behavior with ad-hoc scripts in job scratch space rather than committed
   tests.

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
5. **Git workflow (standing instruction):** commit locally and push to
   `experiment/unified-ai-assistant` as work proceeds; only push/merge that branch into `main`
   when the user explicitly says so. Do not assume a production deploy (`npx vercel deploy
   --prod --yes`, which deploys the local working directory regardless of branch) implies
   `main` should also be updated — those are two separate, separately-gated actions.
6. Do not present unconfirmed capabilities as real: anything not in the CONFIRMED sections
   above is an assumption — say so.
7. The commasdocs.com fetch method that works is documented under Confirmed Technical
   Decisions (curl the raw HTML; content is inside script payloads).
8. **No browser automation was available for this project as of 2026-08-25** — the last two
   feature passes (Production Deployment, Evidence UI Overhaul) were verified via `curl`
   health checks and the Vitest suite only, not a live click-through. If browser automation
   becomes available, the top-priority follow-up is the live walkthrough flagged at the end of
   "Evidence UI Overhaul" above — don't assume the DOM-level tests already covered everything
   a visual pass would catch.
