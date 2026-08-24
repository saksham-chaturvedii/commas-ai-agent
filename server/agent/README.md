# server/agent/ — two runtimes, side by side

This directory now holds **two** agent implementations, deliberately kept separate rather than
merged, because they serve different, still-active parts of the product
(docs/AI_ASSISTANT_ARCHITECTURE.md §2–§3):

- **`runtime.ts`, `registry.ts`, `errors.ts`** (existing, unchanged) — the legacy request/response
  loop. Backs `POST /api/agent/run` and `/api/agent/approve`, real tool calls across all 6 sources,
  the write-approval pause, and therefore the Resolution Center's "Investigate with AI" flow.
  Nothing in this phase modifies these three files.
- **`runtime/`, `sessions/`, `context/`, `tools/`, `actions/`** (new) — the **shared agent**: one
  runtime for both GLOBAL and DISPUTE session modes (`sessions/store.ts`'s `SessionConfig`),
  backed by a real server-side session instead of client-resent history, streaming real
  incremental text via `POST /api/agent/stream`. Currently reachable only from global-mode chats
  in the frontend; conversation-only (no tools yet — see `tools/index.ts`).

| Folder | Responsibility |
|---|---|
| `runtime/` | `sharedAgent.ts` — the loop: resolve session → build context → stream reply → persist transcript → emit events. |
| `sessions/` | `store.ts` — `SessionStore`, keyed by chat id, one `SessionConfig` per session, a real transcript, a scope guard that refuses to resume a session under the wrong config. |
| `context/` | `buildContext.ts` — turns a session's config into the system prompt. The one place "global vs dispute" changes anything. |
| `tools/` | Placeholder — deliberately empty this phase. The real tool layer (`server/adapters/`, `registry.ts`) isn't duplicated here; a later phase wires it into the shared agent's own loop. |
| `actions/` | Placeholder — deliberately empty this phase. Hosts the propose → approve → execute pipeline once dispute-mode tools exist. |

See `docs/AI_ASSISTANT_ARCHITECTURE.md` for the full target design and phased plan, and
`docs/AI_ASSISTANT_IMPLEMENTATION_STATUS.md` for what has actually shipped so far.
