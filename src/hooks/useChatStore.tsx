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
import { DEFAULT_ENABLED_SOURCES, INITIAL_CREDITS, SEED_CHATS, SOURCES } from "../lib/mockData";
import { runAgentTurn, approveAgentAction, type AgentRunPlan, type ConversationTurn } from "../lib/agentApi";

/**
 * Shared chat state. `sendMessage` calls the real agent backend (server/) over
 * POST /api/agent/run — see docs/active-context.md for what's real vs. still mocked. Chat/
 * sources/credits are persisted to localStorage (see loadPersisted/persist below) so a
 * conversation survives a reload; there is still no backend-side store (ARCHITECTURE.md §10's
 * JSON-snapshot design remains a documented future option, not built).
 */

const STEP_INTERVAL_MS = 650;
const CREDIT_COST_PER_MESSAGE = 1;
const CREDIT_COST_PER_STEP = 1;
const CREDIT_COST_PER_WRITE = 5;
/** How many prior turns to send the agent for conversation memory — capped so a long chat's
 * payload doesn't grow unbounded (server/app.ts enforces the same cap defensively). */
const HISTORY_TURN_LIMIT = 20;
const STORAGE_KEY = "commas-ai-agent:v1";

interface PersistedShape {
  chats: Chat[];
  sources: SourceInfo[];
  credits: CreditsState;
}

function loadPersisted(): PersistedShape | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedShape>;
    if (!Array.isArray(parsed.chats)) return null;
    return {
      chats: parsed.chats,
      sources: Array.isArray(parsed.sources) ? parsed.sources : SOURCES,
      credits: parsed.credits ?? INITIAL_CREDITS,
    };
  } catch {
    return null;
  }
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

function stepCost(steps: ProgressStep[]) {
  return steps.reduce((sum, s) => sum + (s.classification === "write" ? CREDIT_COST_PER_WRITE : CREDIT_COST_PER_STEP), 0);
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

  const cancelledRef = useRef(false);
  const timersRef = useRef<number[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const lastPromptRef = useRef("");

  useEffect(() => {
    persist({ chats, sources, credits });
  }, [chats, sources, credits]);

  const clearTimers = useCallback(() => {
    timersRef.current.forEach((t) => window.clearTimeout(t));
    timersRef.current = [];
  }, []);

  const setChatStatus = useCallback((chatId: string, status: Chat["status"]) => {
    setChats((prev) => prev.map((c) => (c.id === chatId ? { ...c, status } : c)));
  }, []);

  const createChat = useCallback((context?: PageContext) => {
    // Reuse an already-empty chat with the same context signature instead of spawning a new
    // one — repeated "New chat" clicks (or repeated panel opens) used to pile up empty rows in
    // history. `resultId` is set synchronously inside the updater (React runs it immediately,
    // only the re-render is deferred), so it's safe to read right after.
    let resultId = "";
    const matchesContext = (c: Chat) => (context ? c.context?.kind === context.kind && c.context?.id === context.id : !c.context);

    setChats((prev) => {
      const existing = prev.find((c) => c.messages.length === 0 && matchesContext(c));
      if (existing) {
        resultId = existing.id;
        return prev;
      }
      const id = newId("chat");
      const ts = new Date().toISOString();
      const chat: Chat = {
        id,
        title: context ? context.label : "New chat",
        createdAt: ts,
        updatedAt: ts,
        status: "idle",
        enabledSources: [...DEFAULT_ENABLED_SOURCES],
        context,
        messages: [],
      };
      resultId = id;
      return [chat, ...prev];
    });
    return resultId;
  }, []);

  const deleteChat = useCallback(
    (id: string) => {
      setChats((prev) => prev.filter((c) => c.id !== id));
      if (runChatId === id) {
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
   * any steps the backend already executed, then either finalize with an answer/error, or
   * pause on a new pendingApproval. */
  const applyPlan = useCallback(
    (chatId: string, plan: AgentRunPlan, creditSpend: number) => {
      if (cancelledRef.current) return;
      setRunSteps(plan.steps);
      setVisibleStepIds([]);

      let spend = creditSpend;

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
          setCredits((prev) => ({ ...prev, balance: Math.max(0, prev.balance - spend) }));
          return;
        }

        const answerText = plan.error ? `I ran into a problem: ${plan.error.message}` : plan.answer;
        const assistantMessage: ChatMessage = {
          id: newId("m"),
          role: "assistant",
          text: answerText,
          ts: new Date().toISOString(),
          toolSummary: plan.toolSummary.length > 0 ? plan.toolSummary : undefined,
        };
        setChats((prev) =>
          prev.map((c) =>
            c.id === chatId
              ? { ...c, messages: [...c.messages, assistantMessage], updatedAt: new Date().toISOString() }
              : c,
          ),
        );
        setChatStatus(chatId, plan.error ? "error" : "idle");
        setCredits((prev) => ({ ...prev, balance: Math.max(0, prev.balance - spend) }));
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
    [setChatStatus],
  );

  const sendMessage = useCallback(
    (chatId: string, text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;

      const chat = chats.find((c) => c.id === chatId);
      if (!chat) return;

      const userMessage: ChatMessage = { id: newId("m"), role: "user", text: trimmed, ts: new Date().toISOString() };
      const history = historyFor(chat);
      lastPromptRef.current = trimmed;

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
      setPendingApproval(null);
      setRunChatId(chatId);
      setRunPhase("running");
      setRunSteps([]);
      setVisibleStepIds([]);

      // Real network call to the agent backend — the ProgressBlock's "Thinking…" fallback
      // (runSteps still empty) covers the in-flight window; once the response arrives, the
      // per-step reveal timers below pace its *display* only — the steps already ran
      // server-side.
      void (async () => {
        let plan: AgentRunPlan;
        try {
          plan = await runAgentTurn(
            { prompt: trimmed, enabledSources: chat.enabledSources, context: chat.context, history },
            controller.signal,
          );
        } catch {
          if (cancelledRef.current) return;
          plan = {
            steps: [],
            answer: "",
            toolSummary: [],
            error: {
              code: "server_unavailable",
              message: "Couldn't reach the agent — check that the backend is running (npm run dev:server).",
            },
          };
        }
        applyPlan(chatId, plan, CREDIT_COST_PER_MESSAGE + stepCost(plan.steps));
      })();
    },
    [chats, clearTimers, applyPlan],
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
            error: { code: "server_unavailable", message: "Couldn't reach the agent to confirm that action." },
          };
        }
        applyPlan(chatId, plan, decision === "decline" ? 0 : stepCost(plan.steps));
      })();
    },
    [pendingApproval, chats, clearTimers, applyPlan],
  );

  const approveWrite = useCallback(() => resolveApproval("approve"), [resolveApproval]);
  const declineWrite = useCallback(() => resolveApproval("decline"), [resolveApproval]);

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
    persist({ chats: SEED_CHATS, sources: SOURCES, credits: INITIAL_CREDITS });
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
