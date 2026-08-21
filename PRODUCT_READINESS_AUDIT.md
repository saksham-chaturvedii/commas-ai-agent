# Commas AI Agent Prototype
## Product Readiness Audit

**Date:** 2026-08-21 · **Auditor:** Claude (read-only pass — no code was modified)
**Method:** full repository inspection + live probes against the running prototype (`npm run dev` + `npx tsx server/index.ts`). Every claim below was verified either by reading the exact code path or by exercising it live (API calls against `POST /api/agent/run`, Playwright walkthroughs). Nothing here is speculative.

---

### 1. Executive Assessment

**Perceived product readiness: 62 / 100.**

The bones are genuinely strong. This prototype has things most demos fake: a real agent runtime loop over a real (mock) MCP protocol, one authoritative state store shared by every chat surface, localStorage persistence, a credit system with correct accounting, a resolved-dispute lifecycle, evidence upload with validation, and 82 passing tests. The Commas shell fidelity (Dashboard, Resolution Center, glass chrome) is high — screenshots pass the squint test against production.

What drags the score down is **one rendering bug and a cluster of AI-answer-quality failures that would surface within the first 60 seconds of a live demo**:

1. **The flagship dispute-investigation answer renders raw `###` markdown in the chat panel.** The most impressive flow in the product displays literal `### Situation summary` text. (Confirmed live and visible in the user's own screenshots.)
2. **The stub agent contradicts the product's own data.** "Summarize my sales" answers "$2,125 across 5 transactions" directly beneath a seeded chat message claiming "$18,420 across 62 transactions" — and the Dashboard shows $18,420 too.
3. **The stub agent contradicts itself.** Investigating David Kim's dispute (the deliberately-uncertain case) yields "The customer engaged with the product after purchase" — the opposite of that case's carefully-authored story — plus "no connected apps were available" directly above a "Checked 5 sources" line.
4. **Two of five global suggestion chips produce answers that are wrong or bizarre.** "Find information across my connected apps" gets hijacked into a full Dispute #2481 investigation (in a global chat); "Help me understand why revenue dropped" returns a transaction count.
5. **The fallback string "This preview only knows a handful of demo scenarios right now" is one unmatched prompt away at all times.** It is the single most demo-destroying sentence in the product.

None of these require architecture changes. They are all fixable in the stub LLM (`server/llm/stubClient.ts`), the markdown renderer (`src/lib/liteMarkdown.tsx`), and the mock data — a focused 1–2 day pass. With P0s fixed, this demos at ~85/100.

---

### 2. Current Architecture Understanding

**Repo layout.** Vite + React 18 + Tailwind v4 frontend (`src/`), Node/Hono backend (`server/`), 82 Vitest tests (`tests/`). The sibling `../commas-ai-copilot` repo is the visual reference (Resolution Center + shell only — it has no Dashboard; the Dashboard here was built from production screenshots in `docs/references/`).

**Navigation.** No URL router. `App.tsx` holds `view: "dashboard" | "resolution-center" | "chat"` plus `rcView: "list" | "detail"` and `selectedDisputeId`. Reload always lands on Dashboard. Sidebar (`src/components/shell/Sidebar.tsx`) has 3 live entries (Home, Resolution Center, Chat) and 3 visual-only entries (Billing, Growth, Wallet).

**Chat state — single source of truth.** `src/hooks/useChatStore.tsx` (React context) owns `chats`, `sources`, `credits`, and all run state; persisted to localStorage (`commas-ai-agent:v1`). Every surface (Chat page, right panel, dispute AI) reads this one array. Dispute-context chats are stored in the same array but filtered out of the main history list (`ChatHistoryList.tsx`, `!c.context`). Deletion is real and shared (`deleteChat`, incl. the dispute panel's "Start new session" button).

**Agent loop.** UI → `POST /api/agent/run` (`src/lib/agentApi.ts`) → `server/agent/runtime.ts` loop → `LlmClient.nextStep()` → `SourceAdapter.callTool()` → result fed back → final answer. Six adapters (`server/adapters/`): Commas/Fathom/Zoom over in-process mock MCP servers, Gmail/Calendar/CRM as plain mock API adapters. Write-classified tools always pause for approval (`pendingApproval` → `/api/agent/approve`). The LLM is `StubLlmClient` (deterministic keyword router) since no `ANTHROPIC_API_KEY` exists; `AnthropicLlmClient` is real code, never invoked.

**Stub LLM routing** (`server/llm/stubClient.ts`), in priority order: hidden test phrase (`all roads lead to` → `info, my dawg.`) → no-sources guard → 5 dispute intents (draft/evidence/summarize/recommend/why) answered per-case from `mockCommasServer.ts`'s rich per-dispute fields → multi-source dispute investigation chain (Commas→CRM→Gmail→Fathom→Zoom, data authored only for Sarah Johnson/#2481) → greeting → mark-ready write → txn-id lookup → cross-apps → sales/transactions → respond/customer lookups → **generic fallback**.

**Disputes.** 5 cases in `src/lib/disputeData.ts` (mirrored in `server/mcp/mockCommasServer.ts`): #2481 Sarah Johnson (needs response), #2502 Marcus Webb (missing evidence), #2417 Elena Cruz (evidence ready), #2455 David Kim (high-risk/uncertain), #2390 Priya Nair (Won/resolved — read-only page, seeded evidence with attachments, submitted response, no AI button).

**Evidence.** Per-dispute items live in `App.tsx` state (`evidenceByDispute`, seeded from `seedEvidenceItems`), session-lifetime only. `AddEvidenceModal` has a full upload flow: multi-file, drag-drop, validation (type/size/empty/duplicate), Selected→Uploading→Processing→Ready simulation (a filename containing "fail" deterministically fails), review step, then submit.

**Credits.** `{totalCredits, usedCredits}`, remaining derived. Flat 1 credit per sent message, charged in `sendMessage` with a hard 0-guard. Low (≤50) and exhausted states; Lovable-style purchase modal with dev "Set remaining" controls.

**Design system.** Shared CSS recipes in `src/index.css` (`main-surface`, `content-card`, `glass-card`, `btn-dark/secondary/blue/toolbar`, `filter-pill`, `composer-shell`, etc.), ported from commas-ai-copilot. Visual consistency across surfaces is good.

---

### 3. Critical P0 Issues

| # | Problem | Why it matters | Current behavior | Recommended behavior | Files | Effort |
|---|---|---|---|---|---|---|
| P0-1 | **Investigation answers render literal `###` markdown** | The flagship demo moment displays raw markup. Instantly reads as broken. | Stub's `synthesizeDisputeInvestigation` joins lines with single `\n`; `liteMarkdown.tsx` only recognizes a `### ` heading when it is its own double-newline-separated block, so the whole answer becomes one `<p>` containing literal `### Situation summary` etc. | Fix in **both** places for robustness: (a) in `stubClient.ts`, join sections with `\n\n` (headings and bullet groups as separate blocks); (b) in `liteMarkdown.tsx`, additionally split blocks line-wise so a block containing a `### ` line renders it as a heading and renders `- ` runs as lists even when single-`\n` separated. | `server/llm/stubClient.ts` (`synthesizeDisputeInvestigation`), `src/lib/liteMarkdown.tsx` | S |
| P0-2 | **Backend transaction data contradicts the Dashboard and the seeded chat** | "Summarize my sales" → "Found 5 transactions totaling $2125.00." The seeded chat directly above says "$18,420 across 62 transactions"; the Dashboard says $18,420. Any exec will notice. | `mockCommasServer.ts` has exactly 5 transactions (one per dispute customer) that sum to $2,125. | Give `fanbasis_list_transactions` (no filter) a month-summary result shape and make the stub's sales-summary answer a proper narrative: "**$18,420** across 62 transactions this month — up 12%… Top seller **Pro Coaching Program** ($9,800)… 1 open dispute (#2481)." Keep per-customer filtered results as-is (those power the customer flows and are correct). Simplest: add a `summary` object (`totalCents: 1842000, count: 62, topProduct…`) to the unfiltered response and have the stub render it. | `server/mcp/mockCommasServer.ts`, `server/llm/stubClient.ts` (`finalize` for `fanbasis_list_transactions`) | S |
| P0-3 | **Non-Sarah dispute investigations self-contradict** | Investigating #2455 (David Kim, the *uncertain* case) says "The customer engaged with the product after purchase" — the opposite of the case's own story — and "Only Commas data was checked — no connected apps were available" directly above "Checked 5 sources". Verified live. | `synthesizeDisputeInvestigation` has a hardcoded Sarah-shaped recommendation and treats empty external results as "nothing was checked". External adapters only have Sarah data; for other customers CRM errors and Gmail/Fathom/Zoom return empty. | Ground the synthesis in the dispute record it already fetched: reuse the per-case `likelyReason` / `recommendedAction` / `uncertaintyNote` fields (already authored in `mockCommasServer.ts` for all 5 cases) for the Recommendation section. For empty external results say honestly: "- Gmail: no threads found with david.kim@email.com" etc. Never claim sources weren't checked when they were. | `server/llm/stubClient.ts` (`synthesizeDisputeInvestigation`) | M |
| P0-4 | **"Find information across my connected apps" (a visible global suggestion chip) triggers a Dispute #2481 investigation** | A global chip produces a dispute deep-dive the user never asked for, ending with "tell me to mark the response ready". Verified live. | `crossSourceStep` calls `fathom_search_calls` first; on the next loop iteration `inDisputeChain` sees that tool name (shared with `DISPUTE_CHAIN`) and hijacks the run into the #2481 chain. | Track which flow started the turn instead of inferring from shared tool names: e.g. keep the cross-source flow when the *first* tool call this turn came from `crossSourceStep` (check `toolHistory[0]`), or only enter the dispute chain when `commas_get_dispute` is among `calledNames`. Then give the cross-source finale a real synthesized answer (see P1-2). | `server/llm/stubClient.ts` (`nextStep` routing, `inDisputeChain` predicate) | S |
| P0-5 | **"Help me understand why revenue dropped this month" (Dashboard chip) returns a transaction count** | The Dashboard's own #1 suggestion produces a non-answer ("Found 5 transactions totaling $2125.00."). Verified live. | Prompt matches the generic `/revenue/` branch → unfiltered `fanbasis_list_transactions` → count/total finalize. | Add a dashboard-context branch (like the dispute-intent branch): match `/revenue.*drop|why.*revenue|revenue.*down/` when `context.kind === "dashboard"` → call `fanbasis_list_transactions` → answer with an authored structured breakdown ("### What changed — refunds up …, LAUNCH20 discount volume …, one $499 dispute withheld…") consistent with the Dashboard's numbers. The old client-side mockEngine had exactly this answer — port its copy. | `server/llm/stubClient.ts`, optionally `git show` history of deleted `src/lib/mockEngine.ts` for the copy | M |
| P0-6 | **Generic fallback text says "This preview only knows a handful of demo scenarios"** | One off-script prompt during a live demo surfaces a sentence that announces the product is fake. Verified live (and visible in the user's screenshot). | `stubClient.ts` returns this for any unmatched prompt; small-talk beyond hi/hello also lands here ("thanks, looks good" → fallback). | Reword to stay in character and be genuinely useful: "I can help with customers, transactions, disputes, and your connected apps. Try 'Summarize my sales' or open a dispute and ask me to investigate." Add a tiny acknowledgment branch for thanks/ok/great ("Anytime — anything else on this dispute?" when in dispute context). Never say "preview", "demo", or "scenarios". | `server/llm/stubClient.ts` (fallback + greeting branches) | S |
| P0-7 | **"Help me respond to a customer" chip answers with one customer's name and nothing else** | A visible global chip produces "**Sarah Johnson** — sarah.johnson@email.com." — looks broken. Verified live. | `/respond|reply/` branch lists customers, `finalize` prints only the first. | Have the branch ask a clarifying question with the top customers listed ("Who are you responding to? Recent conversations: Sarah Johnson, Marcus Webb…") — a clarifying question reads as intelligence, and the follow-up "Sarah" already routes correctly through the existing customer-lookup branch. | `server/llm/stubClient.ts` | S |
| P0-8 | **"Checked N sources" contradiction inside one message** | Trust-destroying when an answer disagrees with its own tool receipt. | See P0-3 — "no connected apps were available" + "Checked 5 sources". | Covered by P0-3's honest empty-result lines; additionally the ToolSummary should mark empty-result lookups `ok: true` (they are) — no change needed there once the prose stops lying. | `server/llm/stubClient.ts` | — (part of P0-3) |

---

### 4. P1 Improvements

| # | Problem | Why it matters | Current behavior | Recommended behavior | Files | Effort |
|---|---|---|---|---|---|---|
| P1-1 | **Dispute AI panel keeps showing a dispute chat after navigating to Dashboard** | Context chip says "Dispute #2481" while the user looks at the Dashboard — feels stale/buggy. Verified live. | `App.tsx` only closes the panel when entering the Chat view; navigating Dashboard↔RC keeps the old binding. | On sidebar navigation to a different view, close the panel (`setPanelOpen(false)`) — cheapest and most predictable. (Alternative — rebinding the panel to the new page's context — is more "live" but riskier; not needed for the demo.) | `src/App.tsx` (`onNavigate`) | S |
| P1-2 | **Cross-apps flow finale is a stub sentence** | After P0-4's fix, "I checked 4 connected apps. Ask me about a specific customer…" is still weak for a headline capability. | `crossSourceStep` finale counts tools. | Synthesize per-source one-liners from actual results (Fathom: 2 recorded calls · Zoom: 2 meetings · Calendar: N upcoming sessions · CRM: 1 active client) in the `###` block style. All data exists in the adapters. | `server/llm/stubClient.ts` (`crossSourceStep`) | M |
| P1-3 | **RC-list floating button reopens whatever chat the panel last showed** | On the Resolution Center list, the floating AI button can resurface a Dashboard or dispute conversation with its stale context chip. Verified live. | `openPanel(undefined)` reuses `panelChatId`. | When `context` is undefined and the previous panel chat has a context, create/reuse a general (no-context) chat instead of reusing the stale contextual one. | `src/App.tsx` (`openPanel`) | S |
| P1-4 | **Backend-down error message tells the user to run `npm run dev:server`** | Developer text in a product surface; fatal if the backend hiccups mid-demo. | `useChatStore.tsx` network-failure fallback: "Couldn't reach the agent — check that the backend is running (npm run dev:server)." | "The AI agent is temporarily unreachable. Check your connection and try again." Keep the dev hint in a `console.warn` only. | `src/hooks/useChatStore.tsx` (2 places), `tests/ChatFlow.test.tsx` assertion | S |
| P1-5 | **Suggestion chips silently do nothing at 0 credits** | Chips look clickable; clicking gives zero feedback (the `sendMessage` 0-credit guard returns silently). | `EmptyState` chips call `sendMessage` directly; only the composer shows the exhausted state. | Disable chips (opacity + `cursor-not-allowed`) when remaining ≤ 0; the composer's existing exhausted message already explains why. | `src/components/chat/SuggestedCapabilities.tsx`, `EmptyState.tsx` (pass a `disabled` prop from credits) | S |
| P1-6 | **Suggestion chips can start a second run while another chat is mid-run** | Clicking a chip in a fresh chat while another chat is running clears the first run's timers, stranding that chat in "running" with no reply. | `sendMessage` has no busy-guard; only the composer's disabled state prevents this, and chips bypass the composer. | Add `if (runChatId !== null && runChatId !== chatId) return;` at the top of `sendMessage` (mirrors the composer rule), or disable chips whenever `runChatId !== null`. | `src/hooks/useChatStore.tsx` | S |
| P1-7 | **Elena Cruz (#2417) shows "6 of 6 items added" with zero inspectable evidence** | The "evidence ready" showcase case has all-green badges but nothing to look at, right after Priya's case shows rich itemized evidence — inconsistent within one product. | Only Priya (#2390) has `seedEvidenceItems`; Elena has badges via `initialEvidenceAdded` only. | Author 3–4 `seedEvidenceItems` for #2417 (duplicate-charge story: two transaction receipts seconds apart, checkout log, support thread) with 1–2 mock attachments, same pattern as Priya's. Optionally 1 item for David (#2455, transaction receipt only — fits his sparse story). | `src/lib/disputeData.ts` | M |
| P1-8 | **Reload mid-run strands a user message with no reply and no error** | After refresh during a run, the chat shows the user's question, nothing else — looks like the AI ignored them. | `chat.status: "running"` is persisted but nothing reconciles it on load; run state is in-memory only. | On store hydration, for any chat with `status === "running"`, set status `idle` and append a quiet assistant line: "This response was interrupted — ask again and I'll pick it up." | `src/hooks/useChatStore.tsx` (`loadPersisted` or a mount effect) | S |
| P1-9 | **"Investigate this dispute" / "Review customer communications" chips route into the generic (Sarah-flavored) chain for every dispute** | Even after P0-3's honesty fix, these chips deserve per-case answers as good as the other five intents. | `detectDisputeIntent` doesn't match them; they fall into the investigation chain. | Add intents: `investigate` → run the (fixed) multi-source chain — acceptable once P0-3 lands; `communications` (`/communication|email|correspond/`) → call `gmail_search_threads` + answer from per-case authored copy (add a `communicationsSummary` field per dispute in `mockCommasServer.ts`, ~3 sentences each). | `server/llm/stubClient.ts`, `server/mcp/mockCommasServer.ts` | M |
| P1-10 | **"Mark the response ready" write action doesn't change anything visible** | The showpiece approve/decline flow ends with "Done — I've marked the dispute response as ready" and the dispute page shows nothing different. | The write tool flips an in-memory backend flag no UI reads. | Cheapest believable close: after an approved `commas_mark_dispute_response_ready`, surface it in the dispute page — e.g. the response card header gains a small "Marked ready by AI" success `Badge`. Requires the frontend to know: simplest is a per-dispute flag in `App.tsx` state set when the approval resolves for that dispute id (`useChatStore` can expose the last approved tool + input). | `src/hooks/useChatStore.tsx` (expose approval result), `src/App.tsx`, `src/components/resolution/DisputeDetail.tsx` | M |
| P1-11 | **Dispute chat opened "in full Chat view" has no history entry** | Via the panel's expand button, a dispute conversation renders in the Chat page but the left history list neither shows nor highlights it; clicking any other chat loses it with no way back except the dispute page. | `ChatHistoryList` filters `!c.context`. | Show context chats in history under their own group ("Disputes") with the gavel icon, or (cheaper) show the active chat's row even when it has context (extend the existing `c.id === activeChatId` escape hatch to context chats). | `src/components/chat/ChatHistoryList.tsx` | S |

---

### 5. P2 Improvements

| # | Problem | Recommended behavior | Files | Effort |
|---|---|---|---|---|
| P2-1 | Dashboard D/W/M/Y toggle changes selection but not the chart | Ship 4 small authored point-arrays and swap on toggle; headline number can stay. | `src/components/dashboard/RevenueModule.tsx` | S |
| P2-2 | Announcements arrows/dots are dead | 2–3 authored slides cycled by the existing arrows/dots. | `AnnouncementsModule.tsx` | S |
| P2-3 | RC list search input does nothing | Filter the 5 rows client-side on customer name — trivial and demo-plausible. | `ResolutionCenter.tsx` | S |
| P2-4 | Dispute context (`PageContext.dispute.evidenceStatus`) goes stale after the user adds evidence in-session | Rebuild context from live `evidenceByDispute` when opening the panel; low payoff since the agent barely uses the field — do only if touching `buildDisputeContext` anyway. | `src/lib/mockData.ts`, `src/App.tsx` | S |
| P2-5 | The agent can't reference uploaded evidence ("attach evidence" prompt → fallback; visible in user screenshot) | Append a one-line evidence inventory to the dispute system-prompt context (titles + file counts from `evidenceByDispute`, passed via a new optional `PageContext` field), and an `evidence`-intent answer that lists them. Keeps everything mocked; closes the loop between the upload feature and the agent story. | `src/lib/mockData.ts`, `server/types.ts`, `server/agent/runtime.ts` (`buildSystemPrompt`), `stubClient.ts` | M |
| P2-6 | Composer placeholder is "Ask about your business…" even in a dispute chat | "Ask about this dispute…" when `chat.context?.kind === "dispute"`. | `ChatWorkspace.tsx` → `ChatComposer` prop | S |
| P2-7 | Right-panel width (380px) makes structured investigation answers cramped | Bump to ~420px and/or reduce `###` heading top-margins inside the panel. Visual-only. | `RightPanel.tsx`, `index.css` | S |
| P2-8 | Chat history has no relative timestamps on rows | Add "2h ago"-style subtitle under titles (data already exists: `updatedAt`). | `ChatHistoryList.tsx` | S |
| P2-9 | Connected-apps modal lacks any "why connect this" payoff moment | After connecting Gmail/CRM live in a demo, the dispute investigation instantly includes them (already true!). Add one line in the modal after connect: "Gmail will now be used in AI investigations." | `ConnectedAppsModal.tsx` | S |
| P2-10 | Seeded localStorage staleness: returning browsers keep old seed chats/copy after data fixes | Bump `STORAGE_KEY` to `commas-ai-agent:v2` in the same PR as P0-2's data fix so every demo machine gets coherent data. | `useChatStore.tsx` | S |
| P2-11 | Approval card shows for write tools but there's no per-message record after approval | The post-approval steps/toolSummary already render; optionally prepend "✓ Approved" line. Cosmetic. | `ChatMessageList.tsx` | S |

---

### 6. P3 / Do Not Build

- **Real OAuth, real MCP remote connections, real Anthropic calls** — architecture is already swappable via env vars; wiring keys is an ops task, not a prototype task.
- **URL routing / deep links** — reload-to-Dashboard is acceptable; adding a router risks regressing panel/nav state for zero demo value.
- **Connector auth-expiry / conflicting-data / partial-failure simulations** — the connector story is credible without them; each adds stub complexity and demo surface area that can go wrong. (A single "no results found in Gmail" honest line — P0-3 — covers the "connector returns nothing" case.)
- **Backend persistence (JSON store), SSE streaming, message virtualization, mobile layouts** — real engineering with no exec-demo payoff; documented already as future work.
- **Editing/regenerating messages, multi-tab sync, chat rename/search** — mature-product features far past the believability bar needed here.
- **Removing the hidden `all roads lead to` test phrase or the filename-"fail" upload trigger** — they're deliberate, invisible test hooks; just keep them out of the demo script.
- **"Under review / Lost / expired" dispute cases** — the 5 existing cases cover the demo arc; 2 more statuses each need list rows, detail states, and stub answers. Only build if a specific demo beat needs them.

---

### 7. UX Edge Case Matrix

✓ = handled well · ~ = partially/weak · ✗ = missing/broken · n/a = not applicable

| Area / state | Loading | Empty | Error | Success | Disabled | Notes |
|---|---|---|---|---|---|---|
| Chat send/run | ✓ ("Thinking…" + stepped progress) | ✓ (rich empty states) | ~ (clean message, but dev-facing text — P1-4) | ✓ | ✓ composer / ✗ chips (P1-5/6) | Stop/cancel works, aborts fetch |
| Chat history | n/a | ✓ ("No chats yet.") | n/a | ✓ | n/a | No timestamps (P2-8); context chats invisible (P1-11) |
| Chat delete | n/a | ✓ auto-creates next | n/a | ✓ instant | n/a | Mid-run delete cleans run state ✓ |
| Reload persistence | n/a | n/a | ✗ mid-run orphan (P1-8) | ✓ | n/a | Old credit-shape migration handled ✓ |
| Dispute AI context | ✓ | ✓ (summary header + 7 chips) | ~ (Sarah-only chain — P0-3) | ✓ | n/a | Stale across nav (P1-1, P1-3) |
| Evidence upload | ✓ (4-state pipeline) | ✓ | ✓ (typed, per-file, retry) | ✓ (toast + list) | ✓ (button gating) | Excellent — strongest flow in the app |
| Evidence, resolved dispute | n/a | n/a | n/a | ✓ read-only record | ✓ (no Add/AI buttons) | ✓ attachments clickable w/ preview |
| Credits | n/a | n/a | ✓ exhausted state | ✓ purchase + toast | ✓ composer | Chips gap (P1-5); consistent across surfaces ✓ |
| Connectors (SourcesMenu) | n/a | n/a | n/a | ✓ counts, checkmarks | ✓ "Not connected" rows | Clear; per-chat scoping works and affects agent ✓ |
| Connectors (modal) | ✓ ("Connecting…" spinner) | n/a | ✗ (no failure state — accept, P3) | ✓ | ✓ (primary can't disconnect) | |
| Approval flow | ✓ | n/a | ✓ decline path proven | ✓ | n/a | No page-visible effect (P1-10) |
| Dashboard | n/a | ✓ (2 production-style empty cards) | n/a | ✓ | ~ dead controls (P2-1/2, toolbar) | Numbers contradict backend (P0-2) |
| RC list | n/a | ✓ per-tab empties | n/a | ✓ | ~ search/Export dead (P2-3) | Filter popovers open but don't filter (accepted) |
| Navigation | n/a | n/a | n/a | ✓ | ~ Billing/Growth/Wallet + TopNav icons dead | Dead nav is non-clickable (cursor-default) — acceptable |

---

### 8. State Consistency Audit

**Sound (verified):**
- One `chats` array behind every surface; deletion propagates everywhere including dispute panels (tested live + `tests/DisputeChatSession.test.tsx`).
- One credit state; composer, pill, chips-guard (logic level), and purchase modal all derive from it; can't go negative; purchases never reset usage.
- Per-chat `enabledSources` genuinely gate the backend tool registry — toggling a source off changes what the agent can call, and the answer's "Missing information" section reflects it.
- Resolved-dispute read-only state is derived from one `status` field via one `isResolved` predicate.
- localStorage hydration validates shape and migrates the old credit format.

**Breaks / risks (all verified):**
1. **Numbers disagree across surfaces** — Dashboard ($18,420/62 txns/1 dispute) vs backend mock (5 txns/$2,125/4 open disputes) vs seed chat copy ($18,420/62). Also: Dashboard says "1 open dispute"; RC shows 4 needing response. → P0-2 fixes the loudest instance; align the Dashboard "Disputed payments/Dispute activity" cards with 4-open-disputes-totaling-$1,776 or (cheaper) have the stub's dispute-analysis answer say 4.
2. **Panel binding survives navigation** (P1-1, P1-3) — the one place the UI presents stale context as current.
3. **`chat.status` persisted but unreconciled after reload** (P1-8).
4. **Write-action effect invisible to the page it concerns** (P1-10).
5. **Session-only evidence vs persisted chats** — chats survive reload, added evidence doesn't; an AI reply referencing just-added evidence would outlive the evidence itself. Acceptable if unmentioned in demos; noted for awareness.
6. **Seeded chats live in localStorage forever** — copy fixes to `SEED_CHATS` won't reach previously-used browsers (P2-10's key bump).

---

### 9. AI UX Audit

**What already feels mature:** stepped tool-progress lines with source icons (reads like Claude Desktop tool use); collapsed "Checked N sources" receipts; approval cards for writes; context chips; per-surface suggestion sets; visible source scoping in the composer; graceful stop/cancel.

**Gaps, in priority order:**
1. **Answer quality is the product.** Every P0 above is an AI-answer defect, not a UI defect. The UI chrome successfully promises intelligence; five prompts fail to deliver it. Fix the stub before touching any panel pixel.
2. **Context should never be silently wrong** — stale panel context across navigation (P1-1/P1-3) breaks the "it knows where I am" illusion, which is the core of the contextual-AI pitch.
3. **Every visible chip must have an authored, excellent answer.** Rule for this prototype: no suggestion chip ships unless its exact prompt produces a purpose-written response (audit table: global 5 — 2 broken, 1 weak; dashboard 4 — 1 broken, rest reuse global; dispute 7 — 5 excellent, 2 fall into the generic chain).
4. **Off-script prompts should degrade with grace, not confession** (P0-6). A capability statement + redirect keeps the demo alive; small-talk acknowledgment costs 5 lines.
5. **Dispute chips should adapt to case state** (polish, post-P0): a resolved case can't be reached (button removed ✓); an evidence-ready case could lead with "Draft my response"; a missing-evidence case with "Find missing evidence". Cheap: reorder `DISPUTE_SUGGESTED_CAPABILITIES` per `evidenceStatus`. P2.

---

### 10. Resolution Center Audit

**The workflow demos genuinely well end-to-end:** list (5 differentiated rows, real tabs) → detail (per-case evidence checklist state) → Investigate with AI (context header, per-case intents) → What evidence do I need? (case-specific gaps) → Add evidence (best flow in the app: upload/validate/review/submit → toast → checklist updates → attachment counts) → Draft my response (case-specific drafts, incl. honest refusal for Marcus and hedged draft for David) → mark ready (approval card) → and #2390 as a complete read-only historical record with inspectable attachments and a submitted response.

**Would the CPO believe it?** Yes for #2481, #2502, #2390. **No for #2455/#2417 investigations** until P0-3 lands, and the P1-10 "mark ready" dead-end blunts the ending.

**Specific findings beyond the P-tables:**
- The "(ask the AI to draft this for you)" placeholder in the response textarea is a nice hook — but pasting the AI's draft is manual. A "Use AI draft" affordance is tempting but adds cross-surface plumbing; **recommend against** for this pass (the demo beat "copy the draft the AI wrote" works fine verbally). P3.
- Submit response is permanently disabled with a tooltip ("Submission is simulated") — honest and fine; keep.
- Evidence-due urgency ("Due tomorrow" red label) is static text; correct for all 5 authored dates. Fine.
- `#2417`'s six green badges with no items is the only hollow spot in the lifecycle story (P1-7).

---

### 11. Connector UX Audit

**Current state is genuinely good:** the Sources menu (Notion-style) clearly shows per-chat scoping with counts, connected vs "Not connected" rows, and a Manage entry; the Connected-apps modal shows all 6 with descriptions, Connect/Disconnect, a connecting spinner, and a protected primary (Commas). Crucially — and unusually for a prototype — **scoping is real**: disabling Fathom genuinely removes its tools from the agent's registry and changes the answer.

**Per-connector reality check (all mock, as intended):**
| Connector | Tools | Data depth | Non-Sarah behavior |
|---|---|---|---|
| Commas | 5 (4 read + 1 write) | 5 customers/txns/disputes | Full |
| Fathom | 1 | 2 calls (Sarah) | Empty result |
| Zoom | 1 | 2 meetings (Sarah) | Empty result |
| Gmail | 1 | 1 thread (Sarah) | Empty result |
| CRM | 1 | 1 contact (Sarah) | **Error** ("not found") |
| Calendar | 1 | Sarah sessions | Empty result |

**Recommendations:**
1. (part of P0-3) Render empty external results as honest per-source lines, never "wasn't checked".
2. CRM's not-found should return `ok: true` with an empty contact list (like Gmail) rather than an error — errors imply the connector is broken. Small change in `crmAdapter.ts` + stub handling. **P1-tier, fold into P0-3's PR.**
3. Asking about a *disconnected* source ("check Gmail" while Gmail is off) currently gets whatever branch matches or the fallback. Add one stub line: if the prompt names a known-but-unavailable source, reply "Gmail isn't connected for this chat — enable it in Sources or connect it in Manage connected apps." **P1-tier, small.**
4. The live-connect demo beat (connect Gmail mid-demo → investigation now includes it) already works end-to-end; add P2-9's confirmation line to make it land.
5. Do **not** simulate auth expiry, rate limits, or conflicting sources (P3).

---

### 12. Demo Readiness

**Things that can break or embarrass a live demo, ranked:**
1. Literal `###` in the hero answer (P0-1) — guaranteed to appear in Demo 1.
2. Any off-script prompt → "This preview only knows…" (P0-6).
3. Numbers contradicting within one screen (P0-2) — guaranteed in Demo 2 if the seeded sales chat is visible.
4. Wrong-story recommendation on #2455 (P0-3) if the presenter picks the wrong dispute.
5. Global chips 4 and 5 (P0-4, P0-7).
6. Presenter navigates while the panel is open → stale context chip (P1-1).
7. Backend not running → npm-command error text (P1-4). *Pre-demo checklist: `curl localhost:8787/api/health`.*
8. Stale localStorage from a rehearsal → old seed copy, burned credits (P2-10; or DevTools → clear storage before going on).
9. Dead controls if the presenter wanders: TopNav icons, Export, search, D/W/M/Y (data), announcement arrows. *Mitigation: script the demo path; optionally P2-1/2/3.*
10. Typing a filename containing "fail" during the evidence demo triggers the intentional failure state — either avoid, or use it deliberately as the error-handling beat (it demos well!).

**Deterministic demo hygiene:** all AI behavior is keyword-routed and fully deterministic — rehearse with the exact prompts below and the demo cannot drift.

---

### 13. Recommended Demo Scenarios

All verified working today except where marked *(after P0s)*.

**DEMO 1 — "Investigate a dispute" (hero, ~4 min).** Resolution Center → tabs → open #2481 → note evidence empty, due tomorrow → **Investigate with AI** → context header appears (no copy-paste) → chip **"Why is this dispute open?"** (forgotten-purchase analysis from 14 logins) → **"What evidence do I need?"** (3 named gaps) → **"Investigate this dispute"** *(after P0-1/P0-3: multi-source chain with per-source progress lines, CRM+Gmail+Fathom+Zoom evidence, structured answer)* → **"Draft my response"** (full paragraph draft) → "mark the response ready" → **approval card** → Approve → confirmation *(P1-10 makes the page reflect it)*. Optional error beat: toggle Fathom off in Sources first, re-investigate → "Missing information: Fathom…".

**DEMO 2 — "The AI knows the state of every case" (~3 min).** Open #2502 (Marcus) → "What evidence do I need?" → names exactly what's missing, refuses to over-draft → **Add evidence** with 2 files → upload pipeline → review → submit → toast + checklist update → open #2455 (David) → "What should I do next?" → *the AI says it's uncertain and refuses to guess* (the most human moment in the product) → open #2390 (Priya, Won) → read-only record, click an attachment, submitted response. This demo needs no P0s — it works impressively today.

**DEMO 3 — "Global business intelligence" (~2 min).** Chat → New chat → "Summarize my sales" *(after P0-2: $18,420 narrative)* → "Look up customer sarah.johnson@email.com" → "What about her transactions?" (pronoun follow-up — multi-turn memory) → "Analyze my disputes" *(align copy with 4 open disputes per §8.1)*.

**DEMO 4 — "Connectors make it smarter" (~2 min).** Open dispute chat → Sources shows 4 → answer's "Missing information: CRM, Gmail" → **Manage connected apps** → Connect Gmail (spinner → connected) → enable in chat → re-investigate → Gmail evidence line now appears. Fully working today; P2-9 sweetens it.

**DEMO 5 — "Credits" (~1 min).** Point at pill → send message (300→299) → dev-tools set 0 → composer locks with Buy Credits → purchase +50 → 50/350, composer live. Fully working today.

---

### 14. Implementation Roadmap

**Phase 1 — Answer quality & rendering (P0-1…P0-8).**
Objective: no visible prompt path produces broken rendering, contradictions, or persona-breaking text.
Changes: `stubClient.ts` (synthesis grounding via per-case fields, routing fix for cross-apps, dashboard revenue branch, respond-to-customer clarifier, fallback/small-talk rewrite, sales-summary narrative), `mockCommasServer.ts` (transactions summary shape; optional `communicationsSummary` fields), `liteMarkdown.tsx` (line-wise heading/list handling), `crmAdapter.ts` (empty-not-error).
Dependencies: none. Effort: ~1 day.
Validation: extend `tests/server/disputeIntents.test.ts` + `runtime.test.ts` — assert #2455 investigation contains uncertainty language and no "engaged with the product"; assert cross-apps prompt never calls `commas_get_dispute`; assert sales answer contains "$18,420"; assert no answer ever contains "This preview only knows"; render-test that `###` never appears literally (`liteMarkdown` unit test on single-`\n` input). Re-run all 82 existing tests.

**Phase 2 — Context & state hygiene (P1-1, P1-3, P1-4, P1-5, P1-6, P1-8, P2-10).**
Objective: no surface ever displays stale context or dev text; no silent dead interactions.
Changes: `App.tsx` (close panel on nav; fresh generic chat for context-less floating opens), `useChatStore.tsx` (busy-guard in `sendMessage`; running-status reconciliation on hydrate; error copy; bump storage key), `SuggestedCapabilities.tsx`/`EmptyState.tsx` (disabled prop).
Dependencies: none (parallel to Phase 1). Effort: ~0.5 day.
Validation: live script — open dispute panel → navigate Home → panel closed; chip click at 0 credits does nothing *visibly disabled*; reload mid-run shows interruption notice; `ChatFlow.test.tsx` error-copy assertion updated.

**Phase 3 — Story completeness (P1-7, P1-9, P1-10, P1-11, connector items §11.2–3).**
Objective: every dispute case and the write action land as fully-told stories.
Changes: `disputeData.ts` (Elena + David seed evidence), `mockCommasServer.ts` + `stubClient.ts` (communications intent; disconnected-source reply), approval-effect surfacing (`useChatStore` → `App.tsx` → `DisputeDetail` badge), `ChatHistoryList.tsx` (show active context chat).
Dependencies: Phase 1 (stub structure). Effort: ~1 day.
Validation: per-case live walkthrough of all 7 chips on all 4 active disputes; approve mark-ready → badge visible on dispute page; expand-to-full-chat shows a highlighted row.

**Phase 4 — Demo polish (selected P2: 1, 2, 3, 6, 7, 8, 9).**
Objective: nothing the presenter can casually touch is dead.
Dependencies: none. Effort: ~0.5–1 day. Do only after Phases 1–3; skip under time pressure except P2-3 (search) and P2-6 (placeholder).
Validation: click-everything pass on Dashboard + RC list at 1440px; zero console errors.

**Explicitly out of scope (all phases):** everything in §6.

---

### 15. Final Sonnet Execution Prompt

> Copy everything between the lines into Claude Sonnet.

---

You are improving the **Commas AI Agent prototype** (repo: `commas-ai-agent` — Vite/React frontend in `src/`, Hono backend in `server/`, tests in `tests/`). Before writing any code, read `docs/active-context.md` in full, then `PRODUCT_READINESS_AUDIT.md` (this repo) — implement from the audit's roadmap, in phase order. Run the app (`npm run dev` + `npx tsx server/index.ts`) and verify live in a browser as you go; run `npx tsc -b`, `npm run lint`, and `npx vitest run` after each phase (82 tests must stay green, plus the new ones below).

**Hard rules:**
- Preserve the existing Commas AI Copilot design language exactly — reuse `content-card`, `btn-dark/secondary/blue`, existing tokens in `src/index.css`. No new visual system, no new dependencies, no redesigns.
- Do NOT build anything from the audit's §6 "Do Not Build" list: no real OAuth/MCP/LLM wiring, no router, no backend persistence, no SSE, no connector failure simulations, no new dispute statuses.
- All AI behavior stays deterministic, implemented in `server/llm/stubClient.ts` and mock data — never fabricate facts at answer time; every claim in an answer must trace to a mock-data field or tool result.
- The `AnthropicLlmClient` path, agent runtime, adapter architecture, and approval flow must not change structurally.

**Implement Phase 1 (P0-1 through P0-8) and Phase 2 (P1-1, P1-3, P1-4, P1-5, P1-6, P1-8, P2-10) completely.** Then implement Phase 3 (P1-7, P1-9, P1-10, P1-11, plus the CRM empty-not-error and disconnected-source-reply items from audit §11). Skip Phase 4 unless everything else is done, verified live, and green. Follow each item's "Recommended behavior" column precisely; the audit's file references tell you where.

**Required new test coverage** (extend existing suites, don't rewrite them): (1) `liteMarkdown` renders `### ` headings and `- ` lists correctly from single-newline text — no literal `###` ever; (2) investigating dispute #2455 yields uncertainty language and never "engaged with the product after purchase"; (3) "Find information across my connected apps" in a global chat never calls `commas_get_dispute`; (4) "Summarize my sales" contains "$18,420"; (5) no stub answer ever contains "This preview only knows"; (6) `sendMessage` refuses to start a run while another chat's run is active; (7) reload with a `running`-status chat reconciles to `idle` with an interruption notice.

**Definition of done:** all five demo scenarios in audit §13 work exactly as written, verified live with screenshots; zero console errors; typecheck/lint/tests clean; `docs/active-context.md` updated with what changed, what was deliberately skipped, and remaining limitations. Commit in phase-sized commits with descriptive messages.

---

*End of audit.*
