import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import type {
  Chat,
  ChatMessage,
  CreditsState,
  PageContext,
  ProgressStep,
  RunPhase,
  SourceId,
  SourceInfo,
} from "../lib/types";
import { DEFAULT_ENABLED_SOURCES, INITIAL_CREDITS, SEED_CHATS, SOURCES } from "../lib/mockData";
import { runAgentTurn, type AgentRunPlan } from "../lib/agentApi";

/**
 * Shared chat state. Chat/sources/credits state is still client-side React state only (no
 * persistence beyond the page session — docs/ARCHITECTURE.md §10's backend ChatStore isn't
 * built), but `sendMessage` now calls the real agent backend (server/index.ts) over
 * POST /api/agent/run instead of a local scripted engine — see docs/active-context.md for
 * what's real vs. still mocked. The client-side setTimeout playback below only paces the
 * *display* of steps the backend already executed; it does not simulate them.
 */

const STEP_INTERVAL_MS = 650;
const CREDIT_COST_PER_MESSAGE = 1;
const CREDIT_COST_PER_STEP = 1;

interface ChatStoreValue {
  chats: Chat[];
  sources: SourceInfo[];
  credits: CreditsState;
  runChatId: string | null;
  runPhase: RunPhase;
  runSteps: ProgressStep[];
  visibleStepIds: string[];
  createChat: (context?: PageContext) => string;
  deleteChat: (id: string) => void;
  sendMessage: (chatId: string, text: string) => void;
  cancelRun: () => void;
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

export function ChatStoreProvider({ children }: { children: ReactNode }) {
  const [chats, setChats] = useState<Chat[]>(SEED_CHATS);
  const [sources, setSources] = useState<SourceInfo[]>(SOURCES);
  const [credits, setCredits] = useState<CreditsState>(INITIAL_CREDITS);
  const [runChatId, setRunChatId] = useState<string | null>(null);
  const [runPhase, setRunPhase] = useState<RunPhase>("idle");
  const [runSteps, setRunSteps] = useState<ProgressStep[]>([]);
  const [visibleStepIds, setVisibleStepIds] = useState<string[]>([]);

  const cancelledRef = useRef(false);
  const timersRef = useRef<number[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  const clearTimers = useCallback(() => {
    timersRef.current.forEach((t) => window.clearTimeout(t));
    timersRef.current = [];
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
    if (chatId) {
      setChats((prev) =>
        prev.map((c) =>
          c.id === chatId
            ? {
                ...c,
                messages: [
                  ...c.messages,
                  {
                    id: newId("m"),
                    role: "assistant",
                    text: "Stopped by you.",
                    ts: new Date().toISOString(),
                  },
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
  }, [runChatId, clearTimers]);

  const sendMessage = useCallback(
    (chatId: string, text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;

      const chat = chats.find((c) => c.id === chatId);
      if (!chat) return;

      const userMessage: ChatMessage = { id: newId("m"), role: "user", text: trimmed, ts: new Date().toISOString() };

      setChats((prev) =>
        prev.map((c) =>
          c.id === chatId
            ? {
                ...c,
                title: c.messages.length === 0 && !c.context ? chatTitleFrom(trimmed) : c.title,
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
      setRunChatId(chatId);
      setRunPhase("running");
      setRunSteps([]);
      setVisibleStepIds([]);

      // Real network call to the agent backend (server/index.ts) — the ProgressBlock's
      // "Thinking…" fallback (runSteps still empty) covers this in-flight window; once the
      // response arrives, the same per-step reveal timers as before pace its *display* only —
      // the steps themselves already ran server-side.
      void (async () => {
        let plan: AgentRunPlan;
        try {
          plan = await runAgentTurn(
            { prompt: trimmed, enabledSources: chat.enabledSources, context: chat.context },
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
        if (cancelledRef.current) return;

        const answerText = plan.error ? `I ran into a problem: ${plan.error.message}` : plan.answer;
        setRunSteps(plan.steps);

        let creditSpend = CREDIT_COST_PER_MESSAGE;

        plan.steps.forEach((s, i) => {
          const t = window.setTimeout(
            () => {
              if (cancelledRef.current) return;
              setVisibleStepIds((prev) => [...prev, s.id]);
              creditSpend += CREDIT_COST_PER_STEP;
            },
            (i + 1) * STEP_INTERVAL_MS,
          );
          timersRef.current.push(t);
        });

        const finalDelay = (plan.steps.length + 1) * STEP_INTERVAL_MS;
        const finalTimer = window.setTimeout(() => {
          if (cancelledRef.current) return;
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
          setCredits((prev) => ({ ...prev, balance: Math.max(0, prev.balance - creditSpend) }));
          setRunPhase("done");
          window.setTimeout(() => {
            setRunChatId(null);
            setRunPhase("idle");
            setRunSteps([]);
            setVisibleStepIds([]);
          }, 250);
        }, finalDelay);
        timersRef.current.push(finalTimer);
      })();
    },
    [chats, clearTimers],
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
      createChat,
      deleteChat,
      sendMessage,
      cancelRun,
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
      createChat,
      deleteChat,
      sendMessage,
      cancelRun,
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
