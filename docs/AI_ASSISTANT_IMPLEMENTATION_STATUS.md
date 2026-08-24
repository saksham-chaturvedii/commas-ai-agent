# AI Assistant Implementation Status

**Branch:** `experiment/unified-ai-assistant`
**Baseline commit (main):** `c3a250c6701427e065aa388205f1f3516cc38216`
**Baseline document:** [`AI_ASSISTANT_BASELINE.md`](./AI_ASSISTANT_BASELINE.md)

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

**0 — Baseline**

The repository was inspected in full (structure, `package.json`, build config, env vars, routing, state, chat store, agent runtime, LLM clients, adapters, MCP mocks, Resolution Center, evidence flows, credits, connected-apps UI, mock data, docs, tests) and the result is recorded in `AI_ASSISTANT_BASELINE.md`. No implementation files were modified, no dependencies were installed, no refactoring was performed.

Baseline verification on `main` @ `c3a250c` before branching: working tree clean · `npm run build` ✅ · `npm run typecheck` ✅ · `npm test` ✅ 94/94 · `npm run dev:server` + `npm run dev` boot and respond ✅.

## Phase log

| Phase | Description | Status |
|---|---|---|
| 0 | Baseline documentation (`AI_ASSISTANT_BASELINE.md`, this file) | ✅ Complete — 2026-08-24 |
| 1 | Architecture definition for the unified assistant (what changes behind `LlmClient` / `SourceAdapter` / `agentApi`, session model, action-proposal model) | ⏳ Next |

## Notes

- The only agent component never exercised live is `server/llm/anthropicClient.ts`; every recorded behavior comes from `server/llm/stubClient.ts`. An `ANTHROPIC_API_KEY` is required to change that (see `.env.example`).
- `docs/active-context.md` is the accurate history of how `main` got here; `docs/ARCHITECTURE.md` / `IMPLEMENTATION_PLAN.md` describe parts that were never built (SSE, backend store, metered credits). See baseline §13–§15 for the reconciled list.
- The sibling `../commas-ai-copilot` repo (and its `experiment/copilotkit-poc` branch) is reference material only — nothing is imported across repos.
