# Commas AI Agent — Implementation Plan

**Status:** Approved working plan · **Last updated:** 2026-08-21
**Companions:** `PROTOTYPE_SPEC.md` (what), `ARCHITECTURE.md` (how), `active-context.md`
(current state — records which phase is next).

Rules that apply to every phase:

- Each phase ends **green**: acceptance criteria met, its tests passing, `active-context.md`
  updated. A phase is not "done" until verified by running it.
- No invented platform APIs: anything touching "real Commas" is limited to what
  `active-context.md` § Integrations records as confirmed. Everything else is mock.
- Deterministic tests never call the live LLM. The agent runtime accepts an injected LLM
  client; tests use a **scripted LLM stub** (fixed tool-call sequences). A separate,
  manually-run smoke script exercises the real model.
- Secrets via `.env` (gitignored) only.

Phase order is dependency order; 1 and 2 can proceed in parallel after 0.

---

## Phase 0 — Workspace scaffold

**Objective:** A running skeleton: frontend dev server, backend dev server, shared types,
one-command dev experience.

**Dependencies:** none.

**Implementation scope:**
- Vite + React 18 + TS + Tailwind v4 app in `src/ui/` (entry stays repo-root `index.html`
  per Vite convention); `lucide-react`.
- Hono backend in `src/` (entry `src/server.ts`) with `/api/health`; SSE echo route proving
  streaming works end to end; Vite dev proxy `/api` → backend.
- Shared TS types module (`src/types/`) imported by both sides.
- `package.json` scripts: `dev` (both, concurrently), `build`, `typecheck`, `test`,
  `test:e2e`. Playwright + Vitest installed and configured.
- `.env.example` with `ANTHROPIC_API_KEY=`.

**Acceptance criteria:**
- `npm run dev` serves the UI; the UI fetches `/api/health` and renders the result; an SSE
  test event round-trips to the browser.
- `npm run typecheck` and `npm run test` pass clean.

**Tests:** one Vitest unit test (health handler), one Playwright smoke test (page loads,
health status visible).

---

## Phase 1 — Commas shell + Resolution Center port

**Objective:** The app looks like Commas: shell, dashboard placeholder, Resolution Center
list and Dispute Detail, plus the new Chat nav entry and (non-functional) floating AI
button.

**Dependencies:** Phase 0.

**Implementation scope:**
- Port/adapt from `../commas-ai-copilot` (copy source, adjust imports — never cross-repo
  imports): `Sidebar`, `TopNav`, `ResolutionCenter`, `DisputeDetail`, `FilterPill`,
  popovers, `Badge`, icon components, and the base dispute/customer/transaction mock data
  needed to render them.
- Add the Chat nav entry (route to an empty Chat view placeholder) and the floating button
  (renders, no behavior yet).
- View routing extended: `list | detail | chat | sources` union.

**Acceptance criteria:**
- Resolution Center renders the seeded dispute; Dispute Detail renders its panels;
  navigation Sidebar ↔ pages works; Chat nav entry and floating button visible.
- No console errors; typecheck green.

**Tests:** Playwright — navigate shell → Resolution Center → Dispute Detail; assert dispute
row, detail panels, Chat nav entry, and floating button exist. Visual baseline of the two
ported pages.

---

## Phase 2 — Mock datasets + mock MCP servers

**Objective:** All five sources exist as in-process MCP servers over internally consistent
data, callable and mutable, with the tool registry on top. No LLM involvement yet.

**Dependencies:** Phase 0 (types); data extends Phase 1's ported dataset (coordinate, not
blocked).

**Implementation scope:**
- `src/connectors/data/` — the unified mock world: one seller, Sarah Johnson + supporting
  customers, products, transactions, subscriptions, discount codes, dispute #2481 (shaped
  like the documented `dispute.created` webhook payload), and Fathom/Zoom/Meet/ClickFunnels
  records telling one consistent story (spec §3).
- `src/mcp/servers/commas.ts` — mock Commas MCP server: the 11 `fanbasis_*` read tools
  (real names/shapes), write tools (charge, refund, discount CRUD, subscription
  extend/cancel) mutating the dataset, and the prototype-only `commas_*` dispute tools.
- `src/mcp/servers/{fathom,zoom,google-meet,clickfunnels}.ts` — 1–3 read tools each.
- `src/mcp/client.ts` — MCP client wiring with in-process transports; startup `tools/list`.
- `src/agent/registry.ts` — tool registry per `ARCHITECTURE.md` §8 (classification, labels,
  credit costs, approval summaries; unknown tools fail safe to `write`).
- Dataset reset function (backs `POST /api/demo/reset` later).

**Acceptance criteria:**
- Registry loads every tool from all five servers with correct source, classification, and
  label; every read tool returns correct data for known queries; write tools mutate and
  reset restores; dispute tools return the #2481 record.
- Cross-source consistency assertions pass (same customer email everywhere; timestamps
  ordered: funnel → purchase → logins → calls; dispute amount matches its transaction).

**Tests:** Vitest — per-tool unit tests through the real MCP client path (not direct
function calls); registry classification table test; the consistency suite above; write →
verify → reset round-trip.

---

## Phase 3 — Agent runtime + API

**Objective:** The full backend loop: message in → agent run with multi-step tool use →
SSE events out — including approval gate, cancellation, credits, iteration caps — provable
without a browser.

**Dependencies:** Phase 2.

**Implementation scope:**
- `src/llm/` — Anthropic client wrapper (`@anthropic-ai/sdk`, `claude-opus-5`, streaming,
  tool definitions from the registry) behind an `LlmClient` interface; plus the scripted
  stub implementation for tests.
