import { ChevronLeft, ChevronRight } from "lucide-react";
import { CommaMark } from "../shell/CommaMark";

/** Announcements carousel card — matches production's structure (heading, nav arrows, image,
 * title, supporting text, pagination dots). The branded photo is replaced with a gradient +
 * wordmark placeholder (mock content, not real photography). */
export function AnnouncementsModule() {
  return (
    <div className="content-card flex-1 min-w-[260px] max-w-[360px]" style={{ padding: 24, gap: 12 }}>
      <div className="flex items-center justify-between">
        <span className="text-[15px] font-semibold text-[#1a1a1a]">Announcements</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Previous"
            className="flex items-center justify-center w-6 h-6 rounded-full text-[#9ca3af] hover:bg-black/5"
          >
            <ChevronLeft size={14} strokeWidth={2} />
          </button>
          <button
            type="button"
            aria-label="Next"
            className="flex items-center justify-center w-6 h-6 rounded-full text-[#9ca3af] hover:bg-black/5"
          >
            <ChevronRight size={14} strokeWidth={2} />
          </button>
        </div>
      </div>

      <div
        className="relative w-full h-[150px] rounded-xl overflow-hidden flex items-end p-3"
        style={{ background: "linear-gradient(160deg, #bfe3f7 0%, #6fa8dc 55%, #1c5aa8 100%)" }}
      >
        <span className="inline-flex items-center gap-1.5 bg-white/90 rounded-full pl-1.5 pr-2.5 py-1 text-[12px] font-semibold text-[#1a1a1a]">
          <CommaMark size={14} /> COMMAS
        </span>
      </div>

      <div>
        <p className="text-[14px] font-semibold text-[#1a1a1a]">Welcome to Commas</p>
        <p className="text-[12.5px] text-[#8a8f98] mt-0.5">The new era for making money on the internet.</p>
      </div>

      <div className="flex items-center justify-center gap-1.5 mt-1">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="w-1.5 h-1.5 rounded-full"
            style={{ background: i === 1 ? "#9ca3af" : "#e5e7eb" }}
          />
        ))}
      </div>
    </div>
  );
}
