import { useEffect, useState } from "react";
import { ChatStoreProvider, useChatStore } from "./hooks/useChatStore";
import type { PageContext, ViewId } from "./lib/types";
import { DISPUTE_CONTEXT } from "./lib/mockData";
import { Sidebar } from "./components/shell/Sidebar";
import { TopNav } from "./components/shell/TopNav";
import { RightPanel } from "./components/chat/RightPanel";
import { FloatingAIButton } from "./components/chat/FloatingAIButton";
import { DashboardPage } from "./pages/DashboardPage";
import { ResolutionCenterPage } from "./pages/ResolutionCenterPage";
import { ChatPage } from "./pages/ChatPage";

function AppShell() {
  const { chats, createChat } = useChatStore();

  const [view, setView] = useState<ViewId>("dashboard");
  const [chatPageActiveId, setChatPageActiveId] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelChatId, setPanelChatId] = useState<string | null>(null);

  const openPanel = (context?: PageContext) => {
    let targetId = panelChatId;
    if (context) {
      const existing = chats.find((c) => c.context?.kind === context.kind && c.context?.id === context.id);
      targetId = existing ? existing.id : createChat(context);
    } else if (!targetId) {
      targetId = createChat();
    }
    setPanelChatId(targetId);
    setPanelOpen(true);
  };

  const closePanel = () => setPanelOpen(false);

  // The right panel is scoped to "other pages" (spec §2.5) — the Chat view has its own full
  // conversation surface, so showing the panel there would duplicate the composer/credits and
  // let two chats run side by side. Closing on navigation-into-chat covers every path (Sidebar
  // click, openFullChatFromPanel already does this explicitly too).
  useEffect(() => {
    if (view === "chat") setPanelOpen(false);
  }, [view]);

  const openFullChatFromPanel = () => {
    if (!panelChatId) return;
    setChatPageActiveId(panelChatId);
    setView("chat");
    setPanelOpen(false);
  };

  return (
    <div className="app-shell-bg flex h-full w-full">
      <Sidebar active={view} onNavigate={setView} />
      <div className="flex-1 min-w-0 flex flex-col h-full">
        <TopNav />
        <div className="flex-1 min-h-0 flex">
          <div className="flex-1 min-w-0 flex flex-col">
            {view === "dashboard" && <DashboardPage />}
            {view === "resolution-center" && (
              <ResolutionCenterPage onInvestigate={() => openPanel(DISPUTE_CONTEXT)} />
            )}
            {view === "chat" && <ChatPage activeChatId={chatPageActiveId} onSelectChat={setChatPageActiveId} />}
          </div>
          <RightPanel
            open={panelOpen && view !== "chat"}
            chatId={panelChatId}
            onClose={closePanel}
            onOpenFullChat={openFullChatFromPanel}
          />
        </div>
      </div>

      {view !== "chat" && (
        <FloatingAIButton
          hidden={panelOpen}
          onClick={() => openPanel(view === "resolution-center" ? DISPUTE_CONTEXT : undefined)}
        />
      )}
    </div>
  );
}

export function App() {
  return (
    <ChatStoreProvider>
      <AppShell />
    </ChatStoreProvider>
  );
}
