import { orderRevenue, orders, type Totals } from "../metrics";
import type { DailyFact } from "../types";
import { bucketFacts } from "./bucket";
import type { GroupBy } from "./grouping";
import type { ColumnDef, NumRow, NumTable } from "./table-model";

const col = (key: string, label: string, format: ColumnDef["format"], direction: ColumnDef["direction"]): ColumnDef => ({ key, label, format, direction });

export const REVENUE_COLUMNS: ColumnDef[] = [
  col("orders", "# of Orders", "number", "up"),
  col("grossSales", "Gross Sales", "currency0", "up"),
  col("discounts", "Discounts", "currency0", "up"),
  col("discountedSales", "Discounted Sales", "currency0", "up"),
  col("returns", "Returns", "currency0", "up"),
  col("netSales", "Net Sales", "currency0", "up"),
  col("shipping", "Shipping", "currency0", "none"),
  col("tax", "Tax", "currency0", "none"),
  col("totalSales", "Total Sales", "currency0", "up"),
  col("orderRevenue", "Order Revenue", "currency0", "up"),
];

/** Discounts and returns are shown negative. Order Revenue is discounted sales + shipping + tax (refunds not deducted); Total Sales deducts returns. */
function values(t: Totals): NumRow["v"] {
  return {
    orders: orders(t),
    grossSales: t.grossSales,
    // 0 - x, not -x, so a zero stays +0 and never prints as "-£0".
    discounts: 0 - t.discounts,
    discountedSales: t.grossSales - t.discounts,
    returns: 0 - t.refunds,
    netSales: t.netSales,
    shipping: t.shippingCollected,
    tax: t.tax,
    totalSales: t.netSales + t.shippingCollected + t.tax,
    orderRevenue: orderRevenue(t),
  };
}

export function buildRevenueOverview(facts: DailyFact[], by: GroupBy): NumTable {
  const { buckets, total } = bucketFacts(facts, by);
  return {
    columns: REVENUE_COLUMNS,
    rows: buckets.map((b) => ({ key: b.key, label: b.label, v: values(b.totals) })),
    total: { key: "total", label: "Total", v: values(total) },
  };
}
