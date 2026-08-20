import { ChevronDown, Sparkles, Plus, Settings, CircleHelp, Bell, Circle } from "lucide-react";
import { CommaMark } from "./CommaMark";

const ICON_BUTTONS = [
  { icon: Plus, label: "Create" },
  { icon: Settings, label: "Settings" },
  { icon: CircleHelp, label: "Help" },
  { icon: Bell, label: "Notifications" },
];

/** Top nav bar, ported verbatim from commas-ai-copilot (glass org pill + AI search + icons). */
export function TopNav() {
  return (
    <header className="relative z-30 flex items-center h-10">
      {/* org switcher */}
      <button
        type="button"
        className="glass-card inline-flex items-center gap-1.5 h-10 pl-1.5 pr-3 shrink-0 whitespace-nowrap"
      >
        <span className="flex items-center justify-center w-7 h-7 rounded-lg bg-[#3d2530] shrink-0">
          <CommaMark size={14} color="#e8a0b0" />
        </span>
        <span className="text-[15px] text-[#111111] font-semibold">makemorecommas</span>
        <ChevronDown size={16} strokeWidth={2} className="text-[#6b7280] shrink-0" />
      </button>

      {/* AI search */}
      <div className="glass-card flex items-center gap-2 h-10 px-4 flex-1 max-w-[672px] ml-3 shrink-0">
        <Sparkles size={18} strokeWidth={1.75} className="text-[#8fb3f5] shrink-0" />
        <span className="text-[16px] font-normal">
          <span className="text-[#6b7280]">Search</span>{" "}
          <span className="text-[#b0b7c0]">apps...</span>
        </span>
      </div>

      <div className="flex-1" />

      {/* icon cluster */}
      <div className="flex items-center gap-1 shrink-0">
        {ICON_BUTTONS.map(({ icon: Icon, label }) => (
          <button
            key={label}
            type="button"
            aria-label={label}
            className="flex items-center justify-center w-9 h-9 rounded-full text-[#374151] hover:bg-white/40 transition-colors"
          >
            <Icon size={20} strokeWidth={1.75} />
          </button>
        ))}
      </div>

      {/* onboarding pill — visual-only, matches production's "Finish setup" control */}
      <button
        type="button"
        className="inline-flex items-center gap-1.5 h-9 pl-2.5 pr-3.5 ml-2 rounded-full bg-[#171717] text-white text-[13.5px] font-medium shrink-0 whitespace-nowrap hover:bg-[#262626] transition-colors"
      >
        <Circle size={14} strokeWidth={2} className="text-white/70" />
        Finish setup
      </button>
    </header>
  );
}
