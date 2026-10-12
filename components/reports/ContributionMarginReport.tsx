"use client";

import { FactsReport } from "./FactsReport";
import { buildCmTable } from "@/lib/reports/contribution-margin";

export function ContributionMarginReport() {
  return <FactsReport slug="contribution-margin" firstLabel="Date" caption="Contribution margin analysis (refunds are shown on the day they were refunded)" build={buildCmTable} />;
}
