import { addDays, addYears, dayOfWeek, eachDay, endOfMonth } from "../dates";
import { isBfcm } from "../planning/history";
import type { Curve } from "../planning/new-customer";
import { otherMonth } from "../planning/other-channels";
import type { PlanMonth } from "../planning/types";
import type { ClientSettings } from "../types";
import type { ChannelDay, ChannelSale } from "./types";

/** One channel's sales by day, its retailers added together. */
export function dailyTotals(sales: ChannelSale[], channel: string): Map<string, ChannelDay> {
  const out = new Map<string, ChannelDay>();
  // A day that holds ad numbers or platform metrics but no sales is a day whose sales file is not loaded yet (an ads file that runs
  // ahead). It is not a day of zero sales, so it is left out: it must not move "sales through", the forecast comparison or the model.
  const waiting = new Set<string>();
  const sold = new Set<string>();
  for (const s of sales) {
    if (s.channel !== channel) continue;
    const d = out.get(s.date) ?? { revenue: 0, orders: 0, units: 0, adSpend: 0 };
    d.revenue += s.revenue;
    d.orders += s.orders;
    d.units += s.units;
    d.adSpend += s.adSpend;
    out.set(s.date, d);
    if (s.revenue > 0 || s.orders > 0 || s.units > 0) sold.add(s.date);
    else if (s.adSpend > 0 || Object.keys(s.metrics ?? {}).length > 0) waiting.add(s.date);
  }
  for (const date of waiting) if (!sold.has(date)) out.delete(date);
  return out;
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/**
 * The channel's own weekday pattern over the 12 months up to `asOf`: seven weights that average 1 (index 0 = Sunday).
 * Black Friday week is left out. Null under 8 weeks of days with sales, or when a weekday has fewer than 4 of them.
 */
export function weekdayShares(days: Map<string, { revenue: number }>, asOf: string): number[] | null {
  const from = addDays(addYears(asOf, -1), 1);
  const by: number[][] = [[], [], [], [], [], [], []];
  let n = 0;
  for (const [date, d] of days) {
    if (date < from || date > asOf || !(d.revenue > 0)) continue;
    n += 1;
    if (!isBfcm(date)) by[dayOfWeek(date)].push(d.revenue);
  }
  if (n < 56 || by.some((v) => v.length < 4)) return null;
  const avgs = by.map(mean);
  const overall = mean(avgs);
  return overall > 0 ? avgs.map((a) => a / overall) : null;
}

/** A month's total over its days: by the weekday weights, or evenly with none. The days always add up to the total. */
export function spreadMonth(total: number, month: string, shares: number[] | null): Map<string, number> {
  const first = `${month.slice(0, 7)}-01`;
  const dates = eachDay(first, endOfMonth(first));
  const w = dates.map((d) => (shares ? Math.max(0, shares[dayOfWeek(d)] ?? 1) : 1));
  const sum = w.reduce((a, b) => a + b, 0);
  return new Map(dates.map((d, i) => [d, sum > 0 ? (total * w[i]) / sum : total / dates.length]));
}

/** What the plan says about one channel in one month. */
export interface MonthLine {
  /** The channel's forecast for the month (null when nothing is planned). */
  forecast: number | null;
  /** Of the forecast, what the halo factors credit to the own-site ads (capped at the forecast). */
  created: number;
  capped: boolean;
  /** Planned ad spend on the channel itself. */
  adSpend: number;
  /** The full halo, before any cap. */
  halo: number;
}

/** Every channel's line for every plan month that has inputs: "YYYY-MM" -> channel key -> line. */
export function monthLines(months: PlanMonth[], settings: ClientSettings, curve: Curve | null): Record<string, Record<string, MonthLine>> {
  const out: Record<string, Record<string, MonthLine>> = {};
  for (const m of months) {
    if (!m.inputs) continue;
    const row: Record<string, MonthLine> = {};
    for (const l of otherMonth(m.month, m.inputs, settings, curve).lines) row[l.channel.key] = { forecast: l.forecast, created: l.created, capped: l.capped, adSpend: l.adSpend, halo: l.halo };
    out[m.month.slice(0, 7)] = row;
  }
  return out;
}

/** The spend curve only matters for a line that assumed an ad spend other than the plan's own or none at all. */
export function needsCurve(months: PlanMonth[]): boolean {
  return months.some((m) => Object.values(m.inputs?.other ?? {}).some((l) => Number(l?.assumedSpend) > 0));
}

/** A channel's forecast for each day of a range. Days of a month with no forecast are simply absent. */
export function dailyForecast(lines: Record<string, Record<string, MonthLine>>, channel: string, from: string, to: string, shares: number[] | null): Map<string, number> {
  const out = new Map<string, number>();
  for (let key = from.slice(0, 7); key <= to.slice(0, 7); key = addDays(endOfMonth(`${key}-01`), 1).slice(0, 7)) {
    const forecast = lines[key]?.[channel]?.forecast;
    if (forecast === null || forecast === undefined) continue;
    for (const [d, v] of spreadMonth(forecast, `${key}-01`, shares)) if (d >= from && d <= to) out.set(d, v);
  }
  return out;
}
