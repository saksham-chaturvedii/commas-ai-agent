# Commas AI Agent — Active Context

**Last updated:** 2026-08-21 · **Updated by:** Claude (Resolution Center demo-readiness + chat credit system)

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
- `tests/` — **70 Vitest tests passing**: frontend (`liteMarkdown`, `Sidebar`, `ChatFlow`,
  `CreditSystem` — mocks `fetch` at the network boundary, covers multi-turn history, the
  approval flow, persistence, and all 6 credit scenarios A–F) + `tests/server/` (errors,
  registry, mcpClient, runtime, app, `disputeIntents` — exercising the real backend with 6
  source adapters, the write-approval pause/resume path, and all 5 demo dispute cases' stub
  answers). No Playwright e2e suite committed yet (IMPLEMENTATION_PLAN.md Phase 4's acceptance
  criteria calls for one; every session so far has verified live behavior via ad-hoc scripts
  instead).
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
- `.env.example` documents `ANTHROPIC_API_KEY`, `COMMAS_MCP_MODE`, `COMMAS_MCP_URL`,
  `COMMAS_API_KEY`, `PORT`. No real `.env` file exists in this repo/environment.
- Git: local repo on `main`, **no remote**.

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

# In Progress

- Nothing implementation-wise. **Next up, in priority order:** (1) the 7-flow stabilization
  audit and a dedicated cross-surface visual polish pass (typography/spacing/border/shadow
  comparison), both requested two sessions ago and still deferred; (2) Dashboard's own listed
  gaps if visual completeness matters more than new features right now: Announcements carousel
  motion, chart hover tooltips, narrow-width (<1440px) testing of the new grid; (3) get an
  `ANTHROPIC_API_KEY` from the user and confirm the real `AnthropicLlmClient` path live (still
  real code, never actually invoked); (4) remaining `fanbasis_*` read tools / SSE streaming,
  unchanged from before this session.

# Not Implemented

- **Live-tested real LLM calls.** `AnthropicLlmClient` is complete, real code but has never
  been exercised — no `ANTHROPIC_API_KEY` in this environment. Every test and live-browser
  check this session ran on `StubLlmClient`. See "Commas Tool Layer" § What's still not real.
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

1. **Real LLM calls.** The code path (`AnthropicLlmClient`) is now fully implemented and
   wired — the only missing piece is the user supplying `ANTHROPIC_API_KEY` (in `.env`) and
   accepting per-request cost. Nothing else should need to change; `GET /api/health`'s
   `llmMode` field flips from `"stub"` to `"anthropic"` automatically once the key is set.
2. **Real Commas MCP mode.** The code path (`CommasMcpClient.connectReal`) is now fully
   implemented and wired — needs `COMMAS_MCP_MODE=real`, `COMMAS_MCP_URL` (the Railway URL
   recorded in this file's Integrations section, or whatever the current real endpoint is),
   and a QA sandbox `COMMAS_API_KEY`. Only ever use a sandbox key, never production — write
   tools aren't implemented yet, but the read tools would hit a real account.
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
5. Do not create a GitHub remote or push without asking (Open Question 4).
6. Do not present unconfirmed capabilities as real: anything not in the CONFIRMED sections
   above is an assumption — say so.
7. The commasdocs.com fetch method that works is documented under Confirmed Technical
   Decisions (curl the raw HTML; content is inside script payloads).
