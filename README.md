# Commas AI Agent

Prototype of the technical agent system behind the Commas AI Evidence Copilot concept: an LLM
agent loop, MCP client, connectors, and chat interface. This is a sibling repo to
[`commas-ai-copilot`](../commas-ai-copilot), which holds the earlier UI-only demo of the product
concept (no LLM, no MCP, scripted "AI investigation" over mock data). `commas-ai-copilot`
describes the UX/product concept; this repo is where the actual agent architecture gets built.

**Start here:** [`docs/active-context.md`](docs/active-context.md) — persistent session state,
read it before doing anything else in this repo.

## Status

Scaffolding only. No implementation yet. See `docs/active-context.md` for current state and open
questions, and `docs/product-spec.md` / `docs/architecture.md` / `docs/implementation-plan.md` for
what's still unwritten.

## Structure

```
commas-ai-agent/
├── docs/                  persistent context, spec, architecture, implementation plan
├── src/
│   ├── agent/             agent/reasoning loop
│   ├── llm/                LLM client integration
│   ├── mcp/                MCP client logic
│   ├── connectors/         external data source connectors
│   ├── context/            context assembly/management
│   ├── chat/                chat interface logic
│   └── ui/                 presentation layer
├── tests/
└── public/
```

## Deployment (Vercel)

The frontend (`vite build` → `dist/`) and the backend (`server/app.ts`, the same Hono app used
in local dev and in tests) both deploy from this one repo — no separate backend host needed.

- **`vercel.json`** points Vercel at `npm run build` / `dist` for the static frontend.
- **`api/[...path].ts`** is the serverless entry point: a catch-all function that hands every
  `/api/*` request to the real Hono app (`createApp()`, memoized per warm instance) via
  `hono/vercel`'s `handle()` — the exact same routes (`/api/health`, `/api/agent/run`,
  `/api/agent/approve`, `/api/agent/stream`) as `server/index.ts` serves locally.
- **`middleware.ts`** gates the whole deployment behind a single shared password (HTTP Basic
  Auth, checked against the `SITE_PASSWORD` env var) — see the comment in that file.
- **Environment variables** (set in the Vercel project, never committed — see `.env.example`):
  - `SITE_PASSWORD` — required to password-protect the deployment.
  - `ANTHROPIC_API_KEY` — optional and **not free** (pay-per-token, no free tier; a key with a
    $0 credit balance authenticates but every real request fails with a billing error — set
    this only once the Anthropic account behind it has credits).
  - `OPENROUTER_KEY` — optional and **genuinely free** (OpenRouter's `:free` model variants).
    Used only when `ANTHROPIC_API_KEY` is unset — this is the practical free real-LLM default,
    chosen over Gemini after Gemini's real free-tier rate limit (5 requests/minute for
    gemini-3.6-flash, confirmed live) proved too tight for a multi-step investigation.
    `OPENROUTER_MODEL` overrides the default model if needed.
  - `GEMINI_API_KEY` — optional and genuinely free (Google AI Studio), kept as a secondary free
    option. Used only when neither of the above is set. `GEMINI_MODEL` overrides the default.
  - Without any of the three, the agent runs on `StubLlmClient`: the same real tool calls,
    multi-source investigation, and approval flow, with deterministic (not model-generated)
    reasoning text — fully functional, zero configuration, zero cost.
  - `COMMAS_MCP_MODE` (defaults to `mock`, safe to leave unset).

**Known limitation:** `SessionStore` and `PendingApprovalStore` (server/agent/sessions,
server/agent/approvals) are in-memory, scoped to one warm serverless instance — standard for
this prototype's architecture, but on Vercel a cold start or a request routed to a different
instance starts that memory fresh. In practice this is rarely noticeable for a single-visitor
demo (a warm instance easily outlives the seconds between "here's an approval card" and
clicking Approve), but it isn't the same durability guarantee a long-running server gives.
