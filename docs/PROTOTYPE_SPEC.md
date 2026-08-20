# Commas AI Agent — Prototype Specification

**Status:** Approved working spec · **Last updated:** 2026-08-21
**Companions:** `ARCHITECTURE.md` (how it's built), `IMPLEMENTATION_PLAN.md` (build order),
`active-context.md` (current state — read that first in any new session).

Terminology note: this document describes the *product*. User-facing copy always says
**"Sources"** or **"Connected apps"** — never "MCP", "servers", "tools", or "connectors" as
jargon. MCP client/server terminology appears only in `ARCHITECTURE.md`.

---

## 1. Product

### 1.1 Objective

Demonstrate what a **native AI agent inside Commas** looks and behaves like: a seller asks
questions or delegates tasks in natural language, and the agent investigates across their
Commas business data (and connected apps) with real multi-step reasoning and tool use —
surfacing safe, legible progress while it works, asking permission before it changes anything,
and never submitting anything on the seller's behalf.

This is the technical successor to the `commas-ai-copilot` UI demo: that prototype *looked*
like AI; this one *is* an agent (real LLM, real agent loop) running over mocked data.

### 1.2 Target experience

The agent is woven through the Commas product, not bolted on as a separate destination:

- **Notion AI** is the reference for chat surfaces: chat living in the left nav, a right-side
  panel that accompanies whatever page you're on, and source management in settings.
- **Claude Desktop** is the reference for the composer: contextual suggested actions, a
  scope/source picker, and a clean empty state.
- **Native Commas UI** (see `references/commas-dashboard.png`, `references/resolution-center.png`)
  is the visual system everything must feel native to.

The tone of the agent: an efficient back-office analyst. It answers directly when it can,
investigates when it must, shows its working at the level of *what it checked* (never internal
reasoning), and treats anything that moves money as requiring explicit seller approval.

### 1.3 Prototype success criteria

The prototype succeeds if, in a live demo:

1. A question with no data dependency gets a direct streamed answer with no tool calls.
2. A data question triggers visible tool use against (mock) Commas data, with progress lines
   appearing as the agent works, and ends in a correct, sourced answer.
3. A task requiring several dependent lookups shows genuine multi-step behavior — the agent
   chooses its next tool based on the previous result, not a script.
4. A write request produces an approval card; nothing executes until the seller confirms;
   declining cleanly aborts.
5. The flagship Resolution Center flow works end to end: contextual AI on a dispute
   investigates across Commas + connected app data and drafts an evidence response, which the
   seller reviews. The agent never submits.
6. A running investigation can be cancelled mid-flight and the chat remains usable.
7. Credits visibly decrement with agent usage.
8. At no point is model chain-of-thought, a raw prompt, or a raw tool payload dumped into the
   UI.

Non-goals: real dispute data (confirmed impossible — no Commas disputes API), real evidence
submission (dashboard-only in the real product), real external app OAuth, multi-user auth,
billing, production hardening.

---

## 2. UX

All surfaces below render inside the reproduced Commas app shell (left icon rail, top nav,
content area) ported from the old prototype.

### 2.1 Left navigation

- A new **Chat** entry (comment-bubble icon) in the left rail, alongside the existing Commas
  nav items. Active state matches Commas' existing nav treatment.
- Clicking it opens the **Chat view** (full content-area surface, §2.2).

### 2.2 Chat view

Two-column layout, modeled on `references/notion-ai-chat.png`:

- **Left column:** chat list — "New chat" button at top, then history grouped by recency
  (Today / Yesterday / Earlier). Each row: auto-generated title (first user message,
  truncated), relative timestamp. Active chat highlighted.
- **Main column:** the conversation. User messages right-aligned cards; agent responses as
  rich text (markdown: paragraphs, lists, bold, tables). During a run, a **progress block**
  renders above the forming answer (§5.3). Completed tool activity collapses into a subtle
  "Checked 4 sources" summary line that can expand.
- **Composer** (bottom, persistent): text input, send button, plus-menu, and the **controls
  menu** containing the Sources selector (§2.9) — mirroring `references/notion-mcp-2.png`.

### 2.3 New Chat

- "New chat" button (with ⌘O-style keyboard hint, as in the Notion reference) in the chat
  list header, plus a compose icon-button.
- Creates an empty conversation and shows the empty state (§2.7). The previous chat is
  preserved in history.

### 2.4 Chat history

- All chats persist across page reloads (backend-persisted; see `ARCHITECTURE.md` §10).
- Selecting a historical chat restores the full transcript including collapsed tool-activity
  summaries and any approval cards in their resolved state.
- Chats can be deleted from a row overflow menu. No rename/pin/search in this prototype.

### 2.5 Right-side AI panel

Modeled on `references/notion-ai-chat-3.png`:

- Opens as a docked panel on the right edge of any main app page (dashboard, Resolution
  Center), pushing content, not overlaying it.
- Contains a full chat surface (same conversation component as §2.2, narrower layout) with a
  **page-context chip** in the composer showing what the panel is looking at (e.g. a chip
  reading "Dispute #2481") — the agent receives that context automatically.
- Header: current chat title, switcher back to full Chat view, close button.

### 2.6 Floating AI button

- A circular floating action button, bottom-right of every page where the panel is closed
  (visual weight like the Commas help bubble in `references/commas-dashboard.png`).
- Click → opens the right-side panel (§2.5) with page context attached.
- Hidden while the panel is open.

### 2.7 New-chat empty state

Modeled on `references/notion-ai-chat-2.png`:

- Centered agent mark + greeting ("How can I help you today?").
- Composer front and center with placeholder copy ("Ask about your business…").
- Beneath the composer: **suggested capabilities** (§2.8).
- A dismissible "Get better answers from your apps" strip showing Connected apps icons,
  linking to source management (§2.9) — as in the Claude Desktop reference.

### 2.8 Suggested capabilities

- 3–4 contextual suggestion chips under the empty-state composer, in the style of
  `references/claude-desktop.png` ("Search for a `TODO` and fix it"-style specific actions).
- Global chat suggestions (drawn from what the mock data can actually answer):
  - "Summarize my sales this month"
  - "Which discount codes get used the most?"
  - "Look up a customer" (opens with a prefilled pattern)
  - "Help me respond to my open dispute"
- Contextual surfaces override these: in the Resolution Center panel the suggestions are
  dispute-specific (§2.11). Clicking a chip submits it as the first message.

### 2.9 Source / Connected apps selector

Two related surfaces, both using **"Sources" / "Connected apps"** language:

- **In the composer** (per-chat scope): a controls menu as in `references/notion-mcp-2.png`
  listing "My sources" with per-source toggles (Commas, Fathom, Zoom, Google Meet,
  ClickFunnels). Toggling a source off means the agent will not use it in this chat. Commas
  is on by default; connected apps are on when connected.
- **Management page** (workspace-level): a "Connected apps" section modeled on Notion's
  Connections gallery (`references/notion-mcp.png`) and visually harmonized with Commas'
  existing Integrations settings page (`references/commas-integrations.png`): a card/row per
  app with name, description, and Connect / Disconnect. "Connecting" is a simulated OAuth
  moment (brief pending state, then connected) — no real OAuth.

### 2.10 AI credits

- A credit balance (e.g. starting at 300) shown in the Chat view sidebar footer and in the
  right-panel header.
- Each agent run deducts credits (flat per-message cost plus per-tool-call cost; exact
  numbers in `ARCHITECTURE.md` §14). Balance animates down after each run.
- At zero, the composer disables with an upgrade-style callout ("You're out of AI credits").
  A demo-only reset control restores the balance. No real billing.

### 2.11 Contextual Resolution Center AI (flagship)

- The Resolution Center list and Dispute Detail pages are reproduced from the old prototype
  (one seeded dispute: Sarah Johnson, #2481, $499, "Product not received").
- On Dispute Detail, an **"Investigate with AI"** affordance (button in the page, plus the
  floating button/panel with dispute context) opens the right-side panel with:
  - dispute context chip attached,
  - dispute-specific suggested capabilities: "Investigate this dispute", "Draft an evidence
    response", "What's the customer's history?", "Check delivery across connected apps".
- The investigation flow itself is Demo Flow 5 (§5.5). The agent's output is a structured
  case summary + drafted response the seller can copy — the **seller** remains the one who
  would submit, and in this prototype submission stays simulated exactly as the real product
  requires (evidence submission is dashboard-only; there is no API).

---

## 3. Integrations

One real platform (mocked for the demo) and four connected apps (fully mocked). Fidelity
rule: mock tools mirror the shapes of the real Commas MCP tools (documented at
commasdocs.com) so that swapping in the real server later is a config change, not a rewrite.

### 3.1 Commas (primary source; always available)

Grounded in confirmed platform capabilities (see `active-context.md` § Integrations):

- Read: products, customers (search by name/email/phone), transactions (list + detail),
  subscribers, checkout sessions (+ their transactions/subscriptions), discount codes,
  customer payment methods (last-4 only).
- Write (all approval-gated in the product and in this prototype): charge a customer, refund
  a transaction, create/update/delete discount codes, extend/cancel subscriptions.
- Disputes: **the real platform has no dispute read/write API** — dispute data exists in this
  prototype as mock records shaped like the documented `dispute.created` webhook payload
  (status, reason, amounts, `due_by`, customer). Evidence submission is not available even in
  the real product's API; the prototype simulates a "mark response ready" step only.

### 3.2 Fathom (connected app; mocked)

Call recordings/summaries for the seller's customer calls. Mock data: 2 call summaries with
the dispute customer (onboarding call, coaching session) with dates, durations, attendee
emails, and AI summaries. Supports "search calls with {customer}".

### 3.3 Zoom (connected app; mocked)

Meeting history. Mock data: meeting occurrences matching the Fathom calls (join times,
duration, participant email matching the dispute customer) — corroborating evidence that
sessions actually happened.

### 3.4 Google Meet (connected app; mocked)

Calendar-linked meeting records: scheduled 1:1s with the customer, accepted invitations,
attendance. One no-show entry to make data realistic.

### 3.5 ClickFunnels (connected app; mocked)

Funnel/order data: the customer's opt-in and purchase funnel steps (page views, order form
completion, upsell declined) with timestamps consistent with the Commas transaction.

All five sources' mock datasets must be **internally consistent** — same customer identity,
compatible timestamps, one coherent story — extending the old prototype's audited dataset.

---

## 4. Agent behavior

### 4.1 Direct answers

If the request needs no data (greetings, "what can you do", general questions), the agent
answers immediately with streamed text. No tool calls, no progress block, minimal credit
cost.

### 4.2 Tool selection

The agent chooses tools itself (LLM-driven) from the registry of sources enabled for the
chat. It receives page context (e.g. the open dispute) as structured context, not as a
scripted route. Disabled sources are excluded from its tool set entirely.

### 4.3 Multi-step tool use

The agent loops — call tool → read result → decide next step — until it has enough to
answer. Dependent chains must work (e.g. find customer → pull their transactions → pull the
session for the disputed transaction). Parallel calls are allowed where independent.

### 4.4 Read operations

Execute immediately, no confirmation. Each call surfaces one safe progress line (§5.3
vocabulary) while running.

### 4.5 Write operations

Any state-changing tool (refund, charge, discount create/update/delete, subscription
extend/cancel, and the simulated "mark dispute response ready") is classified `write` in the
registry and can never auto-execute.

### 4.6 Confirmation before writes

When the agent decides a write is needed, the run pauses and the chat renders an **approval
card**: plain-language action summary ("Create discount code LAUNCH20 — 20% off, max 100
uses"), the source it runs against, and Approve / Decline buttons.
- Approve → the tool executes, the run continues, the card shows "Approved · done".
- Decline → the tool is not executed; the agent is told and must adapt (offer alternatives
  or conclude), card shows "Declined".
This mirrors the real Commas MCP/CLI design, where write actions are confirmation-gated.

### 4.7 Errors

- A failing tool call does not kill the run: the agent is given the error and may retry
  once, try another route, or explain what it couldn't do.
- Unrecoverable run errors (LLM failure, backend fault) render an error state in the chat
  with a retry affordance; the transcript survives.
- Errors shown to users are human sentences, never stack traces or raw payloads.

### 4.8 Cancellation

A Stop control is visible during any run. Cancelling halts the loop at the next boundary
(in-flight tool result discarded), renders "Stopped by you" plus whatever partial answer is
safe to show, refunds no credits, and leaves the chat immediately usable.

### 4.9 Credits

Each run deducts credits: base cost per user message + per-tool-call cost (writes cost
more). The balance updates when the run ends. At zero the composer disables (§2.10);
in-flight runs complete.

### 4.10 Termination conditions

A run ends when exactly one of: the agent produces a final answer; the seller cancels; the
seller declines an approval and the agent concludes; an unrecoverable error occurs; or the
loop hits its hard iteration cap (safety limit, surfaced as "I couldn't finish this
investigation" with partial findings). There is no unbounded looping.

### 4.11 Progress, not chain-of-thought

The user sees: which source is being checked, a human label of the action, and completion
ticks — e.g. "Checking transaction history…", "Searching Fathom calls with Sarah…".
The user never sees: model reasoning/thinking text, raw prompts, raw tool JSON, or internal
tool names (`fanbasis_list_transactions` renders as "Transaction history").

---

## 5. Demo flows

These five flows are the definition of done; the e2e suite automates them (see
`IMPLEMENTATION_PLAN.md` Phase 6).

### 5.1 Direct answer (no tools)

Open Chat → new chat → "What can you help me with?" → streamed direct answer describing
capabilities; no progress block; credits tick down by the base cost.

### 5.2 Single-step read

"How many active subscribers do I have?" → one progress line ("Checking subscribers…") →
answer with the correct number from mock data and a one-line source note.

### 5.3 Multi-step investigation (general)

"Give me a summary of my sales this month" → agent chains at least two reads (transactions +
products; optionally discount codes) → progress lines appear sequentially → answer contains
totals, top product, and refund count, all consistent with mock data → collapsed "Checked N
sources" summary remains in the transcript.

### 5.4 Write with approval — both branches

"Create a 20% discount code called LAUNCH20 limited to 100 uses" → approval card appears,
nothing executes → **Branch A:** Approve → code is created in mock data (verifiable via a
follow-up "list my discount codes") → confirmation message.
**Branch B (separate chat):** Decline → agent acknowledges without executing; follow-up list
shows no such code.

### 5.5 Flagship — Resolution Center dispute investigation

From Dispute #2481 detail page → "Investigate with AI" → right panel opens with dispute
context chip and dispute-specific suggestions → "Investigate this dispute" →
agent visibly works through: dispute record → customer lookup → transaction detail →
subscriber/access records → Fathom calls → Zoom meetings → Google Meet calendar →
ClickFunnels order trail (order may vary; ≥4 sources including ≥2 connected apps) →
structured result: case summary, timeline of the customer's engagement, itemized evidence
with per-item source attribution, and a **drafted evidence response**. The seller can copy
the draft. A "mark response ready" action, if invoked, is a simulated write behind the
standard approval card. Nothing is ever submitted anywhere.

### 5.6 Control flows (demonstrated within the above)

- **Cancellation:** during 5.5's investigation, hit Stop → run halts cleanly → re-ask works.
- **Source scoping:** disable all connected apps in the composer → rerun 5.5 → agent uses
  Commas data only and says which sources it couldn't check.
- **Credits exhaustion:** demo control drops balance to 0 → composer disables with callout →
  reset restores it.
