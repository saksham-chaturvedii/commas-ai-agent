# Commas AI Agent — Architecture

**Status:** Approved working architecture · **Last updated:** 2026-08-21
**Companions:** `PROTOTYPE_SPEC.md` (what it does), `IMPLEMENTATION_PLAN.md` (build order),
`active-context.md` (current state).

Engineering terminology applies here (MCP client/server, tools, connectors). User-facing
copy uses "Sources" / "Connected apps" — see the spec.

Grounding rule: every claim about the real Commas platform below is limited to what
commasdocs.com confirms (recorded in `active-context.md` § Integrations). Nothing else about
the real platform may be assumed.

---

## 1. System overview

```
┌──────────────────────────────── Browser ─────────────────────────────────┐
│  React app (Commas shell reproduction)                                   │
│  · Chat view · right-side panel · floating button · Resolution Center    │
│  · composer w/ Sources selector · approval cards · credits UI            │
└─────────────┬───────────────────────────────▲────────────────────────────┘
              │ REST (start run, approve,     │ SSE (agent events)
              │ cancel, CRUD chats)           │
┌─────────────▼───────────────────────────────┴────────────────────────────┐
│  Backend — Node/TypeScript ("Commas AI Agent" service)                   │
│                                                                          │
│  ┌───────────┐   ┌──────────────┐   ┌───────────────┐   ┌─────────────┐  │
│  │ HTTP/SSE  │──▶│ Agent runtime │──▶│ LLM client    │   │ Chat store  │  │
│  │ layer     │   │ (run loop,    │   │ (@anthropic-  │   │ (in-memory  │  │
│  │           │◀──│ state machine)│◀──│ ai/sdk)       │   │ + JSON file)│  │
│  └───────────┘   └──────┬───────┘   └───────────────┘   └─────────────┘  │
│                         │ tool calls                                     │
│                  ┌──────▼────────┐                                       │
│                  │ Tool registry │  read/write class, labels, credits,   │
│                  │ + approval    │  per-chat source scoping              │
│                  │ gate          │                                       │
│                  └──────┬────────┘                                       │
│                         │ dispatch                                       │
│                  ┌──────▼────────┐                                       │
│                  │ MCP client    │  (@modelcontextprotocol/sdk)          │
│                  └──┬─────────┬──┘                                       │
└─────────────────────┼─────────┼──────────────────────────────────────────┘
        in-process    │         │    in-process (one per connected app)
┌─────────────────────▼──┐   ┌──▼───────────────────────────────────────┐
│ Mock Commas MCP server │   │ Mock external MCP servers                │
│ · 11 fanbasis_* read   │   │ · fathom · zoom · google-meet ·          │
│   tools (real shapes)  │   │   clickfunnels                           │
│ · gated write tools    │   │ (hand-authored consistent datasets)      │
│ · mock dispute tools   │   └──────────────────────────────────────────┘
│   (prototype-only)     │
└────────────────────────┘
   ⚙ config flag: swap mock Commas server for the REAL remote Commas MCP
     server (Streamable HTTP + x-api-key; QA sandbox only) — same client.
```

## 2. Frontend

- **Stack:** React 18 + TypeScript + Vite + Tailwind CSS v4 (matches `commas-ai-copilot`, so
  its shell components port directly). `lucide-react` icons. No router/state library — the
  old prototype's hand-rolled view union extends fine for this scope.
- **Responsibilities:** all rendering (shell, chat surfaces, Resolution Center, sources
  management, credits), optimistic UI for chat input, SSE consumption → event-to-component
  mapping, approval interactions.
- **Explicit non-responsibilities:** no LLM calls, no secrets, no tool logic, no credit
  arithmetic (display only). The frontend renders what the backend's event stream says.

## 3. Backend

- **Stack:** Node 20+, TypeScript, **Hono** (small, typed, first-class SSE) serving a JSON
  API + SSE endpoints; single process, in-process mock MCP servers.
