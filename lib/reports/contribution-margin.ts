import { cmParts, div, orderRevenue, type Totals } from "../metrics";
import type { ClientSettings, DailyFact } from "../types";
import { bucketFacts } from "./bucket";
import type { GroupBy } from "./grouping";
import type { ColumnDef, NumRow, NumTable } from "./table-model";

const col = (key: string, label: string, group: string, format: ColumnDef["format"], direction: ColumnDef["direction"]): ColumnDef => ({ key, label, group, format, direction });

/** Contribution Margin Analysis, left to right: revenue, product margin, costs, result. */
export const CM_COLUMNS: ColumnDef[] = [
  col("grossSales", "Gross Sales", "Revenue", "currency0", "up"),
  col("discounts", "(Discounts)", "Revenue", "currency0", "none"),
  col("discountsPct", "Discounts %", "Revenue", "percent1", "down"),
  col("shipping", "Shipping", "Revenue", "currency0", "none"),
  col("taxes", "Taxes", "Revenue", "currency0", "none"),
  col("orderRevenue", "Order Revenue", "Revenue", "currency0", "up"),
  col("taxesOut", "(Taxes)", "Product", "currency0", "none"),
  col("refunds", "(Refunds)", "Product", "currency0", "none"),
  col("refundsPct", "Refunds %", "Product", "percent1", "down"),
  col("cogs", "(COGS)", "Product", "currency0", "none"),
  col("cogsPct", "COGS %", "Product", "percent1", "down"),
  col("productMargin", "Product Margin", "Product", "currency0", "up"),
  col("productMarginPct", "Product Margin %", "Product", "percent1", "up"),
  col("variableCost", "(Variable Revenue Cost)", "Costs", "currency0", "none"),
  col("costPct", "Cost %", "Costs", "percent1", "down"),
  col("adSpend", "(Ad Spend)", "Costs", "currency0", "none"),
  col("adSpendPct", "Ad Spend %", "Costs", "percent1", "down"),
  col("cm", "Contribution Margin", "Result", "currency0", "up"),
  col("cmPct", "Contribution Margin %", "Result", "percent1", "up"),
];

/** Every figure comes from `cmParts`, so contribution margin equals the Home tile; Product Margin = Net Sales + Shipping - COGS. */
function values(t: Totals, s: ClientSettings): NumRow["v"] {
  const c = cmParts(t, s);
  const revenue = orderRevenue(t);
  const productMargin = c.netSales + c.shipping - c.cogs;
  return {
    grossSales: t.grossSales,
    discounts: t.discounts,
    discountsPct: div(t.discounts, t.grossSales),
    shipping: t.shippingCollected,
    taxes: t.tax,
    orderRevenue: revenue,
    taxesOut: t.tax,
    refunds: t.refunds,
    refundsPct: div(t.refunds, revenue),
    cogs: c.cogs,
    cogsPct: div(c.cogs, t.grossSales),
    productMargin,
    productMarginPct: div(productMargin, revenue),
    variableCost: c.costOfDelivery,
    costPct: div(c.costOfDelivery, revenue),
    adSpend: c.adSpend,
    adSpendPct: div(c.adSpend, revenue),
    cm: c.cm,
    cmPct: div(c.cm, revenue),
  };
}

export function buildCmTable(facts: DailyFact[], settings: ClientSettings, by: GroupBy): NumTable {
  const { buckets, total } = bucketFacts(facts, by);
  return {
    columns: CM_COLUMNS,
    rows: buckets.map((b) => ({ key: b.key, label: b.label, v: values(b.totals, settings) })),
    total: { key: "total", label: "Total", v: values(total, settings) },
  };
}
