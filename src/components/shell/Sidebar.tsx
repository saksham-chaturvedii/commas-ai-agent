import { Home, Gavel, MessageSquare, Settings } from "lucide-react";
import { CommaMark } from "./CommaMark";
import type { ViewId } from "../../lib/types";

const NAV_ITEMS: { id: ViewId; icon: typeof Home; label: string }[] = [
  { id: "dashboard", icon: Home, label: "Home" },
  { id: "resolution-center", icon: Gavel, label: "Resolution Center" },
  { id: "chat", icon: MessageSquare, label: "Chat" },
];

/** Left icon rail, ported/adapted from commas-ai-copilot with a new Chat entry. */
export function Sidebar({ active, onNavigate }: { active: ViewId; onNavigate: (view: ViewId) => void }) {
  return (
    <div className="flex relative shrink-0 h-full pb-4 w-12">
      <div className="flex flex-col items-center gap-1 px-1 pb-2.5 h-full w-full">
        <div className="flex items-center justify-center w-10 h-10 rounded-[14px] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.05),0_4px_10px_rgba(16,24,40,0.08)] mb-4">
          <CommaMark size={24} />
        </div>

        <nav className="flex flex-col items-center gap-1">
          {NAV_ITEMS.map(({ id, icon: Icon, label }) => {
            const isActive = active === id;
            return (
              <button
                key={id}
                type="button"
                aria-label={label}
                aria-current={isActive ? "page" : undefined}
                onClick={() => onNavigate(id)}
                className={
                  "flex items-center justify-center w-10 h-10 rounded-xl transition-colors " +
                  (isActive
                    ? "bg-white shadow-[0_1px_2px_rgba(0,0,0,0.05),0_4px_10px_rgba(16,24,40,0.08)] text-[#1a1a1a]"
                    : "text-[#4b5563] hover:bg-white/70")
                }
              >
                <Icon size={20} strokeWidth={1.75} />
              </button>
            );
          })}
        </nav>

        <div className="flex-1" />

        <button
          type="button"
          aria-label="Settings"
          className="flex items-center justify-center w-10 h-10 rounded-xl text-[#4b5563] hover:bg-white/70 mb-2"
        >
          <Settings size={20} strokeWidth={1.75} />
        </button>
        <button
          type="button"
          aria-label="Account"
          className="flex items-center justify-center w-10 h-10 rounded-full bg-gradient-to-b from-[#a9cbfb] to-[#6fa0f2] shadow-[inset_0_1px_1px_rgba(255,255,255,0.6),inset_0_-2px_3px_rgba(20,50,120,0.3),0_1px_3px_rgba(0,0,0,0.15)]"
        >
          <CommaMark size={20} color="#ffffff" />
        </button>
      </div>
    </div>
  );
}