- **API surface (prototype):**
  - `POST /api/chats` · `GET /api/chats` · `GET /api/chats/:id` · `DELETE /api/chats/:id`
  - `POST /api/chats/:id/messages` — user message; starts a run; responds `{runId}`
  - `GET /api/runs/:runId/events` — SSE stream (§9)
  - `POST /api/runs/:runId/approval` — `{decision: "approve" | "decline"}`
  - `POST /api/runs/:runId/cancel`
  - `GET /api/sources` · `POST /api/sources/:id/connect|disconnect` (simulated)
  - `GET /api/credits` · `POST /api/demo/reset` (credits + mock-data reset)
- Serves the built frontend statically in demo mode; Vite proxy in dev.

## 4. Agent (runtime)

The orchestration layer. One **run** = one user message processed to termination.

- Run state machine: `running → awaiting_approval → running → completed | cancelled |
  error` (plus direct `running → completed` when no writes occur). One active run per chat.
- Composes the LLM request each iteration: system prompt (agent persona + safety rules +
  output rules), conversation history, page context (e.g. dispute id) as structured context,
  and the tool set filtered by the chat's enabled sources.
- Enforces: hard iteration cap (default 12 tool-call rounds), per-run wall-clock timeout,
  the write-approval gate (§14), and cancellation checks at every loop boundary.
- Emits agent events (§9) at every transition; maps tool activity to safe progress labels
  from the registry — model thinking is never forwarded (see §5).

## 5. LLM

- **SDK:** `@anthropic-ai/sdk` (TypeScript). **Model:** `claude-opus-5`.
- **Loop mechanism:** the SDK beta **tool runner** (`client.beta.messages.toolRunner` with
  `betaZodTool` definitions) — it drives the request → execute → continue cycle, and its
  per-turn hooks are where the approval gate, cancellation check, credit metering, and event
  emission live. If a control-flow need outgrows the hooks, fall back to a manual
  `stop_reason === "tool_use"` loop — an implementation detail behind the Agent interface.
- **Thinking:** adaptive (model default). Thinking display stays omitted; thinking blocks
  are never serialized into events or persisted transcripts. Streaming on for final answers
  (`message.delta` events).
- Prompt-caching: stable prefix ordering (system prompt and tool list frozen per release;
  volatile context after) so multi-turn runs stay cheap.
- The Anthropic API key lives in `ANTHROPIC_API_KEY` on the backend only.

## 6. MCP client

- `@modelcontextprotocol/sdk` client inside the backend. One client session per MCP server.
- Transports: **in-process** for all mock servers (direct transport pair — no
  network, no child processes); **Streamable HTTP** for the optional real Commas server
  (§7). The dispatch path is transport-agnostic: registry → client → server.
- On startup, the client lists each server's tools and hands them to the tool registry (§8).
- Why not the Anthropic Messages-API MCP connector (`mcp_servers` + `mcp_toolset`): it
  requires the MCP server to be reachable from Anthropic's infrastructure, which in-process
  mocks are not. It remains a viable later option for real-mode only.

## 7. MCP servers

**Mock Commas MCP server** (in-process, default):
- Implements the 11 documented read tools with their real names and shapes
  (`fanbasis_list_products`, `fanbasis_list_customers`, `fanbasis_list_transactions`,
  `fanbasis_get_transaction`, `fanbasis_list_subscribers`, `fanbasis_get_checkout_session`,
  `fanbasis_get_session_transactions`, `fanbasis_get_session_subscriptions`,
  `fanbasis_list_discount_codes`, `fanbasis_get_discount_code`,
  `fanbasis_get_payment_methods`). Response shapes follow the documented REST responses the
  tools proxy.
- Write tools mirroring the documented write actions (charge, refund, discount
  create/update/delete, subscription extend/cancel) — mutations apply to the in-memory mock
  dataset so effects are verifiable in-chat.
- **Prototype-only dispute tools** (`commas_list_disputes`, `commas_get_dispute`,
  `commas_mark_response_ready`): these have **no real-platform equivalent** (confirmed — no
  disputes API/MCP tool exists). Records are shaped like the documented `dispute.created`
  webhook payload. They are namespaced `commas_` (not `fanbasis_`) precisely so nobody
  mistakes them for real tools.

