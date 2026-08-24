import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type {
  Chat,
  ChatMessage,
  CreditsState,
  PageContext,
  PendingApproval,
  ProgressStep,
  RunPhase,
  SourceId,
  SourceInfo,
} from "../lib/types";
import {
  CREDIT_COSTS,
  creditCostForDisputeTurn,
  DEFAULT_ENABLED_SOURCES,
  INITIAL_CREDITS,
  isThirdPartyEvidenceSource,
  SEED_CHATS,
  sourceIdFromLabel,
  SOURCES,
} from "../lib/mockData";
import { DISPUTES, disputesNeedingAttention, type AIEvidenceItem, type EvidenceFileMeta, type EvidenceSourceType } from "../lib/disputeData";
import {
  runAgentTurn,
  approveAgentAction,
  streamAgentMessage,
  AgentStreamError,
  type AgentRunPlan,
  type ConversationTurn,
} from "../lib/agentApi";

/**
 * Shared chat state. `sendMessage` routes to one of two backends depending on the chat's
 * context, per the shared-agent architecture (docs/AI_ASSISTANT_ARCHITECTURE.md):
 *
 * - **Dispute-context chats** (Resolution Center) → the legacy `POST /api/agent/run` /
 *   `runAgentTurn` path, byte-for-byte unchanged from before this phase — real tool calls, the
 *   write-approval pause, and the client-side step-reveal timers in `applyPlan` below.
 * - **Everything else** (context-less "global" chats and dashboard-context chats) → the new
 *   shared agent runtime's streaming endpoint, `POST /api/agent/stream` / `streamAgentMessage`,
 *   which appends real incremental text to the assistant message as it arrives (see the
 *   `ensureStreamingMessage`/`appendStreamDelta`/`finalizeStreamedMessage` helpers below) instead
 *   of replaying a pre-computed plan on timers.
 *
 * Chat/sources/credits are persisted to localStorage (see loadPersisted/persist below) so a
 * conversation survives a reload; there is still no backend-side store for the legacy path
 * (ARCHITECTURE.md §10's JSON-snapshot design remains a documented future option) — the shared
 * agent runtime's own session memory (server/agent/sessions/) lives in the backend process only,
 * for now.
 */

const STEP_INTERVAL_MS = 650;
/**
 * Credit consumption rule (docs/AI_ASSISTANT_IMPLEMENTATION_STATUS.md's current phase; tunable
 * amounts live in `src/lib/mockData.ts`'s `CREDIT_COSTS`): one unified balance for global chat
 * AND dispute investigations — never separate balances — charged once per completed turn,
 * AFTER the agent's work finishes successfully. Never charged: a technical failure (network
 * error, server-authored error), a cancelled/aborted run, or an approve/decline round-trip's
 * own intermediate pause (that's still the SAME turn as the message that triggered it, not a
 * second "message sent" event — see `applyPlan`). Opening a chat, switching conversations,
 * opening the AI panel, and viewing history never touch credits either. See `chargeCredits`
 * (dispute/legacy path, inside `applyPlan`) and the streaming path's own charge call in
 * `sendMessage` for the two places this actually fires — deliberately not a single shared
 * "charge in finalizeStreamedMessage" helper, since that function is also called on cancellation
 * and on error, where charging would be wrong.
 */
/** How many prior turns to send the agent for conversation memory — capped so a long chat's
 * payload doesn't grow unbounded (server/app.ts enforces the same cap defensively). */
const HISTORY_TURN_LIMIT = 20;
// v2: seed-data/copy fixes from PRODUCT_READINESS_AUDIT.md P0-2 (a v1 store would keep serving
// the old contradictory "62 transactions / 1 open dispute" seed chats forever — P2-10).
// v3: unified conversation model (docs/AI_ASSISTANT_IMPLEMENTATION_STATUS.md's current phase)
// added the required `type`/`disputeId` fields to `Chat` — bumping the key, same as v1→v2,
// rather than writing runtime normalization for a handful of prototype localStorage records.
// v4: persist case state (evidence/drafts/mark-ready) too (audit P1-5) — previously only
// `chats`/`sources`/`credits` survived a reload, so a chat message could claim "Added 1 evidence
// item" while the checklist it referred to had already reverted to empty.
const STORAGE_KEY = "commas-ai-agent:v4";

interface PersistedShape {
  chats: Chat[];
  sources: SourceInfo[];
  credits: CreditsState;
  evidenceByDispute: Record<string, AIEvidenceItem[]>;
  responseDraftByDispute: Record<string, string>;
  markedReadyDisputeIds: string[];
}

function isValidCreditsShape(c: unknown): c is CreditsState {
  return (
    typeof c === "object" &&
    c !== null &&
    typeof (c as CreditsState).totalCredits === "number" &&
    typeof (c as CreditsState).usedCredits === "number"
  );
}

/** A chat persisted mid-run has a user message the agent never answered (the page was
 * reloaded before the response landed). Reconcile it on load: back to idle, with a quiet
 * note so the conversation doesn't look ignored (PRODUCT_READINESS_AUDIT.md P1-8). */
