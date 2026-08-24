# server/agent/ — two runtimes, one tool layer

This directory holds **two** agent implementations, deliberately kept separate rather than
merged, because they serve different, still-active parts of the product
(docs/AI_ASSISTANT_ARCHITECTURE.md §2–§3):

- **`runtime.ts`** — the legacy request/response loop. Backs `POST /api/agent/run` and
  `/api/agent/approve`, real tool calls across all 6 sources, the write-approval pause, and
  therefore the Resolution Center's "Investigate with AI" flow. Its tool-execution machinery is
  untouched; its system-prompt building was refactored (Phase 3) to call the shared context model
  (`context/model.ts`), and it's now the runtime that consumes `actions/` (Phase 5) — the shared
  agent below doesn't have propose-tools yet.
- **`registry.ts`, `errors.ts`** — shared by BOTH runtimes, unchanged: tool discovery/
  classification and typed error handling.
- **`runtime/`, `sessions/`, `context/`, `tools/`** — the **shared agent**: one runtime for both
  GLOBAL and DISPUTE session modes (`sessions/store.ts`'s `SessionConfig`), backed by a real
  server-side session instead of client-resent history, streaming real incremental text via
  `POST /api/agent/stream`. Now a real tool-calling loop (Phase 4) — see `tools/index.ts` for
  exactly which tools it can see.
- **`actions/`** — used by `runtime.ts` (the legacy loop) as of Phase 5, not by the shared agent —
  see its own row below.

| Folder | Responsibility |
|---|---|
| `runtime/` | `sharedAgent.ts` — the loop: resolve session → build context → **LLM decides next step → tool call (execute via the SAME adapters/registry as the legacy runtime) or final answer, looped up to a step limit** → persist transcript → emit events. Structurally the same loop `runtime.ts` runs; only the LLM-call primitive (streamed vs. atomic) differs. |
| `sessions/` | `store.ts` — `SessionStore`, keyed by chat id, one `SessionConfig` per session, a real transcript, a scope guard that refuses to resume a session under the wrong config. |
| `context/` | `model.ts` — `AgentContext`, the one context representation both runtimes build their system prompt from (`agentContextFromPageContext`/`pageContextFromAgentContext` adapt each runtime's own shape onto/from it). `buildContext.ts` — turns an `AgentContext` into the system prompt; tool-availability-agnostic on purpose (each runtime states its own tool situation). |
| `tools/` | `index.ts` — `sharedAgentToolsFor()`: decides which of the registry's tools the SHARED agent is allowed to see this phase (Commas only, read-only — no OAuth connectors yet, no write-tool approval flow over SSE). Does not duplicate `server/adapters/`/`registry.ts` — reuses them directly. |
| `actions/` | `index.ts` — `propose_add_evidence`/`propose_draft_response`: LLM-visible tools with no adapter/source behind them — approving one calls a real `useChatStore` function (`addEvidenceItem`/`setResponseDraft`) directly, never a server-side execution. Consumed by `runtime.ts` (the legacy loop), offered only for an ACTIVE dispute. The shared agent doesn't have these yet — see the implementation status doc's Phase 6 entry. |

See `docs/AI_ASSISTANT_ARCHITECTURE.md` for the full target design and phased plan, and
`docs/AI_ASSISTANT_IMPLEMENTATION_STATUS.md` for what has actually shipped so far.
