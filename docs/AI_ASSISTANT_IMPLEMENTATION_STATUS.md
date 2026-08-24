# AI Assistant Implementation Status

**Branch:** `experiment/unified-ai-assistant`
**Baseline commit (main):** `c3a250c6701427e065aa388205f1f3516cc38216`
**Baseline document:** [`AI_ASSISTANT_BASELINE.md`](./AI_ASSISTANT_BASELINE.md)
**Architecture document:** [`AI_ASSISTANT_ARCHITECTURE.md`](./AI_ASSISTANT_ARCHITECTURE.md)

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

**1 — Architecture analyzed (not implemented)**

The unified-assistant design is defined in `AI_ASSISTANT_ARCHITECTURE.md`. Decision: **one shared agent system** — the existing `server/agent` runtime, `LlmClient` seam, `SourceAdapter` registry, `useChatStore`, and chat components are kept and evolved; mode (global vs dispute) is derived from a typed scope on each chat, never from a second code path. Recommended stack: `@anthropic-ai/sdk` directly (already installed; `messages.stream()`, N tool calls per turn, `AGENT_MODEL` env), a server-side session store keyed by chat id with a scope guard, an AG-UI-named SSE event stream from Hono consumed by the existing store, one server dataset behind a wider tool layer (read / propose / write classifications), and a proposal → human approval → browser-executed action channel into the Resolution Center. **CopilotKit: not introduced. Claude Agent SDK: not introduced.** Zero new runtime dependencies required. Patterns (not packages) are ported from the `commas-ai-copilot` POC.

**Nothing has been implemented.** No implementation files were modified in this phase; no dependencies were installed. The architecture is the only deliverable.

## Phase log

| Phase | Description | Status |
|---|---|---|
| 0 | Baseline documentation (`AI_ASSISTANT_BASELINE.md`, this file) | ✅ Complete — 2026-08-24 |
| 1 | Architecture definition (`AI_ASSISTANT_ARCHITECTURE.md`) — one shared agent, two modes; stack, session/context, tools, actions, persistence, risks, sequencing | ✅ Analyzed, not implemented — 2026-08-24 |
| 2 | Implementation phase 1: live model on the existing loop (streaming client, multi tool_use, `AGENT_MODEL`, smoke script) — see architecture §11 | ⏳ Next (awaiting go) |

## Implementation sequence (from architecture §11)

1. Live model on the existing loop (no UI change)
2. One dataset + wider Commas/connector tools with citations
3. Server-side sessions + context envelope + context block
4. Streaming SSE transport consumed by `useChatStore`
5. Dispute-mode investigation prompt (loop, stopping criteria, report format)
6. Resolution Center persistence + proposal/approval actions (`ProposalCard`, executors)
7. Global-mode polish, hardening, docs, regression suite

## Notes

- The only agent component never exercised live is `server/llm/anthropicClient.ts`; every recorded behavior comes from `server/llm/stubClient.ts`. An `ANTHROPIC_API_KEY` is required to change that (see `.env.example`).
- `docs/active-context.md` is the accurate history of how `main` got here; `docs/ARCHITECTURE.md` / `IMPLEMENTATION_PLAN.md` describe parts that were never built (SSE, backend store, metered credits). See baseline §13–§15 for the reconciled list.
- The sibling `../commas-ai-copilot` repo (and its `experiment/copilotkit-poc` branch) is reference material only — nothing is imported across repos.