function reconcileInterruptedRuns(chats: Chat[]): Chat[] {
  return chats.map((c) =>
    c.status === "running"
      ? {
          ...c,
          status: "idle" as const,
          messages: [
            ...c.messages,
            {
              id: newId("m"),
              role: "assistant" as const,
              text: "This response was interrupted — ask again and I'll pick it up.",
              ts: new Date().toISOString(),
            },
          ],
        }
      : c,
  );
}

function loadPersisted(): PersistedShape | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedShape>;
    if (!Array.isArray(parsed.chats)) return null;
    return {
      chats: reconcileInterruptedRuns(parsed.chats),
      sources: Array.isArray(parsed.sources) ? parsed.sources : SOURCES,
      // Falls back to a fresh 300/0 balance if localStorage still holds the old
      // {balance, startingBalance} shape from before the credit-system rebuild.
      credits: isValidCreditsShape(parsed.credits) ? parsed.credits : INITIAL_CREDITS,
      evidenceByDispute:
        parsed.evidenceByDispute && typeof parsed.evidenceByDispute === "object" ? parsed.evidenceByDispute : seedEvidenceByDispute(),
      responseDraftByDispute:
        parsed.responseDraftByDispute && typeof parsed.responseDraftByDispute === "object" ? parsed.responseDraftByDispute : {},
      markedReadyDisputeIds: Array.isArray(parsed.markedReadyDisputeIds) ? parsed.markedReadyDisputeIds : [],
    };
  } catch {
    return null;
  }
}

function remainingCredits(c: CreditsState) {
  return Math.max(0, c.totalCredits - c.usedCredits);
}

function persist(state: PersistedShape) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage full or unavailable (e.g. private browsing) — fine to lose persistence in a
    // prototype, not worth surfacing an error for.
  }
}

interface PendingApprovalState extends PendingApproval {
  chatId: string;
  prompt: string;
}

/** Session-lifetime, per-dispute evidence — seeded from each dispute's `seedEvidenceItems`
 * (e.g. Priya Nair's resolved case ships with its historical evidence already on file) so
 * resolved disputes read as real historical records. Lives here (not in App.tsx, where it
 * originally did) so BOTH the Resolution Center (DisputeDetail, still the only UI that renders
 * it) and the chat's proposed-action approval flow (resolveProposedAction below) can read/write
 * the exact same state — one source of truth, never duplicated into the chat. */
function seedEvidenceByDispute(): Record<string, AIEvidenceItem[]> {
  const initial: Record<string, AIEvidenceItem[]> = {};
  for (const d of DISPUTES) {
    if (d.seedEvidenceItems.length > 0) initial[d.id] = d.seedEvidenceItems;
  }
  return initial;
}

interface ChatStoreValue {
  chats: Chat[];
  sources: SourceInfo[];
  credits: CreditsState;
  runChatId: string | null;
  runPhase: RunPhase;
  runSteps: ProgressStep[];
  visibleStepIds: string[];
  pendingApproval: PendingApprovalState | null;
  createChat: (context?: PageContext) => string;
  deleteChat: (id: string) => void;
  sendMessage: (chatId: string, text: string) => void;
  cancelRun: () => void;
  approveWrite: () => void;
  declineWrite: () => void;
  toggleChatSource: (chatId: string, sourceId: SourceId) => void;
  connectSource: (sourceId: SourceId) => void;
  disconnectSource: (sourceId: SourceId) => void;
  /** Dispute ids whose "mark response ready" write action was approved and executed this
   * session — lets the dispute page reflect the agent's action instead of leaving the
   * approve flow with no visible effect (PRODUCT_READINESS_AUDIT.md P1-10). Session-only,
   * mirroring the backend's own in-memory flag. */
  markedReadyDisputeIds: string[];
  /** Evidence per dispute — the Resolution Center's own "Add evidence" flow and the chat's
   * `propose_add_evidence` approval flow both go through this one function/state; nothing
   * about a dispute's visible evidence lives anywhere else. */
  evidenceByDispute: Record<string, AIEvidenceItem[]>;
  addEvidenceItem: (disputeId: string, item: AIEvidenceItem) => void;
  /** Edits an existing evidence item — title, record, and its full attachment set — the
   * Evidence Detail modal's one Save action, available only while the dispute is still active
   * (the modal itself enforces that; this setter has no opinion on dispute status). Also the
   * only way a `proofRequired` item moves to `proofConfirmed`: that flips to true here whenever
   * the saved `files` list is non-empty (or the item never required proof to begin with) — there
   * is no separate "confirm" step, editing an item and saving IS confirming it. */
  updateEvidenceItem: (disputeId: string, itemId: string, patch: { title: string; record: string; files: EvidenceFileMeta[] }) => void;
  /** Permanently removes one evidence entry (and its attachments) from a dispute's checklist —
   * "Added" is never a locked state while the dispute is still active. Works identically for
   * AI-found, manual, Commas-native, and proof-confirmed third-party items; the category-level
   * "Added"/"Not added" badge and the "X of N" count are pure derivations from `evidenceItems`,
   * so removing the last item in a category reverts it automatically, no separate bookkeeping. */
  removeEvidenceItem: (disputeId: string, itemId: string) => void;
  /** The seller's editable response draft per dispute — previously local, ephemeral state
   * inside DisputeDetail; lifted here so the chat's `propose_draft_response` approval flow can
   * set it too, and so it survives navigating away from and back to the dispute detail page. */
  responseDraftByDispute: Record<string, string>;
  setResponseDraft: (disputeId: string, text: string) => void;
  /** Approves or declines one proposed action attached to a specific chat message
   * (docs/AI_ASSISTANT_ARCHITECTURE.md §7). Approving is the ONLY code path that turns a
   * proposal into a real case-state change — see server/agent/actions/index.ts's doc comment. */
  resolveProposedAction: (
    chatId: string,
    messageId: string,
    actionId: string,
    decision: "approve" | "decline",
    selectedIndices?: number[],
  ) => void;
  /** Mock purchase — increases totalCredits only, never touches usedCredits (see
   * CreditsState's doc comment for why that's what makes the "271/300 → +50 → 321/350"
   * edge case work correctly). */
  addCredits: (amount: number) => void;
  /** Dev/demo-only: jump straight to a given remaining balance without sending N messages.
   * Not surfaced as a normal user-facing action — see AddCreditsModal's "Demo tools" footer. */
  setRemainingCreditsForDemo: (remaining: number) => void;
  /** Dev/demo-only: wipes every write action taken during this session — chats, credits
   * spent, sources connected/disconnected, mark-ready flags, evidence added, response
   * drafts — back to the seed defaults. See AddCreditsModal's "Demo tools" footer. */
  resetDemo: () => void;
}