**Mock external MCP servers** — `fathom`, `zoom`, `google-meet`, `clickfunnels`, each a tiny
in-process server with 1–3 read tools over hand-authored data consistent with the dispute
scenario (see spec §3). No write tools.

**Real Commas MCP server** (optional, behind `COMMAS_MCP_MODE=real`):
- The confirmed remote endpoint (Streamable HTTP, `x-api-key` header; currently the
  Railway URL documented in commasdocs.com's Claude Desktop config). QA sandbox keys only;
  the backend refuses real mode without an explicit `COMMAS_ALLOW_REAL=1`.
- Note: the real server has no dispute tools, so the flagship flow always uses mock dispute
  data regardless of mode.

## 8. Tool registry

The backend's single source of truth about every tool, built at startup from MCP
`tools/list` results joined with a static metadata map:

```ts
interface RegisteredTool {
  name: string;              // MCP tool name, e.g. "fanbasis_list_transactions"
  sourceId: SourceId;        // "commas" | "fathom" | "zoom" | "google-meet" | "clickfunnels"
  classification: "read" | "write";   // write ⇒ approval required, no exceptions
  progressLabel: string;     // safe UI label: "Checking transaction history…"
  displayName: string;       // "Transaction history" (for collapsed summaries)
  creditCost: number;        // per-call deduction (writes > reads)
  approvalSummary?: (input) => string; // human sentence for the approval card
  inputSchema: JsonSchema;   // from the MCP server; converted to the LLM tool definition
}
```

Responsibilities: expose the LLM tool set filtered by the chat's enabled sources; classify
read/write (an MCP tool missing from the metadata map defaults to `write` + generic label —
fail safe); provide labels so raw tool names never reach the UI; price credit costs.

## 9. Agent events (SSE)

The only channel by which agent activity reaches the UI. Envelope:
`{runId, seq, ts, type, data}`. Event types:

| type | data | UI rendering |
|---|---|---|
| `run.started` | `{chatId}` | progress block appears |
| `status` | `{text}` | coarse phase line ("Investigating…") |
| `tool.started` | `{callId, sourceId, progressLabel}` | spinner line |
| `tool.completed` | `{callId, ok, displayName}` | tick / soft-fail mark |
| `message.delta` | `{text}` | streamed answer text |
| `approval.required` | `{approvalId, summary, sourceId}` | approval card (run paused) |
| `approval.resolved` | `{approvalId, decision}` | card state update |
| `credits.updated` | `{balance, spentThisRun}` | balance animation |
| `run.completed` | `{messageId, toolSummary}` | collapse progress → summary |
| `run.cancelled` | `{}` | "Stopped by you" |
| `run.error` | `{userMessage}` | error state + retry |

Contract: no event ever carries model thinking, raw prompts, raw tool inputs/outputs, or
internal error detail. `seq` is monotonic for client-side reconnect/replay of a run.

## 10. Conversation state & persistence

```ts
interface Chat { id; title; createdAt; updatedAt; enabledSources: SourceId[];
                 context?: PageContext; messages: ChatMessage[] }
type ChatMessage =
  | { role: "user"; text; ts }
  | { role: "assistant"; text; ts; toolSummary?: ToolSummaryItem[];
      approvals?: ResolvedApproval[] };
interface AppState { chats; credits: {balance}; sources: SourceState[];
                     mockData: MockDataset }
```

- Persistence: in-memory store, snapshotted to a local JSON file (`data/state.json`,
  gitignored) after mutations; loaded on boot. Survives restarts; `POST /api/demo/reset`
  restores the pristine dataset. No database in this prototype — the store sits behind a
  `ChatStore` interface so SQLite could replace it without touching the agent.
- Transcripts persist resolved state only (final text, tool summaries, resolved approvals) —
  transient progress events are not stored; historical chats re-render from transcripts.

## 11. Authentication

- **Prototype users:** none. Single implicit seller (matching the one-seller mock world); no
  login. This mirrors the demo scope, not the real product.
- **Secrets:** environment variables on the backend only — `ANTHROPIC_API_KEY` (required),
  `COMMAS_API_KEY` (only for optional real mode; QA sandbox key). Never in the repo, never
  sent to the browser. `.env` is gitignored; `.env.example` documents the shape.
- **Real Commas semantics (for fidelity):** the real platform authenticates with an
  `x-api-key` header carrying scoped seller keys — the real-mode MCP connection passes it as
  a header exactly as the docs' `mcp-remote` config does.

## 12. Authorization

Layered, all backend-side:

1. **Source scoping (per chat):** disabled sources' tools are excluded from the LLM tool set
   *and* rejected at dispatch if called anyway.
2. **Read/write classification (per tool):** from the registry; unknown tools fail safe to
   `write`.
3. **Write approval (per call):** §14 — no write dispatches without a user-approved token.
4. **Real-mode guard (per deployment):** real Commas access requires two explicit env flags
   and, by policy, a sandbox-scoped key (the real platform's key scopes — e.g. a key without
   `refunds` — would 403 server-side as an additional backstop; scope granularity is a
   confirmed platform feature).

## 13. Write approval

The full round trip:

1. LLM emits a tool call classified `write`.
2. The tool-runner hook intercepts **before execution**; run state → `awaiting_approval`;
   an `approval.required` event carries a human-readable `approvalSummary(input)`.
3. UI renders the approval card; composer locked for this chat.
4. `POST /api/runs/:runId/approval` with the decision (idempotent; only valid in
   `awaiting_approval`).
   - **approve** → tool executes, result returns to the LLM, run resumes.
   - **decline** → tool is *not* executed; a synthetic declined-result is returned to the
     LLM ("The user declined this action") so it can adapt; run resumes.
5. `approval.resolved` event; card renders its final state; resolved approvals persist in
   the transcript.

Timeout: a run left `awaiting_approval` for 10 minutes auto-declines and completes, so runs
can't hang forever. The gate is server-side — a compromised/buggy frontend cannot cause a
write without the approval endpoint being called.

## 14. Credits

Backend-metered per run: base cost 1/message + 1 per read call + 5 per write call (tunable
constants). Deducted at run end (cancelled runs pay for what ran). `credits.updated` events
drive the UI; balance persists in the store; demo reset restores it. No real billing.

## 15. Request/response loop (end to end)

```
Seller                UI                Backend/Agent            LLM            MCP client → server
  │  types message     │                     │                    │                     │
  │───────────────────▶│ POST /messages      │                    │                     │
  │                    │────────────────────▶│ create run          │                     │
  │                    │◀─ {runId} ──────────│                    │                     │
  │                    │ GET /events (SSE)   │                    │                     │
  │                    │────────────────────▶│                    │                     │
  │                    │◀═ run.started ══════│                    │                     │
  │                    │                     │── messages+tools ─▶│                     │
  │                    │                     │◀─ tool_use ────────│                     │
  │                    │◀═ tool.started ═════│                    │                     │
  │                    │                     │── callTool ─────────────────────────────▶│
  │                    │                     │◀─ result ────────────────────────────────│
  │                    │◀═ tool.completed ═══│                    │                     │
  │                    │                     │── tool_result ────▶│   (loop: more tool  │
  │                    │                     │◀─ tool_use… ───────│    rounds as needed)│
  │                    │                     │                    │                     │
  │                    │                     │  [write tool?] pause                     │
  │                    │◀═ approval.required═│                    │                     │
  │  clicks Approve    │                     │                    │                     │
  │───────────────────▶│ POST /approval      │                    │                     │
  │                    │────────────────────▶│ execute write ──────────────────────────▶│
  │                    │◀═ approval.resolved═│◀─ result ────────────────────────────────│
  │                    │                     │── tool_result ────▶│                     │
  │                    │                     │◀─ final text ──────│                     │
  │                    │◀═ message.delta* ═══│  (streamed)        │                     │
  │                    │◀═ credits.updated ══│                    │                     │
  │  reads answer      │◀═ run.completed ════│ persist transcript │                     │
```

Cancellation (`POST /cancel`) and errors short-circuit this loop at the next boundary with
`run.cancelled` / `run.error`, followed by transcript persistence.
