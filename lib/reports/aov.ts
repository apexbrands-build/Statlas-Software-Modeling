import { formatValue } from "../format";
import { div } from "../metrics";
import type { Currency } from "../types";

/** How the histogram buckets are built: ten buckets between the 2.5th and 97.5th percentile, ten between smallest and largest, or fixed-width steps. */
export type AovMode = "dynamic" | "complete" | "step";
export const AOV_STEPS = [10, 25, 50, 100];

export interface AovStats {
  orders: number;
  revenue: number;
  mean: number | null;
  median: number | null;
  mode: number | null;
}

export interface AovBucket {
  bucket: number;
  low: number;
  /** Null for the open-ended last bucket of step mode. */
  high: number | null;
  orders: number;
  revenue: number;
}

export interface AovData {
  stats: AovStats;
  buckets: AovBucket[];
  /** Orders outside the charted range (dynamic mode only). */
  excluded: number;
}

type Row = Record<string, unknown>;
const num = (v: unknown): number => Number(v ?? 0);
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

/** Maps the rows `aov_stats` and `aov_histogram` return (numeric columns arrive as strings or numbers) to typed data. */
export function mapAovRows(statsRow: Row | undefined, bucketRows: Row[]): AovData {
  return {
    stats: statsRow
      ? { orders: num(statsRow.orders), revenue: num(statsRow.revenue), mean: numOrNull(statsRow.mean), median: numOrNull(statsRow.median), mode: numOrNull(statsRow.mode) }
      : { orders: 0, revenue: 0, mean: null, median: null, mode: null },
    buckets: bucketRows.map((r) => ({ bucket: num(r.bucket), low: num(r.low), high: numOrNull(r.high), orders: num(r.orders), revenue: num(r.revenue) })),
    excluded: num(bucketRows[0]?.excluded),
  };
}

export interface AovRow {
  nth: string;
  range: string;
  orders: number;
  ordersPct: number | null;
  revenue: number;
  revenuePct: number | null;
}

/** Table rows for the histogram. Percentages use every order in the range as the denominator, so they add to less than 100% when orders are excluded. */
export function buildAovRows(data: AovData, mode: AovMode, currency: Currency): { rows: AovRow[]; footnote: string | null } {
  const money = (v: number) => formatValue(v, "currency2", currency);
  const rows = data.buckets.map((b) => ({
    nth: mode === "step" ? `#${b.bucket}` : `${b.bucket * 10}%`,
    range: b.high === null ? `${money(b.low)}+` : `${money(b.low)} to ${money(b.high)}`,
    orders: b.orders,
    ordersPct: div(b.orders, data.stats.orders),
    revenue: b.revenue,
    revenuePct: div(b.revenue, data.stats.revenue),
  }));
  const n = data.excluded;
  return { rows, footnote: n > 0 ? `${n} ${n === 1 ? "order" : "orders"} outside the charted range ${n === 1 ? "is" : "are"} not shown.` : null };
}
