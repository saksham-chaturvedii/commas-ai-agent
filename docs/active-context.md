# Commas AI Agent - Active Context

**Last updated:** 2026-08-21 · **Updated by:** Claude (repo scaffolding session)

> **Read this file first in any new session.** It is the source of truth for where this build
> stands. This repo was just created — as of this writing it contains directory structure and
> stub docs only, no implementation.

---

## 1. What this repo is

`commas-ai-agent` is a **new, separate prototype**, a sibling to `commas-ai-copilot` in the same
vault directory (`../commas-ai-copilot`). It is not a branch or evolution of that repo's git
history — it is a fresh repo with its own scope.

**Why the split, and why the name change:**
- `commas-ai-copilot` is the **existing, working prototype**: a 100% client-side React app that
  simulates the Evidence Copilot UX (scripted "AI investigation" over static mock data, no LLM,
  no MCP, no backend). It was built to demo a *product concept* in an interview context. It stays
  as-is; do not build agent/LLM/MCP work into that repo.
- `commas-ai-agent` is where the **actual technical agent system** gets prototyped: a real
  LLM-backed agent loop, MCP client(s), connectors, context management, and a chat surface.
  "Copilot" described a UX/product concept; "agent" describes the technical system actually being
  architected here — hence the rename for this repo rather than reusing the old name.

**Relationship to the old repo's open questions:** `commas-ai-copilot/docs` (well,
`commas-ai-copilot/active-context.md` at its repo root) documents an unresolved question — whether
a chat-based UX and MCP/agent architecture were ever actually decided, since nothing in that
repo's visible history supported them. The existence of this new repo is a strong signal that the
answer is "yes, build it" — but that has **not been explicitly reconfirmed by the user in this
repo's context yet**. Treat the chat/MCP/agent direction as the working assumption for
`commas-ai-agent`, but don't assume specifics (which LLM, which MCP servers, chat UX details)
that haven't actually been stated — see Section 4.

## 2. Current State

**As of this session, this repo contains only scaffolding:**
- Directory structure: `docs/`, `src/{agent,llm,mcp,connectors,context,chat,ui}/`, `tests/`,
  `public/`, `.claude/`.
- Stub docs: `docs/product-spec.md`, `docs/architecture.md`, `docs/implementation-plan.md` — all
  placeholders, not yet written. Do not treat their headings as decisions; they're a table of
  contents for work that hasn't happened.
- No `package.json` dependencies chosen beyond a minimal placeholder — stack (LLM SDK, MCP SDK,
  frontend framework, etc.) is not yet decided. The old repo used React 18 + TypeScript + Vite +
  Tailwind for its UI layer; that's a reasonable starting assumption for `src/ui/` if this repo
  ends up needing a comparable frontend, but it hasn't been confirmed as the choice for this repo.
- No git remote / GitHub repo created for `commas-ai-agent` yet (the old repo is public at
  `github.com/saksham-chaturvedii/commas-ai-copilot` — this one hasn't been pushed anywhere).
- No code in any `src/` subdirectory yet — each contains only a placeholder `README.md`
  describing its intended purpose (see Section 3).

## 3. Intended Module Layout (`src/`)

These directories were scaffolded per explicit instruction; their purpose as named, not yet
implemented:

- `agent/` — the agent/reasoning loop: orchestrates tool calls, decides what evidence to gather,
  drives the investigation.
- `llm/` — LLM client integration (model calls, prompting, streaming).
- `mcp/` — MCP client logic: connecting to and calling MCP servers (e.g., a Commas MCP server, if
  one is exposed — see the old repo's Section 5 for interview context on this).
- `connectors/` — external data source connectors (e.g., Google Calendar, Zoom/Fathom, Gmail, CRM
  — mentioned as product ideas in the old repo's interview notes, not yet scoped here).
- `context/` — context assembly/management for the agent (gathering and formatting evidence,
  session state, etc.).
- `chat/` — chat interface logic (conversation state, message handling).
- `ui/` — presentation layer.

None of these have real content yet. Do not assume any file exists inside them without checking.

## 4. Open Questions

1. **Scope confirmation:** is `commas-ai-agent` meant to fully replace the "chat + MCP + agent"
   direction that was ambiguous in `commas-ai-copilot`, or run in parallel with it as a separate
   technical exploration while the UI-only prototype stays product-facing? Not yet confirmed.
2. **Stack:** no LLM provider, MCP SDK, or frontend framework has been chosen for this repo.
   Don't default to matching the old repo's stack without checking with the user first if it
   matters for the task at hand.
3. **Relationship to `PROTOTYPE_SPEC.md`** (old repo): does this new repo supersede it, extend it,
   or ignore it? Unconfirmed.
4. **GitHub hosting:** no remote has been created for this repo. Ask before creating a public
   GitHub repo or pushing, same as any other repo-visibility-affecting action.

## 5. Next Steps

1. Write `docs/product-spec.md` — what is this agent prototype actually supposed to do, scoped
   with the user (don't invent scope).
2. Write `docs/architecture.md` — agent loop, LLM client, MCP client design, frontend/backend
   split, once decisions are actually made.
3. Write `docs/implementation-plan.md` — phased build plan once spec + architecture exist.
4. Pick and wire up a real stack (`package.json`) once the above are settled.

## 6. Session Handoff Instructions

Future sessions working in this repository should:

1. **Read this file first**, in full, before doing anything else.
2. Check `../commas-ai-copilot/active-context.md` (sibling repo) for the original product context,
   interview background, and the old prototype's implementation state — don't re-derive that
   history from scratch, but don't assume it all transfers to this repo's decisions either.
3. Treat everything under Section 3 (module layout) as **structure only**, not implemented
   behavior, until this file says otherwise.
4. **Update this file after any meaningful work** — spec decisions, architecture decisions, first
   real code — so the next session isn't rediscovering state from git log archaeology.
5. Don't create a GitHub remote or push without asking first (Section 4, Q4).
