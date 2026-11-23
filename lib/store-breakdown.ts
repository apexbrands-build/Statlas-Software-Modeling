/**
 * The store page's numbers, laid out like Shopify Analytics' "Total sales breakdown" so a merchant can check them against Shopify:
 * gross sales - discounts - returns = net sales; net sales + shipping + taxes = total sales. Built from `daily_facts`
 * (orders by order date in the store's time zone; returns on the day of the refund).
 */
export interface FactRow {
  date: string;
  gross_sales: number | string | null;
  discounts: number | string | null;
  refunds: number | string | null;
  net_sales: number | string | null;
  shipping_collected: number | string | null;
  tax: number | string | null;
  new_orders: number | string | null;
  returning_orders: number | string | null;
  new_order_revenue: number | string | null;
  returning_order_revenue: number | string | null;
}

export interface Breakdown {
  grossSales: number;
  discounts: number;
  returns: number;
  netSales: number;
  shipping: number;
  taxes: number;
  totalSales: number;
  orders: number;
  newOrders: number;
  returningOrders: number;
  newRevenue: number;
  returningRevenue: number;
}

const n = (v: number | string | null | undefined) => Number(v ?? 0) || 0;

export function breakdown(rows: FactRow[]): Breakdown {
  const b: Breakdown = { grossSales: 0, discounts: 0, returns: 0, netSales: 0, shipping: 0, taxes: 0, totalSales: 0, orders: 0, newOrders: 0, returningOrders: 0, newRevenue: 0, returningRevenue: 0 };
  for (const r of rows) {
    b.grossSales += n(r.gross_sales);
    b.discounts += n(r.discounts);
    b.returns += n(r.refunds);
    b.netSales += n(r.net_sales);
    b.shipping += n(r.shipping_collected);
    b.taxes += n(r.tax);
    b.newOrders += n(r.new_orders);
    b.returningOrders += n(r.returning_orders);
    b.newRevenue += n(r.new_order_revenue);
    b.returningRevenue += n(r.returning_order_revenue);
  }
  b.orders = b.newOrders + b.returningOrders;
  b.totalSales = b.netSales + b.shipping + b.taxes;
  return b;
}

export const PRESETS = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "last7", label: "Last 7 days" },
  { key: "last30", label: "Last 30 days" },
  { key: "mtd", label: "Month to date" },
] as const;

const addDays = (d: string, k: number) => new Date(new Date(`${d}T00:00:00Z`).getTime() + k * 86_400_000).toISOString().slice(0, 10);

/** A preset date range ending on the store's today (dates in the store's own calendar). Unknown keys fall back to the last 30 days. */
export function presetRange(key: string, today: string): { from: string; to: string } {
  switch (key) {
    case "today":
      return { from: today, to: today };
    case "yesterday":
      return { from: addDays(today, -1), to: addDays(today, -1) };
    case "last7":
      return { from: addDays(today, -6), to: today };
    case "mtd":
      return { from: `${today.slice(0, 7)}-01`, to: today };
    default:
      return { from: addDays(today, -29), to: today };
  }
}
