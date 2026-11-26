import { addDays, eachDay } from "../dates";
import { CATALOG, type Platform, type Totals } from "./metrics";
import type { ChannelSale } from "./types";

/** The stored metric that holds a platform's ad-attributed sales when its ads are split by type. */
const AD_SALES = "ad_sales";

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/**
 * A row as the platform means it: when ads are loaded by type (Amazon: Sponsored Products, Brands, Display), the channel's ad spend
 * and its ad-attributed sales are the sum of the types, whatever total was loaded before. Rows without any type are returned as they are.
 */
export function withRollups(platform: Platform, s: ChannelSale): ChannelSale {
  const parts = CATALOG[platform].adParts;
  const m = s.metrics;
  if (!parts || !m) return s;
  const has = (keys: string[]) => keys.some((k) => isNum(m[k]));
  const sum = (keys: string[]) => keys.reduce((a, k) => a + (isNum(m[k]) ? m[k] : 0), 0);
  const spend = has(parts.spend);
  const sales = has(parts.sales);
  if (!spend && !sales) return s;
  return { ...s, adSpend: spend ? sum(parts.spend) : s.adSpend, metrics: sales ? { ...m, [AD_SALES]: sum(parts.sales) } : m };
}

/** A period of a channel, with how many days carried a row and the last of them. */
export interface PeriodTotals extends Totals {
  days: number;
  lastData: string | null;
}

/**
 * A channel's numbers over a range (both ends included), retailers added together. A metric the catalog adds up is summed; one it
 * averages is the mean over the days that carry it; one it reads as "latest" is the value on the last day that carries it.
 * A metric the catalog does not know is summed.
 */
export function totalsOf(platform: Platform, sales: ChannelSale[], channel: string, from: string, to: string): PeriodTotals {
  const agg = new Map(CATALOG[platform].stored.map((d) => [d.key, d.agg]));
  const out: PeriodTotals = { revenue: 0, orders: 0, units: 0, adSpend: 0, m: {}, days: 0, lastData: null };
  const dates = new Set<string>();
  const avg = new Map<string, { sum: number; days: Set<string> }>();
  const last = new Map<string, { date: string; value: number }>();
  for (const raw of sales) {
    if (raw.channel !== channel || raw.date < from || raw.date > to) continue;
    const s = withRollups(platform, raw);
    out.revenue += s.revenue;
    out.orders += s.orders;
    out.units += s.units;
    out.adSpend += s.adSpend;
    dates.add(s.date);
    if (out.lastData === null || s.date > out.lastData) out.lastData = s.date;
    for (const [k, v] of Object.entries(s.metrics ?? {})) {
      if (!isNum(v)) continue;
      const how = agg.get(k) ?? "sum";
      if (how === "sum") out.m[k] = (out.m[k] ?? 0) + v;
      else if (how === "avg") {
        const a = avg.get(k) ?? { sum: 0, days: new Set<string>() };
        a.sum += v;
        a.days.add(s.date);
        avg.set(k, a);
      } else {
        const l = last.get(k);
        if (!l || s.date > l.date) last.set(k, { date: s.date, value: v });
        else if (s.date === l.date) l.value += v;
      }
    }
  }
  for (const [k, a] of avg) out.m[k] = a.sum / a.days.size;
  for (const [k, l] of last) out.m[k] = l.value;
  out.days = dates.size;
  return out;
}

export type Grain = "day" | "week" | "month";

/** The Monday of the date's week. */
function mondayOf(date: string): string {
  const dow = (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
  return addDays(date, -dow);
}

/**
 * The range cut into days, weeks (Monday to Sunday, named by their Monday) or months ("YYYY-MM"), one entry per period, empty periods
 * included. A week or month that the range only partly covers holds the covered days only, so the periods add up to the range.
 */
export function seriesOf(platform: Platform, sales: ChannelSale[], channel: string, from: string, to: string, grain: Grain): { keys: string[]; rows: PeriodTotals[] } {
  const keyOf = grain === "day" ? (d: string) => d : grain === "week" ? mondayOf : (d: string) => d.slice(0, 7);
  const keys: string[] = [];
  const spans = new Map<string, { from: string; to: string }>();
  for (const d of eachDay(from, to)) {
    const k = keyOf(d);
    const span = spans.get(k);
    if (span) span.to = d;
    else {
      keys.push(k);
      spans.set(k, { from: d, to: d });
    }
  }
  const mine = sales.filter((s) => s.channel === channel && s.date >= from && s.date <= to);
  return {
    keys,
    rows: keys.map((k) => {
      const span = spans.get(k) as { from: string; to: string };
      return totalsOf(platform, mine, channel, span.from, span.to);
    }),
  };
}
