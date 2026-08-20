# Commas AI Agent — Active Context

**Last updated:** 2026-08-21 · **Updated by:** Claude (specification session — recon earlier same day)

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

# Current Repository State

- Scaffolding only: `docs/`, `src/{agent,llm,mcp,connectors,context,chat,ui}/` (placeholder
  READMEs, no code), `tests/`, `public/`, minimal `package.json` (no deps), `.gitignore`.
- `docs/references/` — 10 UX reference screenshots (Notion AI ×4, Notion MCP ×2, Commas
  dashboard/integrations/Resolution Center, Claude Desktop).
- **Specification set (written, committed):** `docs/PROTOTYPE_SPEC.md`,
  `docs/ARCHITECTURE.md`, `docs/IMPLEMENTATION_PLAN.md` (renamed from the earlier lowercase
  stubs — note macOS is case-insensitive, so never create a second file differing only in
  case).
- Git: local repo on `main`, **no remote**.

# Completed

- Repo scaffold + reference screenshots (committed).
- Technical reconnaissance of commasdocs.com, the old prototype, and this repo (verified by
  direct fetch/inspection on 2026-08-21; findings recorded in this file).
- Full specification set: `PROTOTYPE_SPEC.md`, `ARCHITECTURE.md`, `IMPLEMENTATION_PLAN.md`
  (written against the recon; committed).

No application code exists.

# In Progress

- Nothing. **Next up: `IMPLEMENTATION_PLAN.md` Phase 0 (workspace scaffold)** — blocked only
  on the sign-off items in Open Questions 1–2 (or explicit user go-ahead, which implies
  accepting the recorded defaults).

# Not Implemented

Everything: frontend, backend, agent loop, MCP client, mock MCP servers, chat UX, credits,
Resolution Center flow, tests, deployment.

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

- **Frontend:** React 18 + Vite + Tailwind v4 + `lucide-react` (visual reuse from old repo).
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

The build order now lives in `IMPLEMENTATION_PLAN.md` (Phases 0–6, each independently
testable with acceptance criteria). **Next implementation phase: Phase 0 — workspace
scaffold** (Vite+React+Tailwind frontend, Hono backend with SSE proof, shared types,
dev/test tooling). Then Phases 1 (shell port) and 2 (mock data + MCP servers) — which may
run in parallel — then 3 (agent runtime) → 4 (chat UX) → 5 (ambient surfaces + flagship) →
6 (demo hardening).

Before starting Phase 3's live smoke test, obtain `ANTHROPIC_API_KEY` from the user (Open
Question 1). Nothing else blocks Phase 0.

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
