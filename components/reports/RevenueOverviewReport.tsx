"use client";

import { FactsReport } from "./FactsReport";
import { DailyChart } from "@/components/DailyChart";
import { formatValue } from "@/lib/format";
import { buildRevenueOverview } from "@/lib/reports/revenue-overview";
import type { GroupBy } from "@/lib/reports/grouping";
import type { NumTable } from "@/lib/reports/table-model";
import type { ClientSettings, Currency, DailyFact } from "@/lib/types";
import { theme } from "@/theme/theme";

const build = (facts: DailyFact[], _settings: ClientSettings, by: GroupBy) => buildRevenueOverview(facts, by);

const chart = (table: NumTable, currency: Currency) => (
  <div className="rounded-xl border border-border bg-surface p-3">
    <DailyChart
      dates={table.rows.map((r) => r.key)}
      labels={table.rows.map((r) => r.label)}
      series={[{ id: "orderRevenue", label: "Order Revenue", kind: "line", color: theme.colors.chartPrimary, values: table.rows.map((r) => r.v.orderRevenue ?? null) }]}
      formatValue={(v) => formatValue(v, "currency0", currency)}
      height={220}
    />
  </div>
);

export function RevenueOverviewReport() {
  return <FactsReport slug="revenue-overview" firstLabel="Date" caption="Portrays revenue, refunds and number of orders" build={build} chart={chart} />;
}
