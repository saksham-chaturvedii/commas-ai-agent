/**
 * Minimal placeholder dashboard — just enough Commas-native surface to host the floating AI
 * button and prove contextual AI works outside Resolution Center. Full dashboard is out of
 * scope for this pass (see docs/active-context.md).
 */
export function DashboardPage() {
  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-6">
      <h1 className="text-[22px] font-semibold text-[var(--color-text-primary)]">Welcome back, makemorecommas</h1>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-5 max-w-3xl">
        {[
          { label: "Revenue (30d)", value: "$18,420" },
          { label: "Transactions", value: "62" },
          { label: "Open disputes", value: "1" },
        ].map((stat) => (
          <div key={stat.label} className="content-card">
            <span className="text-[12.5px] font-medium text-[var(--color-text-quaternary)]">{stat.label}</span>
            <span className="text-[26px] font-semibold text-[var(--color-text-primary)]">{stat.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