const ChatStoreContext = createContext<ChatStoreValue | null>(null);

function newId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function chatTitleFrom(text: string) {
  const trimmed = text.trim();
  return trimmed.length > 60 ? `${trimmed.slice(0, 57)}…` : trimmed;
}

function historyFor(chat: Chat): ConversationTurn[] {
  return chat.messages.slice(-HISTORY_TURN_LIMIT).map((m) => ({ role: m.role, text: m.text }));
}

export function ChatStoreProvider({ children }: { children: ReactNode }) {
  const initial = useRef(loadPersisted()).current;
  const [chats, setChats] = useState<Chat[]>(initial?.chats ?? SEED_CHATS);
  const [sources, setSources] = useState<SourceInfo[]>(initial?.sources ?? SOURCES);
  const [credits, setCredits] = useState<CreditsState>(initial?.credits ?? INITIAL_CREDITS);
  const [runChatId, setRunChatId] = useState<string | null>(null);
  const [runPhase, setRunPhase] = useState<RunPhase>("idle");
  const [runSteps, setRunSteps] = useState<ProgressStep[]>([]);
  const [visibleStepIds, setVisibleStepIds] = useState<string[]>([]);
  const [pendingApproval, setPendingApproval] = useState<PendingApprovalState | null>(null);
  const [markedReadyDisputeIds, setMarkedReadyDisputeIds] = useState<string[]>(initial?.markedReadyDisputeIds ?? []);
  const [evidenceByDispute, setEvidenceByDispute] = useState<Record<string, AIEvidenceItem[]>>(
    initial?.evidenceByDispute ?? seedEvidenceByDispute,
  );
  const [responseDraftByDispute, setResponseDraftByDispute] = useState<Record<string, string>>(
    initial?.responseDraftByDispute ?? {},
  );

  const cancelledRef = useRef(false);
  const timersRef = useRef<number[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const lastPromptRef = useRef("");
  // Mirrors `chats` for synchronous reads in createChat() — see that function's comment for
  // why reading a value set inside a setChats() updater isn't safe to do immediately after.
  const chatsRef = useRef<Chat[]>(chats);
  chatsRef.current = chats;

  useEffect(() => {
    persist({ chats, sources, credits, evidenceByDispute, responseDraftByDispute, markedReadyDisputeIds });
  }, [chats, sources, credits, evidenceByDispute, responseDraftByDispute, markedReadyDisputeIds]);

  const clearTimers = useCallback(() => {
    timersRef.current.forEach((t) => window.clearTimeout(t));
    timersRef.current = [];
  }, []);

  const setChatStatus = useCallback((chatId: string, status: Chat["status"]) => {
    setChats((prev) => prev.map((c) => (c.id === chatId ? { ...c, status } : c)));
  }, []);

  /** The only place `usedCredits` is ever incremented — clamped so it can never exceed
   * `totalCredits` (the balance floors at 0, never goes negative, even if a turn's real cost
   * exceeds what was left when it started — there's no way to know the cost until the work is
   * actually done, see `CREDIT_COSTS`). */
  const chargeCredits = useCallback((cost: number) => {
    setCredits((prev) => ({ ...prev, usedCredits: Math.min(prev.totalCredits, prev.usedCredits + cost) }));
  }, []);

  const createChat = useCallback((context?: PageContext) => {
    // Reuse an already-empty chat with the same context signature instead of spawning a new
    // one — repeated "New chat" clicks (or repeated panel opens) used to pile up empty rows in
    // history. Computed with plain synchronous JS against chatsRef.current, then applied via a
    // single setChats call — NOT by mutating a variable inside the setChats updater and reading
    // it right after, which is unreliable (React doesn't guarantee that updater runs before the
    // next line executes; this was a real bug: caller code that used the returned id
    // immediately — e.g. RightPanel binding to it — sometimes got "" because the updater hadn't
    // run yet, same class of bug fixed in src/lib/evidenceUpload.ts's addFiles()).
    const matchesContext = (c: Chat) => (context ? c.context?.kind === context.kind && c.context?.id === context.id : !c.context);
    const existing = chatsRef.current.find((c) => c.messages.length === 0 && matchesContext(c));
    if (existing) return existing.id;

    const id = newId("chat");
    const ts = new Date().toISOString();
    const chat: Chat = {
      id,
      title: context ? context.label : "New chat",
      type: context?.kind === "dispute" ? "dispute" : "global",
      createdAt: ts,
      updatedAt: ts,
      status: "idle",
      enabledSources: [...DEFAULT_ENABLED_SOURCES],
      context,
      disputeId: context?.kind === "dispute" ? context.id : undefined,
      messages: [],
    };
    setChats((prev) => [chat, ...prev]);
    return id;
  }, []);

  const deleteChat = useCallback(
    (id: string) => {
      setChats((prev) => prev.filter((c) => c.id !== id));
      if (runChatId === id) {
        // Mirrors cancelRun: without marking this cancelled and aborting the in-flight request,
        // the orphaned promise's completion later fires unconditionally and clobbers whatever
        // *new* run may have started in the meantime (sendMessage's own cancelledRef checks are
        // what prevent that — they only work if this actually sets the flag first).
        cancelledRef.current = true;
        abortRef.current?.abort();
        clearTimers();
        setRunChatId(null);
        setRunPhase("idle");
        setRunSteps([]);
        setVisibleStepIds([]);
        setPendingApproval(null);
      }
    },
    [runChatId, clearTimers],
  );

  const cancelRun = useCallback(() => {
    cancelledRef.current = true;
    clearTimers();
    abortRef.current?.abort();
    const chatId = runChatId;
    setRunPhase("cancelled");
    setPendingApproval(null);
    if (chatId) {
      setChatStatus(chatId, "idle");
      setChats((prev) =>
        prev.map((c) =>
          c.id === chatId
            ? {
                ...c,
                messages: [
                  ...c.messages,
                  { id: newId("m"), role: "assistant", text: "Stopped by you.", ts: new Date().toISOString() },
                ],
              }
            : c,
        ),
      );
    }
    window.setTimeout(() => {
      setRunChatId(null);
      setRunPhase("idle");
      setRunSteps([]);
      setVisibleStepIds([]);
    }, 300);
  }, [runChatId, clearTimers, setChatStatus]);

  /** Shared handling for both a fresh agent run and an approve/decline continuation: animate
   * any steps the backend already executed, then either finalize with an answer/error, or pause
   * on a new pendingApproval. Credits are charged HERE, exactly once, only on the branch that
   * actually finalizes with a non-error answer — never on the pendingApproval pause (that isn't
   * "work finished" yet; the SAME turn's later approve/decline call re-enters this function and
   * charges then, once it truly finishes), and never on `plan.error` (a technical failure).
   * `cancelledRef` gates the whole callback, so an aborted run never reaches the charge either. */
  const applyPlan = useCallback(
    (chatId: string, plan: AgentRunPlan) => {
      if (cancelledRef.current) return;
      setRunSteps(plan.steps);
      setVisibleStepIds([]);

      plan.steps.forEach((s, i) => {
        const t = window.setTimeout(
          () => {
            if (cancelledRef.current) return;
            setVisibleStepIds((prev) => [...prev, s.id]);
          },
          (i + 1) * STEP_INTERVAL_MS,
        );
        timersRef.current.push(t);
      });

      const finalDelay = (plan.steps.length + 1) * STEP_INTERVAL_MS;
      const finalTimer = window.setTimeout(() => {
        if (cancelledRef.current) return;

        if (plan.pendingApproval) {
          setPendingApproval({
            ...plan.pendingApproval,
            chatId,
            prompt: lastPromptRef.current,
          });
          setRunPhase("awaiting_approval");
          return;
        }

        // A turn whose only tool activity was the human declining a write action isn't
        // billable work — nothing was investigated or accomplished (audit P2-1).
        const wasPureDecline = plan.toolSummary.length > 0 && plan.toolSummary.every((t) => t.declined);
        if (!plan.error && !wasPureDecline) {
          chargeCredits(creditCostForDisputeTurn(plan));
        }

        const answerText = plan.error ? `I ran into a problem: ${plan.error.message}` : plan.answer;
        const assistantMessage: ChatMessage = {
          id: newId("m"),
          role: "assistant",
          text: answerText,
          ts: new Date().toISOString(),
          toolSummary: plan.toolSummary.length > 0 ? plan.toolSummary : undefined,
          proposedActions: plan.proposedActions && plan.proposedActions.length > 0 ? plan.proposedActions : undefined,
          investigationReport: plan.investigationReport,
        };
        setChats((prev) =>
          prev.map((c) =>
            c.id === chatId
              ? { ...c, messages: [...c.messages, assistantMessage], updatedAt: new Date().toISOString() }
              : c,
          ),
        );
        setChatStatus(chatId, plan.error ? "error" : "idle");
        setRunPhase("done");
        window.setTimeout(() => {
          setRunChatId(null);
          setRunPhase("idle");
          setRunSteps([]);
          setVisibleStepIds([]);
        }, 250);
      }, finalDelay);
      timersRef.current.push(finalTimer);
    },
    [setChatStatus, chargeCredits],
  );

  /** Appends a new, empty, `streaming: true` assistant message — the placeholder that
   * `appendStreamDelta` grows in place as real text arrives. Used only by the shared-agent
   * streaming path (global/dashboard chats); the legacy dispute-chat path never calls this. */
  const ensureStreamingMessage = useCallback((chatId: string, messageId: string) => {
    setChats((prev) =>
      prev.map((c) =>
        c.id === chatId
          ? {
              ...c,
              messages: [...c.messages, { id: messageId, role: "assistant", text: "", ts: new Date().toISOString(), streaming: true }],
            }
          : c,
      ),
    );
  }, []);

  const appendStreamDelta = useCallback((chatId: string, messageId: string, delta: string) => {
    setChats((prev) =>
      prev.map((c) =>
        c.id === chatId
          ? { ...c, messages: c.messages.map((m) => (m.id === messageId ? { ...m, text: m.text + delta } : m)) }
          : c,
      ),
    );
  }, []);

  /** Marks the streamed message settled (`streaming: false`) and sets the chat's final status.
   * `errorText`, when given, only replaces the message's text if nothing streamed in before the
   * failure — a reply that streamed most of the way and then failed keeps what genuinely arrived,
   * rather than discarding real output for a generic error line. If the message ends up with no
   * text at all and no error (e.g. cancelled before the first delta arrived), the placeholder is
   * removed instead of leaving a content-less empty bubble behind. */
  const finalizeStreamedMessage = useCallback((chatId: string, messageId: string, errorText?: string) => {
    setChats((prev) =>
      prev.map((c) => {
        if (c.id !== chatId) return c;
        const target = c.messages.find((m) => m.id === messageId);
        if (target && target.text.length === 0 && !errorText) {
          return {
            ...c,
            messages: c.messages.filter((m) => m.id !== messageId),
            status: "idle" as const,
            updatedAt: new Date().toISOString(),
          };
        }
        const messages = c.messages.map((m) =>
          m.id === messageId
            ? { ...m, text: errorText && m.text.length === 0 ? `I ran into a problem: ${errorText}` : m.text, streaming: false }
            : m,
        );
        return { ...c, messages, status: errorText ? ("error" as const) : ("idle" as const), updatedAt: new Date().toISOString() };
      }),
    );
  }, []);

  const sendMessage = useCallback(
    (chatId: string, text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;

      const chat = chats.find((c) => c.id === chatId);
      if (!chat) return;

      // Defense in depth beyond the composer's own disabled state: never execute a send (or
      // charge a credit) once the workspace is out of credits.
      if (remainingCredits(credits) <= 0) return;

      // Defense in depth alongside disconnectSource stripping enabled sources on disconnect
      // (audit P1-3): never send a source the workspace no longer considers connected, even if
      // this chat's own enabledSources somehow still names it.
      const connectedIds = new Set(sources.filter((s) => s.connection === "connected").map((s) => s.id));
      const liveEnabledSources = chat.enabledSources.filter((s) => connectedIds.has(s));

      // One run at a time. The composer already disables itself while another chat is
      // running, but suggestion chips call sendMessage directly — without this guard a chip
      // click would clear the first run's timers and strand that chat in "running" forever
      // (PRODUCT_READINESS_AUDIT.md P1-6).
      if (runChatId !== null && runChatId !== chatId) return;

      const userMessage: ChatMessage = { id: newId("m"), role: "user", text: trimmed, ts: new Date().toISOString() };
      const history = historyFor(chat);
      lastPromptRef.current = trimmed;

      // No credit charge here — moved to AFTER the work completes successfully (applyPlan for
      // the dispute/legacy path below; the streaming success branch further down for everything
      // else), per CREDIT_COSTS's doc comment. Blocking a NEW send at 0 balance (the guard
      // above) is still enforced up front — only the CHARGE itself waits for real work to exist.

      setChats((prev) =>
        prev.map((c) =>
          c.id === chatId
            ? {
                ...c,
                title: c.messages.length === 0 && !c.context ? chatTitleFrom(trimmed) : c.title,
                status: "running",
                messages: [...c.messages, userMessage],
                updatedAt: new Date().toISOString(),
              }
            : c,
        ),
      );

      cancelledRef.current = false;
      clearTimers();
      const controller = new AbortController();
      abortRef.current = controller;
      // `cancelledRef` alone isn't enough to protect the trailing state commits below: it's a
      // single store-wide flag that a *later* run resets to false the moment it starts (see the
      // line above, next time sendMessage runs). If this run's chat is deleted mid-flight,
      // deleteChat frees runChatId immediately (unlike cancelRun's 300ms hold), so a new run can
      // start — and reset cancelledRef — before this orphaned promise settles. Comparing against
      // `controller` instead catches that: a newer run always installs its own AbortController,
      // so this closure's `controller` stops being the current one the instant that happens,
      // regardless of what cancelledRef reads by then.
      const supersededByLaterRun = () => abortRef.current !== controller;
      setPendingApproval(null);
      setRunChatId(chatId);
      setRunPhase("running");
      setRunSteps([]);
      setVisibleStepIds([]);

      if (chat.context?.kind === "dispute") {
        // Dispute-context chats (Resolution Center) keep the exact legacy path — real tool
        // calls, the write-approval pause, and the client-side step-reveal timers in applyPlan.
        // Real network call to the agent backend — the ProgressBlock's "Thinking…" fallback
        // (runSteps still empty) covers the in-flight window; once the response arrives, the
        // per-step reveal timers below pace its *display* only — the steps already ran
        // server-side.
        void (async () => {
          let plan: AgentRunPlan;
          try {
            plan = await runAgentTurn(
              { prompt: trimmed, enabledSources: liveEnabledSources, context: chat.context, history },
              controller.signal,
            );
          } catch {
            if (cancelledRef.current || supersededByLaterRun()) return;
            plan = {
              steps: [],
              answer: "",
              toolSummary: [],
              error: {
                code: "server_unavailable",
                message: "The AI agent is temporarily unreachable. Check your connection and try again.",
              },
            };
          }
          if (cancelledRef.current || supersededByLaterRun()) return;
          applyPlan(chatId, plan);
        })();
        return;
      }

      // Global / dashboard-context chats: the shared agent runtime's streaming endpoint
      // (docs/AI_ASSISTANT_ARCHITECTURE.md). A placeholder assistant message is appended
      // immediately and grown in place as real deltas arrive — ChatMessageList.tsx hides the
      // generic "Thinking…" ProgressBlock the moment this message has content, so the seller
      // sees the real answer streaming in rather than a stale spinner sitting above it.
      const messageId = newId("m");
      ensureStreamingMessage(chatId, messageId);
      void (async () => {
        try {
          await streamAgentMessage(
            {
              sessionId: chatId,
              mode: "global",
              message: trimmed,
              history,
              enabledSources: liveEnabledSources,
              workspace: { disputesNeedingAttention: disputesNeedingAttention() },
            },
            (delta) => appendStreamDelta(chatId, messageId, delta),
            controller.signal,
          );
          if (cancelledRef.current || supersededByLaterRun()) {
            finalizeStreamedMessage(chatId, messageId);
            return;
          }
          finalizeStreamedMessage(chatId, messageId);
          // Genuine success only: not cancelled, not superseded, not an error — the one place
          // the streaming path charges. Always `standardMessage` (see CREDIT_COSTS's comment on
          // why streaming has no tool-detail signal to price a heavier tier by).
          chargeCredits(CREDIT_COSTS.standardMessage);
        } catch (err) {
          if (cancelledRef.current || supersededByLaterRun()) {
            finalizeStreamedMessage(chatId, messageId);
            return;
          }
          // Only a server-authored error (the agent itself reported a problem) is safe to show
          // verbatim — anything else (network failure, bad status, unreadable stream) gets the
          // same fixed, product-voiced copy the legacy path already uses, never a raw fetch/
          // browser error string (PRODUCT_READINESS_AUDIT.md P1-4).
          const message =
            err instanceof AgentStreamError
              ? err.message
              : "The AI agent is temporarily unreachable. Check your connection and try again.";
          finalizeStreamedMessage(chatId, messageId, message);
        }
        if (supersededByLaterRun()) return; // a newer run owns runChatId/runPhase now — don't touch it
        setRunPhase("done");
        window.setTimeout(() => {
          setRunChatId(null);
          setRunPhase("idle");
          setRunSteps([]);
          setVisibleStepIds([]);
        }, 250);
      })();
    },
    [chats, credits, sources, runChatId, clearTimers, applyPlan, ensureStreamingMessage, appendStreamDelta, finalizeStreamedMessage, chargeCredits],
  );

  const resolveApproval = useCallback(
    (decision: "approve" | "decline") => {
      if (!pendingApproval) return;
      const { chatId, toolCallId, toolName, input, prompt } = pendingApproval;
      const chat = chats.find((c) => c.id === chatId);
      if (!chat) return;

      const history = historyFor(chat);
      setPendingApproval(null);
      cancelledRef.current = false;
      clearTimers();
      const controller = new AbortController();
      abortRef.current = controller;
      setRunPhase("running");
      setRunSteps([]);
      setVisibleStepIds([]);

      void (async () => {
        let plan: AgentRunPlan;
        try {
          plan = await approveAgentAction(
            { decision, toolCallId, toolName, input, prompt, enabledSources: chat.enabledSources, context: chat.context, history },
            controller.signal,
          );
        } catch {
          if (cancelledRef.current) return;
          plan = {
            steps: [],
            answer: "",
            toolSummary: [],
            error: { code: "server_unavailable", message: "The AI agent is temporarily unreachable — that action wasn't taken. Try again in a moment." },
          };
        }
        // Surface the executed write action to the dispute page (audit P1-10): only after a
        // real, successful execution — declines and failed runs leave the page untouched.
        if (
          decision === "approve" &&
          toolName === "commas_mark_dispute_response_ready" &&
          typeof input.dispute_id === "string" &&
          plan.toolSummary.some((t) => t.ok)
        ) {
          const disputeId = input.dispute_id;
          setMarkedReadyDisputeIds((prev) => (prev.includes(disputeId) ? prev : [...prev, disputeId]));
        }
        applyPlan(chatId, plan);
      })();
    },
    [pendingApproval, chats, clearTimers, applyPlan],
  );

  const approveWrite = useCallback(() => resolveApproval("approve"), [resolveApproval]);
  const declineWrite = useCallback(() => resolveApproval("decline"), [resolveApproval]);

  const addEvidenceItem = useCallback((disputeId: string, item: AIEvidenceItem) => {
    setEvidenceByDispute((prev) => ({ ...prev, [disputeId]: [...(prev[disputeId] ?? []), item] }));
  }, []);

  const updateEvidenceItem = useCallback(
    (disputeId: string, itemId: string, patch: { title: string; record: string; files: EvidenceFileMeta[] }) => {
      setEvidenceByDispute((prev) => ({
        ...prev,
        [disputeId]: (prev[disputeId] ?? []).map((item) =>
          item.id === itemId ? { ...item, ...patch, proofConfirmed: !item.proofRequired || patch.files.length > 0 } : item,
        ),
      }));
    },
    [],
  );

  const removeEvidenceItem = useCallback((disputeId: string, itemId: string) => {
    setEvidenceByDispute((prev) => ({
      ...prev,
      [disputeId]: (prev[disputeId] ?? []).filter((item) => item.id !== itemId),
    }));
  }, []);

  const setResponseDraft = useCallback((disputeId: string, text: string) => {
    setResponseDraftByDispute((prev) => ({ ...prev, [disputeId]: text }));
  }, []);

  /** The one place a proposal (server/agent/actions/index.ts) turns into a real case-state
   * change — never anywhere else, so "do not allow high-consequence actions to execute
   * silently" holds by construction: nothing calls addEvidenceItem/setResponseDraft on the
   * agent's behalf except this function, and this function only runs from an explicit click on
   * a rendered ProposedActionCard. Declining (or re-clicking an already-resolved action) only
   * updates the card's own status — never touches case state. */
  const resolveProposedAction = useCallback(
    (
      chatId: string,
      messageId: string,
      actionId: string,
      decision: "approve" | "decline",
      /** For `add_evidence` only — indices into `action.items` the seller kept checked (the
       * card defaults every item to checked, so this is normally all of them, but the seller
       * can uncheck any before approving — "the user reviews" isn't just a formality). Ignored
       * for `draft_response`, and ignored entirely on decline. */
      selectedIndices?: number[],
    ) => {
      const chat = chats.find((c) => c.id === chatId);
      const message = chat?.messages.find((m) => m.id === messageId);
      const action = message?.proposedActions?.find((a) => a.id === actionId);
      if (!action || action.status !== "pending") return;

      let addedCount: number | undefined;
      if (decision === "approve") {
        if (action.type === "add_evidence") {
          const items = selectedIndices ? action.items.filter((_, i) => selectedIndices.includes(i)) : action.items;
          addedCount = items.length;
          for (const candidate of items) {
            // Third-party evidence (Fathom, Gmail, Zoom, GoHighLevel/CRM, ...) needs the
            // seller's own supporting proof before it counts as fully added — the seller is
            // relying on external information, not a record Commas already holds. Native
            // Commas evidence needs no such gate: the underlying record already exists in the
            // system of record.
            const proofRequired = isThirdPartyEvidenceSource(candidate.sourceLabel);
            addEvidenceItem(action.disputeId, {
              id: newId("ai-evidence"),
              title: candidate.title,
              record: candidate.record,
              sourceType: candidate.sourceType as EvidenceSourceType,
              sourceLabel: candidate.sourceLabel,
              addedBy: "ai",
              category: candidate.category,
              files: [],
              proofRequired,
              proofConfirmed: !proofRequired,
              // The stub attaches real per-connector data directly (bypassing the tool schema a
              // real model is constrained to — see server/agent/actions/index.ts); a real
              // model's own candidate has no `sources`, so fall back to a single-source list
              // derived from the label it did provide.
              sources: candidate.sources ?? [{ sourceId: sourceIdFromLabel(candidate.sourceLabel) }],
            });
          }
        } else if (action.type === "draft_response") {
          setResponseDraft(action.disputeId, action.draftText);
        }
      }

      setChats((prev) =>
        prev.map((c) =>
          c.id === chatId
            ? {
                ...c,
                messages: c.messages.map((m) =>
                  m.id === messageId
                    ? {
                        ...m,
                        proposedActions: m.proposedActions?.map((a) =>
                          a.id === actionId
                            ? {
                                ...a,
                                status: decision === "approve" ? "approved" : "declined",
                                ...(a.type === "add_evidence" && addedCount !== undefined ? { approvedCount: addedCount } : {}),
                              }
                            : a,
                        ),
                      }
                    : m,
                ),
              }
            : c,
        ),
      );
    },
    [chats, addEvidenceItem, setResponseDraft],
  );

  const toggleChatSource = useCallback((chatId: string, sourceId: SourceId) => {
    setChats((prev) =>
      prev.map((c) =>
        c.id === chatId
          ? {
              ...c,
              enabledSources: c.enabledSources.includes(sourceId)
                ? c.enabledSources.filter((s) => s !== sourceId)
                : [...c.enabledSources, sourceId],
            }
          : c,
      ),
    );
  }, []);

  const connectSource = useCallback((sourceId: SourceId) => {
    setSources((prev) => prev.map((s) => (s.id === sourceId ? { ...s, connection: "connecting" } : s)));
    window.setTimeout(() => {
      setSources((prev) => prev.map((s) => (s.id === sourceId ? { ...s, connection: "connected" } : s)));
    }, 900);
  }, []);

  const disconnectSource = useCallback((sourceId: SourceId) => {
    setSources((prev) => prev.map((s) => (s.id === sourceId ? { ...s, connection: "not_connected" } : s)));
    // Strip it from every chat's enabledSources too — a disconnected source must never keep
    // being queried by a chat that enabled it earlier (audit P1-3). sendMessage also filters
    // against live connection state as defense in depth.
    setChats((prev) => prev.map((c) => ({ ...c, enabledSources: c.enabledSources.filter((s) => s !== sourceId) })));
  }, []);

  const addCredits = useCallback((amount: number) => {
    setCredits((prev) => ({ ...prev, totalCredits: prev.totalCredits + amount }));
  }, []);

  const setRemainingCreditsForDemo = useCallback((remaining: number) => {
    setCredits((prev) => ({ ...prev, usedCredits: Math.max(0, prev.totalCredits - remaining) }));
  }, []);

  const resetDemo = useCallback(() => {
    clearTimers();
    cancelledRef.current = true;
    setChats(SEED_CHATS);
    setSources(SOURCES);
    setCredits(INITIAL_CREDITS);
    setRunChatId(null);
    setRunPhase("idle");
    setRunSteps([]);
    setVisibleStepIds([]);
    setPendingApproval(null);
    setMarkedReadyDisputeIds([]);
    setEvidenceByDispute(seedEvidenceByDispute());
    setResponseDraftByDispute({});
    persist({
      chats: SEED_CHATS,
      sources: SOURCES,
      credits: INITIAL_CREDITS,
      evidenceByDispute: seedEvidenceByDispute(),
      responseDraftByDispute: {},
      markedReadyDisputeIds: [],
    });
  }, [clearTimers]);

  const value = useMemo(
    () => ({
      chats,
      sources,
      credits,
      runChatId,
      runPhase,
      runSteps,
      visibleStepIds,
      pendingApproval,
      createChat,
      deleteChat,
      sendMessage,
      cancelRun,
      approveWrite,
      declineWrite,
      toggleChatSource,
      connectSource,
      disconnectSource,
      markedReadyDisputeIds,
      evidenceByDispute,
      addEvidenceItem,
      updateEvidenceItem,
      removeEvidenceItem,
      responseDraftByDispute,
      setResponseDraft,
      resolveProposedAction,
      addCredits,
      setRemainingCreditsForDemo,
      resetDemo,
    }),
    [
      chats,
      sources,
      credits,
      runChatId,
      runPhase,
      runSteps,
      visibleStepIds,
      pendingApproval,
      createChat,
      deleteChat,
      sendMessage,
      cancelRun,
      approveWrite,
      declineWrite,
      toggleChatSource,
      connectSource,
      disconnectSource,
      markedReadyDisputeIds,
      evidenceByDispute,
      addEvidenceItem,
      updateEvidenceItem,
      removeEvidenceItem,
      responseDraftByDispute,
      setResponseDraft,
      resolveProposedAction,
      addCredits,
      setRemainingCreditsForDemo,
      resetDemo,
    ],
  );

  return <ChatStoreContext.Provider value={value}>{children}</ChatStoreContext.Provider>;
}

export function useChatStore() {
  const ctx = useContext(ChatStoreContext);
  if (!ctx) throw new Error("useChatStore must be used within a ChatStoreProvider");
  return ctx;
}
