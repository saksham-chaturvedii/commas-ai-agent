import { ChevronDown, Settings, CircleHelp, Bell } from "lucide-react";
import { CommaMark } from "./CommaMark";

const ICON_BUTTONS = [
  { icon: Settings, label: "Settings" },
  { icon: CircleHelp, label: "Help" },
  { icon: Bell, label: "Notifications" },
];

/** Top nav bar, simplified/adapted from commas-ai-copilot for this prototype. */
export function TopNav({ trailing }: { trailing?: React.ReactNode }) {
  return (
    <header className="flex items-center h-14 px-4 border-b border-black/[0.06] bg-white/80 backdrop-blur-sm shrink-0">
      <button type="button" className="inline-flex items-center gap-1.5 h-9 pl-1.5 pr-3 rounded-full hover:bg-black/[0.03] shrink-0">
        <span className="flex items-center justify-center w-7 h-7 rounded-lg bg-[#3d2530] shrink-0">
          <CommaMark size={14} color="#e8a0b0" />
        </span>
        <span className="text-[14px] text-[#111111] font-semibold">makemorecommas</span>
        <ChevronDown size={16} strokeWidth={2} className="text-[#6b7280] shrink-0" />
      </button>

      <div className="flex-1" />

      {trailing}

      <div className="flex items-center gap-1 shrink-0 ml-2">
        {ICON_BUTTONS.map(({ icon: Icon, label }) => (
          <button
            key={label}
            type="button"
            aria-label={label}
            className="flex items-center justify-center w-9 h-9 rounded-full text-[#374151] hover:bg-black/[0.04] transition-colors"
          >
            <Icon size={19} strokeWidth={1.75} />
          </button>
        ))}
      </div>
    </header>
  );
}
