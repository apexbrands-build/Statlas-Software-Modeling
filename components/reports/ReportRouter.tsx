"use client";

import { MetricGoalReport } from "./MetricGoalReport";
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
    case "mer":
      return <MetricGoalReport slug="mer" specs={MER_SPECS} />;
    case "ads":
      return <PaidMediaReport />;
    case "first-product":
      return <FirstProductReport />;
    case "pnl":
      return <PnlReport />;
    default:
      return def.status === "waiting" ? <WaitingForData slug={slug} outline={OUTLINES[slug] ?? []} /> : <Empty>{def.title} is not built yet.</Empty>;
  }
}
