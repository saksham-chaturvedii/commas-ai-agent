import { ChevronDown, Settings, CircleHelp, Bell, Sparkles } from "lucide-react";
import { CommaMark } from "./CommaMark";

const ICON_BUTTONS = [
  { icon: Settings, label: "Settings" },
  { icon: CircleHelp, label: "Help" },
  { icon: Bell, label: "Notifications" },
];

/**
 * Top nav bar, adapted from commas-ai-copilot — floating glass elements over the app-shell
 * gradient (docs/references/commas-dashboard.png), not a solid bar.
 */
export function TopNav({ trailing }: { trailing?: React.ReactNode }) {
  return (
    <header className="relative z-30 flex items-center h-14 px-4 shrink-0 gap-3">
      <button type="button" className="glass-card inline-flex items-center gap-1.5 h-10 pl-1.5 pr-3 shrink-0 whitespace-nowrap">
        <span className="flex items-center justify-center w-7 h-7 rounded-lg bg-[#3d2530] shrink-0">
          <CommaMark size={14} color="#e8a0b0" />
        </span>
        <span className="text-[14px] text-[#111111] font-semibold">makemorecommas</span>
        <ChevronDown size={16} strokeWidth={2} className="text-[#6b7280] shrink-0" />
      </button>

      <div className="glass-card flex items-center gap-2 h-10 px-4 flex-1 max-w-[480px]">
        <Sparkles size={16} strokeWidth={1.75} className="text-[#8fb3f5] shrink-0" />
        <span className="text-[14px] font-normal text-[#9ca3af]">Search apps…</span>
      </div>

      <div className="flex-1" />

      {trailing}

      <div className="flex items-center gap-1 shrink-0">
        {ICON_BUTTONS.map(({ icon: Icon, label }) => (
          <button
            key={label}
            type="button"
            aria-label={label}
            className="flex items-center justify-center w-9 h-9 rounded-full text-[#374151] hover:bg-white/40 transition-colors"
          >
            <Icon size={19} strokeWidth={1.75} />
          </button>
        ))}
      </div>
    </header>
  );
}
