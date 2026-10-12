import { div, orderRevenue, orders, type Totals } from "../metrics";
import type { DailyFact } from "../types";
import { bucketFacts } from "./bucket";
import type { GroupBy } from "./grouping";
import type { ColumnDef, NumRow, NumTable } from "./table-model";

const col = (key: string, label: string, format: ColumnDef["format"], direction: ColumnDef["direction"]): ColumnDef => ({ key, label, format, direction });

export const NVR_COLUMNS: ColumnDef[] = [
  col("newOrders", "First Time Orders", "number", "up"),
  col("newRevenue", "New Order Revenue", "currency0", "up"),
  col("newRevenueChange", "Revenue % Change", "percent1", "up"),
  col("newAov", "First Time AOV", "currency2", "up"),
  col("retOrders", "Returning Orders", "number", "up"),
  col("retRevenue", "Returning Order Revenue", "currency0", "up"),
  col("retRevenueChange", "Revenue % Change", "percent1", "up"),
  col("retAov", "Returning AOV", "currency2", "up"),
  col("totalOrders", "Total Orders", "number", "up"),
  col("totalRevenue", "Total Revenue", "currency0", "up"),
  col("totalRevenueChange", "Revenue % Change", "percent1", "up"),
  col("totalAov", "Total AOV", "currency2", "up"),
  col("pctFirstTime", "% First Time", "percent1", "none"),
  col("pctReturning", "% Returning", "percent1", "none"),
];

/** Change against the previous row; nothing to compare with on the first row or after a row with no revenue. */
const change = (current: number, previous: number | null | undefined): number | null => (previous === null || previous === undefined || previous === 0 ? null : current / previous - 1);

function values(t: Totals, prev: Totals | null): NumRow["v"] {
  const totalRevenue = orderRevenue(t);
  const totalOrders = orders(t);
  return {
    newOrders: t.newOrders,
    newRevenue: t.newOrderRevenue,
    newRevenueChange: prev ? change(t.newOrderRevenue, prev.newOrderRevenue) : null,
    newAov: div(t.newOrderRevenue, t.newOrders),
    retOrders: t.returningOrders,
    retRevenue: t.returningOrderRevenue,
    retRevenueChange: prev ? change(t.returningOrderRevenue, prev.returningOrderRevenue) : null,
    retAov: div(t.returningOrderRevenue, t.returningOrders),
    totalOrders,
    totalRevenue,
    totalRevenueChange: prev ? change(totalRevenue, orderRevenue(prev)) : null,
    totalAov: div(totalRevenue, totalOrders),
    pctFirstTime: div(t.newOrders, totalOrders),
    pctReturning: div(t.returningOrders, totalOrders),
  };
}

export function buildNewVsReturning(facts: DailyFact[], by: GroupBy): NumTable {
  const { buckets, total } = bucketFacts(facts, by);
  let prev: Totals | null = null;
  const rows: NumRow[] = [];
  for (const b of buckets) {
    rows.push({ key: b.key, label: b.label, v: values(b.totals, prev) });
    prev = b.totals;
  }
  return { columns: NVR_COLUMNS, rows, total: { key: "total", label: "Total", v: values(total, null) } };
}
