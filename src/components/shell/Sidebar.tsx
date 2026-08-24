import type { ReactNode } from "react";
import {
  Home,
  Database,
  ArrowUpRight,
  Wallet,
  Gavel,
  MessageSquare,
  Settings,
  Plus,
} from "lucide-react";
import { CommaMark } from "./CommaMark";
import type { ViewId } from "../../lib/types";

/**
 * Left icon rail, ported from commas-ai-copilot (logo tile, nav, app tiles, bottom cluster)
 * with one addition: the Chat entry, and real navigation wiring for the three live views.
 * Billing/Growth/Wallet are visual fidelity only (non-functional, as in the old prototype).
 */

const NAV_ITEMS: { icon: typeof Home; label: string; view?: ViewId }[] = [
  { icon: Home, label: "Home", view: "dashboard" },
  { icon: Database, label: "Billing" },
  { icon: ArrowUpRight, label: "Growth" },
  { icon: Wallet, label: "Wallet" },
  { icon: Gavel, label: "Resolution Center", view: "resolution-center" },
  { icon: MessageSquare, label: "Chat", view: "chat" },
];

const APP_TILES: { bg: string; border?: string; content: ReactNode }[] = [
  { bg: "#000000", content: <span className="text-[15px] font-bold text-white">S</span> },
  {
    bg: "#dbe64a",
    content: (
      <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
        <path d="M8 1.5l1.6 4.9L14.5 8l-4.9 1.6L8 14.5l-1.6-4.9L1.5 8l4.9-1.6L8 1.5z" fill="#1a1a1a" />
      </svg>
    ),
  },
  {
    bg: "#f3f1fb",
    border: "1px solid rgba(0,0,0,0.04)",
    content: (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
        <path d="M2 3h12l-4.5 5.5V13l-3 1.5V8.5L2 3z" fill="#5b3fd4" />
      </svg>
    ),
  },
  {
    bg: "#fbfafa",
    border: "1px solid rgba(0,0,0,0.05)",
    content: (
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
        <circle cx="8" cy="3.5" r="1.3" fill="#e0432a" />
        <circle cx="8" cy="12.5" r="1.3" fill="#e0432a" />
        <circle cx="3.5" cy="8" r="1.3" fill="#e0432a" />
        <circle cx="12.5" cy="8" r="1.3" fill="#e0432a" />
        <circle cx="8" cy="8" r="1.3" fill="#e0432a" />
      </svg>
    ),
  },
];

export function Sidebar({ active, onNavigate }: { active: ViewId; onNavigate: (view: ViewId) => void }) {
  return (
    <div className="flex relative shrink-0 h-full pb-4 w-12">
      <div className="flex flex-col items-center gap-1 px-1 pb-2.5 h-full w-full">
        {/* logo tile */}
        <img
          src="/commasdefault.png"
          alt="Commas"
          className="w-10 h-10 rounded-[14px] shadow-[0_1px_2px_rgba(0,0,0,0.05),0_4px_10px_rgba(16,24,40,0.08)] mb-4"
        />

        {/* primary nav */}
        <nav className="flex flex-col items-center gap-1">
          {NAV_ITEMS.map(({ icon: Icon, label, view }) => {
            const isActive = view != null && active === view;
            return (
              <button
                key={label}
                type="button"
                aria-label={label}
                title={label}
                aria-current={isActive ? "page" : undefined}
                onClick={view ? () => onNavigate(view) : undefined}
                className={
                  "flex items-center justify-center w-10 h-10 rounded-xl transition-colors " +
                  (isActive
                    ? "bg-white shadow-[0_1px_2px_rgba(0,0,0,0.05),0_4px_10px_rgba(16,24,40,0.08)] text-[#1a1a1a]"
                    : "text-[#4b5563] hover:bg-white/50") +
                  (view ? " cursor-pointer" : " cursor-default")
                }
              >
                <Icon size={20} strokeWidth={1.75} />
              </button>
            );
          })}
        </nav>

        <div className="w-6 h-px bg-black/10 my-3" />

        {/* installed app tiles */}
        <div className="flex flex-col items-center gap-2">
          {APP_TILES.map((tile, i) => (
            <div
              key={i}
              className="flex items-center justify-center w-9 h-9 rounded-xl shadow-[0_1px_2px_rgba(0,0,0,0.06),0_2px_6px_rgba(16,24,40,0.08)]"
              style={{ background: tile.bg, border: tile.border }}
            >
              {tile.content}
            </div>
          ))}
          <button
            type="button"
            aria-label="Add app"
            className="flex items-center justify-center w-9 h-9 rounded-xl bg-white text-[#4b5563] shadow-[0_1px_2px_rgba(0,0,0,0.05),0_2px_6px_rgba(16,24,40,0.06)] hover:bg-white/70"
          >
            <Plus size={18} strokeWidth={1.75} />
          </button>
        </div>

        <div className="flex-1" />

        {/* bottom cluster */}
        <button
          type="button"
          aria-label="Settings"
          className="flex items-center justify-center w-10 h-10 rounded-xl text-[#4b5563] hover:bg-white/50 mb-2"
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
