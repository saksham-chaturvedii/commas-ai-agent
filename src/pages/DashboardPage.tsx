import { RevenueModule } from "../components/dashboard/RevenueModule";
import { AnnouncementsModule } from "../components/dashboard/AnnouncementsModule";
import { OverviewControls } from "../components/dashboard/OverviewControls";
import { OverviewCard, OverviewEmptyCard } from "../components/dashboard/OverviewCard";

/**
 * Dashboard, rebuilt against the production Commas screenshots (docs/references/Screenshot
 * 2026-08-21 at 4.27.*.png) — commas-ai-copilot has no Dashboard to port from (Resolution
 * Center only), so this page's structure comes straight from production, using this repo's
 * existing design primitives (content-card, btn-secondary, filter-pill's visual language).
 *
 * Numbers are coherent with the rest of the prototype's mock world rather than a literal
 * fresh-account zero-state: Disputed payments / Dispute activity reflect the same Dispute
 * #2481 ($499) that Resolution Center shows, so the two pages tell one consistent story.
 * Two cards (Top payment methods, Credit score distribution) reproduce production's genuine
 * empty-state treatment verbatim, since this prototype has no backing mock data for either.
 */

const XLABELS: [string, string] = ["Aug 15", "Aug 21"];

export function DashboardPage() {
  return (
    <div className="main-surface flex flex-col p-0 min-h-[370px] pt-[30px] px-5 pb-8 flex-1 overflow-y-auto">
      <h1
        className="pl-[5px] text-[20px] leading-[26px] font-semibold tracking-[-0.4px] text-[#1a1a1a]"
        style={{ fontFamily: "var(--font-heading)" }}
      >
        Welcome back, makemorecommas
      </h1>

      <div className="flex gap-4 mt-5 items-stretch flex-wrap">
        <RevenueModule />
        <AnnouncementsModule />
      </div>

      <h2
        className="pl-[5px] text-[17px] leading-[22px] font-semibold tracking-[-0.3px] text-[#1a1a1a] mt-8 mb-3"
        style={{ fontFamily: "var(--font-heading)" }}
      >
        Overview
      </h2>
      <OverviewControls />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
        <OverviewCard
          title="Gross revenue"
          info
          value="$18,420"
          subtitle="$16,280 last period"
          points={[0.3, 0.34, 0.32, 0.4, 0.44, 0.42, 0.5]}
          xLabels={XLABELS}
        />
        <OverviewEmptyCard
          title="Top payment methods"
          caption="Payment methods will appear here once sales come in"
        />
        <OverviewCard
          title="Spend per customer"
          value="$62.40"
          subtitle="$58.10 last period"
          points={[0.4, 0.38, 0.44, 0.42, 0.5, 0.48, 0.55]}
          xLabels={XLABELS}
        />

        <OverviewCard
          title="New customers"
          value="14"
          subtitle="9 last period"
          points={[0.2, 0.3, 0.28, 0.45, 0.4, 0.6, 0.58]}
          xLabels={XLABELS}
        />
        <OverviewEmptyCard
          title="Credit score distribution"
          caption="Enrich your first lead to see credit insights"
          cta="Go to Qualifier App"
        />
        <OverviewCard
          title="Disputed payments"
          value="$499"
          subtitle="1 open dispute"
          points={[0, 0, 0, 0, 0, 0.3, 0.28]}
          xLabels={XLABELS}
        />

        <OverviewCard
          title="Dispute activity"
          value="1.6%"
          subtitle="0.8% last period"
          points={[0, 0, 0, 0, 0.2, 0.5, 0.45]}
          xLabels={XLABELS}
        />
        <OverviewCard
          title="Net revenue"
          value="$17,921"
          subtitle="$16,280 last period"
          points={[0.28, 0.32, 0.3, 0.38, 0.42, 0.4, 0.48]}
          xLabels={XLABELS}
        />
      </div>
    </div>
  );
}