- `src/agent/` — run state machine, loop (tool-runner-based with hooks; manual-loop
  fallback allowed), progress mapper (registry labels → events; thinking never forwarded),
  iteration cap, wall-clock timeout, cancellation, approval gate + 10-min auto-decline,
  credit metering.
- `src/chat/` — chat store (in-memory + JSON snapshot), transcripts with tool summaries and
  resolved approvals.
- HTTP layer: the full API surface from `ARCHITECTURE.md` §3 with SSE event stream per §9
  (monotonic `seq`, replay on reconnect).
- System prompt v1 (persona, safety rules, source attribution, output formatting).

**Acceptance criteria:**
- With the scripted stub: a multi-step run emits the exact expected event sequence
  (`run.started` → `tool.started/completed` ×N → `message.delta`* → `credits.updated` →
  `run.completed`); a write-tool script pauses at `approval.required`, approve executes /
  decline doesn't (dataset checked both ways); cancel mid-run yields `run.cancelled` and an
  intact chat; iteration cap terminates a pathological script; disabled sources' tools are
  rejected at dispatch; credits deduct per the price table.
- With the real LLM (manual smoke script, not CI): demo flows 5.1–5.3 produce sensible
  answers grounded in mock data.

**Tests:** Vitest integration tests driving the HTTP API with the stub (the event-sequence,
approval, cancellation, cap, scoping, and credit cases above); store persistence test
(restart → chats survive); `scripts/smoke-live.ts` for the manual real-model check.

---

## Phase 4 — Chat UX

**Objective:** The full Chat view per spec §2.2–2.10 and §2.9, wired to the Phase 3 API.

**Dependencies:** Phases 1 and 3.

**Implementation scope:**
- Chat view: history list (grouping, delete), New Chat, conversation rendering (markdown,
  progress block, collapsed tool summaries), streamed answer rendering from
  `message.delta`.
- Composer: input, send, Stop control during runs, Sources controls-menu with per-source
  toggles; empty state with greeting, suggested capability chips, and the Connected-apps
  strip.
- Approval card component (both resolutions), credits display + exhaustion state + demo
  reset, error state with retry.
- Sources management page (Connected apps gallery, simulated connect/disconnect) reachable
  from the strip and settings.

**Acceptance criteria:**
- Demo flows 5.1–5.4 work in the browser end to end against the live backend (stub LLM in
  tests; real LLM manually). Reload restores history; approvals persist in transcripts;
  credits animate; empty state matches spec.

**Tests:** Playwright with the backend in stub-LLM mode — scripted flows for 5.1–5.4
(both approval branches), history persistence across reload, source toggling excluding a
source, cancellation, credits exhaustion + reset. Visual baselines: empty state, run in
progress, approval card.

---

## Phase 5 — Ambient surfaces + flagship flow

**Objective:** The agent woven into the product: right-side panel, floating button
behavior, contextual Resolution Center AI, and the flagship dispute investigation working.

**Dependencies:** Phase 4.

**Implementation scope:**
- Right-side panel: docked chat surface with page-context chip, open/close, switch to full
  Chat view; floating button opens it with context; panel available on dashboard and
  Resolution Center pages.
- Dispute context injection: panel opened from Dispute Detail attaches the dispute id as
  run context; dispute-specific suggested capabilities.
- "Investigate with AI" affordance on Dispute Detail.
- Flagship content tuning: system-prompt + registry-label iteration until the real-model
  investigation reliably checks ≥4 sources (≥2 connected apps), produces the structured
  output (case summary, timeline, per-item source attribution, drafted response), and the
  simulated `commas_mark_response_ready` write rides the standard approval flow.
- Copy-draft affordance on the final answer.

**Acceptance criteria:**
- Demo flow 5.5 end to end in the browser (stub-LLM scripted version deterministic; real
  model verified manually ≥3 consecutive runs), plus 5.6's source-scoping variant.
- Floating button/panel behave per spec on all pages; context chip always reflects the
  page.

**Tests:** Playwright — panel open/close from floating button on two pages; context chip
content; scripted flagship investigation (event-sequence-driven) asserting the structured
answer blocks and approval-gated write; source-scoped rerun asserting connected-app tools
were not called.

---

## Phase 6 — Demo hardening

**Objective:** The prototype demos reliably from a cold start and the repo tells its own
story.

**Dependencies:** Phase 5.

**Implementation scope:**
- Full e2e pass covering all §5 demo flows as one suite; flake hunt (≥5 consecutive clean
  runs); visual-baseline refresh.
- `POST /api/demo/reset` wired to a visible demo-reset control; cold-start script
  (`npm run demo`) that builds, seeds, and serves everything on one port.
- README rewrite: what this is, architecture sketch, env setup, demo script (the exact
  click-path for flows 5.1–5.5), stub-vs-live mode explanation.
- Final `active-context.md` update.

**Acceptance criteria:**
- `npm run demo` from a fresh clone (with `.env`) reaches a working demo; the full
  Playwright suite passes 5× consecutively; README's demo script matches reality (walked
  through manually).

**Tests:** the complete suite is the deliverable; CI-style one-command `npm run test &&
npm run test:e2e` green.

---

## Explicitly deferred (not in any phase)

Real-mode Commas MCP connection (requires user-supplied QA sandbox key + the two env
guards — architecture supports it, no phase builds UI for it), real external-app OAuth,
multi-user auth, SQLite store, deployment/hosting, mobile layouts.
