import { useEffect, useState } from "react";
import { ChatStoreProvider, useChatStore } from "./hooks/useChatStore";
import type { PageContext, ViewId } from "./lib/types";
import { DASHBOARD_CONTEXT, buildDisputeContext } from "./lib/mockData";
import { DISPUTES, type AIEvidenceItem } from "./lib/disputeData";
import { Sidebar } from "./components/shell/Sidebar";
import { TopNav } from "./components/shell/TopNav";
import { RightPanel } from "./components/chat/RightPanel";
import { FloatingAIButton } from "./components/chat/FloatingAIButton";
import { DashboardPage } from "./pages/DashboardPage";
import { ResolutionCenter } from "./components/resolution/ResolutionCenter";
import { DisputeDetail } from "./components/resolution/DisputeDetail";
import { ChatPage } from "./pages/ChatPage";

/**
 * App shell layout is ported from commas-ai-copilot: gradient app-shell background with a
 * padded frame, glass Sidebar/TopNav, and rounded main-surface content. The AI panel docks
 * as a sibling surface to the right of the page content (Notion-style placement, Commas
 * materials) — the underlying page stays visible.
 */

function AppShell() {
  const { chats, createChat } = useChatStore();

  const [view, setView] = useState<ViewId>("dashboard");
  const [rcView, setRcView] = useState<"list" | "detail">("list");
  const [selectedDisputeId, setSelectedDisputeId] = useState<string>("2481");
  // Session-lifetime, per-dispute evidence added via "Add evidence" — lives here (not inside
  // DisputeDetail) so it survives the seller navigating back to the Resolution Center list and
  // returning, since DisputeDetail fully unmounts while rcView === "list". Seeded from each
  // dispute's seedEvidenceItems (e.g. Priya Nair's resolved case ships with its historical
  // evidence already on file) so resolved disputes read as real historical records.
  const [evidenceByDispute, setEvidenceByDispute] = useState<Record<string, AIEvidenceItem[]>>(() => {
    const initial: Record<string, AIEvidenceItem[]> = {};
    for (const d of DISPUTES) {
      if (d.seedEvidenceItems.length > 0) initial[d.id] = d.seedEvidenceItems;
    }
    return initial;
  });
  const [chatPageActiveId, setChatPageActiveId] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelChatId, setPanelChatId] = useState<string | null>(null);

  const openPanel = (context?: PageContext) => {
    let targetId = panelChatId;
    if (context) {
      const existing = chats.find((c) => c.context?.kind === context.kind && c.context?.id === context.id);
      targetId = existing ? existing.id : createChat(context);
    } else {
      // Context-less open (e.g. the floating button on the RC list): never resurface a stale
      // dispute/dashboard-context chat from a previous page — reuse/create a general chat
      // instead (PRODUCT_READINESS_AUDIT.md P1-3).
      const previous = targetId ? chats.find((c) => c.id === targetId) : undefined;
      if (!targetId || previous?.context) targetId = createChat();
    }
    setPanelChatId(targetId);
    setPanelOpen(true);
  };

  const closePanel = () => setPanelOpen(false);

  const addEvidenceItem = (disputeId: string, item: AIEvidenceItem) => {
    setEvidenceByDispute((prev) => ({ ...prev, [disputeId]: [...(prev[disputeId] ?? []), item] }));
  };

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

  /** Context for the floating button / panel, based on where the user currently is. */
  const currentContext: PageContext | undefined =
    view === "resolution-center" && rcView === "detail"
      ? buildDisputeContext(selectedDisputeId, evidenceByDispute[selectedDisputeId])
      : view === "dashboard"
        ? DASHBOARD_CONTEXT
        : undefined;

  return (
    <div className="app-shell-bg p-0 min-[992px]:pt-3 min-[992px]:pr-4 min-[992px]:pb-3 min-[992px]:pl-2.5">
      <div className="flex flex-row gap-0 min-[992px]:gap-2.5 h-dvh min-[992px]:h-[calc(100dvh-1.5rem)]">
        <Sidebar
          active={view}
          onNavigate={(v) => {
            // Close the AI panel when changing pages — its chat is bound to the page it was
            // opened from, and carrying a "Dispute #2481" panel onto the Dashboard presents
            // stale context as current (PRODUCT_READINESS_AUDIT.md P1-1). Reopening from the
            // new page rebinds it via openPanel's context logic.
            if (v !== view) setPanelOpen(false);
            setView(v);
            if (v === "resolution-center") setRcView("list");
          }}
        />
        <div className="flex flex-col min-w-0 flex-1 h-full gap-3">
          <TopNav />
          <div className="flex-1 min-h-0 flex gap-2.5">
            <div className="flex-1 min-w-0 flex flex-col">
              {view === "dashboard" && <DashboardPage />}
              {view === "resolution-center" && rcView === "list" && (
                <ResolutionCenter
                  onOpenDispute={(id) => {
                    setSelectedDisputeId(id);
                    setRcView("detail");
                    setPanelOpen(false); // same stale-context rule as sidebar navigation (P1-1)
                  }}
                />
              )}
              {view === "resolution-center" && rcView === "detail" && (
                <DisputeDetail
                  key={selectedDisputeId}
                  disputeId={selectedDisputeId}
                  evidenceItems={evidenceByDispute[selectedDisputeId] ?? []}
                  onAddEvidence={(item) => addEvidenceItem(selectedDisputeId, item)}
                  onBack={() => {
                    setRcView("list");
                    setPanelOpen(false); // same stale-context rule as sidebar navigation (P1-1)
                  }}
                  onInvestigate={() =>
                    openPanel(buildDisputeContext(selectedDisputeId, evidenceByDispute[selectedDisputeId]))
                  }
                />
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
      </div>

      {view !== "chat" && (
        <FloatingAIButton hidden={panelOpen} onClick={() => openPanel(currentContext)} />
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
