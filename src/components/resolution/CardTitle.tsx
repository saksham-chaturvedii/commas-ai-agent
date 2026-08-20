import type { ReactNode } from "react";

/** Card heading style shared by dispute-detail cards. Ported from commas-ai-copilot's EvidenceCopilot. */
export function CardTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="text-[14px] leading-[21px] font-semibold tracking-[-0.2px] text-[#1a1a1a]">
      {children}
    </h2>
  );
}
