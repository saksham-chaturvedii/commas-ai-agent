/**
 * Small stacked-card mock, standing in for production's blurred illustration inside empty
 * Overview cards (docs/references/Screenshot 2026-08-21 at 4.27.20 AM.png — "Top payment
 * methods" / "Credit score distribution"). Purely decorative, no real content implied.
 */
export function EmptyIllustration() {
  return (
    <div className="relative w-[160px] h-[64px] mx-auto opacity-90">
      <div className="absolute inset-x-3 top-2 h-[56px] rounded-xl bg-[#f4f5f7] border border-black/5 blur-[1.5px]" />
      <div className="absolute inset-x-0 top-0 h-[56px] rounded-xl bg-white border border-black/[0.06] shadow-[0_1px_2px_rgba(0,0,0,0.05),0_6px_16px_-6px_rgba(16,24,40,0.15)] flex items-center gap-2 px-3">
        <div className="w-6 h-6 rounded-md bg-[#dbe6fd] shrink-0" />
        <div className="flex flex-col gap-1.5 flex-1">
          <div className="h-1.5 w-3/4 rounded-full bg-[#e5e7eb]" />
          <div className="h-1.5 w-1/3 rounded-full bg-[#e8f5d0]" />
        </div>
      </div>
    </div>
  );
}
