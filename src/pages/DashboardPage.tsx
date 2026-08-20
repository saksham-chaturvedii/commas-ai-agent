/**
 * Minimal dashboard — enough Commas-native surface (main-surface + content-cards, matching
 * the old prototype's page chrome) to host the contextual AI entry points. A full dashboard
 * port is out of scope (see docs/active-context.md).
 */
export function DashboardPage() {
  return (
    <div className="main-surface flex flex-col p-0 min-h-[370px] pt-[30px] px-5 pb-5 flex-1 overflow-y-auto">
      <h1
        className="pl-[5px] text-[20px] leading-[26px] font-semibold tracking-[-0.4px] text-[#1a1a1a]"
        style={{ fontFamily: "var(--font-heading)" }}
      >
        Welcome back, makemorecommas
      </h1>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-5 max-w-3xl">
        {[
          { label: "Revenue (30d)", value: "$18,420" },
          { label: "Transactions", value: "62" },
          { label: "Open disputes", value: "1" },
        ].map((stat) => (
          <div key={stat.label} className="content-card" style={{ gap: 8 }}>
            <span className="text-[12.5px] font-medium text-[#727272]">{stat.label}</span>
            <span className="text-[26px] font-semibold text-[#1a1a1a]">{stat.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
