"use client";

import { AovHistogramReport } from "./AovHistogramReport";
import { BestCreativesReport } from "./BestCreativesReport";
import { CalendarReport } from "./CalendarReport";
import { ContributionMarginReport } from "./ContributionMarginReport";
import { MetricGoalReport } from "./MetricGoalReport";
import { NewVsReturningReport } from "./NewVsReturningReport";
import { RevenueOverviewReport } from "./RevenueOverviewReport";
import { PaidMediaReport } from "./PaidMediaReport";
import { FirstProductReport } from "./FirstProductReport";
import { PnlReport } from "./PnlReport";
import { WaitingForData } from "./WaitingForData";
import { Empty } from "./ReportFrame";
import { MER_SPECS } from "@/lib/reports/metric-spec";
import { getReport } from "@/lib/reports/registry";

const OUTLINES: Record<string, string[]> = {};

/** Maps a report slug to its page. Reports are added here one by one as they are built. */
export function ReportRouter({ slug }: { slug: string }) {
  const def = getReport(slug);
  if (!def) return <Empty>Unknown report.</Empty>;
  switch (slug) {
    case "calendar":
      return <CalendarReport />;
    case "mer":
      return <MetricGoalReport slug="mer" specs={MER_SPECS} />;
    case "ads":
      return <PaidMediaReport />;
    case "best-creatives":
      return <BestCreativesReport />;
    case "first-product":
      return <FirstProductReport />;
    case "pnl":
      return <PnlReport />;
    case "contribution-margin":
      return <ContributionMarginReport />;
    case "revenue-overview":
      return <RevenueOverviewReport />;
    case "new-vs-returning":
      return <NewVsReturningReport />;
    case "aov-histogram":
      return <AovHistogramReport />;
    default:
      if (def.status === "waiting") return <WaitingForData slug={slug} outline={OUTLINES[slug] ?? []} />;
      return <Empty>{def.status === "planned" ? `${def.title} is coming soon.` : `${def.title} is not built yet.`}</Empty>;
  }
}
