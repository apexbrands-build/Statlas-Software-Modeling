import type { ChannelSaleInput } from "../omni/import-kinds";
import type { ChannelSale } from "../omni/types";

const idOf = (r: { date: string; retailer?: string }) => `${r.date}|${r.retailer ?? ""}`;

/**
 * A channel's rows after new rows are merged into them, the way the database function `channel_sales_merge` does it: a day (and
 * retailer) that exists keeps every number the new row does not give, and its metrics are merged key by key; a new day starts at zero.
 * Used by the demo store and as the reference for the SQL.
 */
export function mergeRows(existing: ChannelSale[], channel: string, rows: ChannelSaleInput[]): ChannelSale[] {
  const out = new Map<string, ChannelSale>(existing.map((r) => [idOf(r), r]));
  for (const r of rows) {
    const cur = out.get(idOf(r));
    const next: ChannelSale = {
      date: r.date,
      channel,
      retailer: r.retailer ?? "",
      revenue: r.revenue ?? cur?.revenue ?? 0,
      orders: r.orders ?? cur?.orders ?? 0,
      units: r.units ?? cur?.units ?? 0,
      adSpend: r.adSpend ?? cur?.adSpend ?? 0,
      metrics: { ...(cur?.metrics ?? {}), ...r.metrics },
      source: r.source,
    };
    if (cur?.periodDays !== undefined) next.periodDays = cur.periodDays;
    out.set(idOf(r), next);
  }
  return [...out.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.retailer < b.retailer ? -1 : a.retailer > b.retailer ? 1 : 0));
}

/** A full row as a row that gives every core number (saving it replaces the day's core numbers and merges its metrics). */
export function toInput(r: ChannelSale): ChannelSaleInput {
  return { date: r.date, channel: r.channel, retailer: r.retailer ?? "", revenue: r.revenue, orders: r.orders, units: r.units, adSpend: r.adSpend, metrics: { ...(r.metrics ?? {}) }, source: "import" };
}

/** One row of the `p_rows` argument of `channel_sales_merge`. A core number that is not given is sent as null. */
export function rpcRow(r: ChannelSaleInput, source: string): Record<string, unknown> {
  return { date: r.date, retailer: r.retailer ?? "", revenue: r.revenue, orders: r.orders, units: r.units, ad_spend: r.adSpend, metrics: r.metrics, source };
}

/** The numbers of a stored `metrics` value; anything else in it is dropped. */
export function numbersOf(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (v && typeof v === "object" && !Array.isArray(v)) for (const [k, x] of Object.entries(v as Record<string, unknown>)) if (typeof x === "number" && Number.isFinite(x)) out[k] = x;
  return out;
}
