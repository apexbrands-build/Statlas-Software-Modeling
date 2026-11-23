import { addDays, endOfMonth } from "../dates";
import { curveAmer, fitNewCustomerModel, monthlyAmerIndex, type DayPoint, type FitResult } from "../planning/new-customer";
import type { OtherLine, PlanMonth } from "../planning/types";
import { weekdayShares } from "./forecast";

/**
 * The model for a sales channel that has its own ad spend (Amazon Ads, GMV Max): the New Customer model's regression, unchanged, on the
 * channel's daily ad spend and revenue. Each day's return is adjusted for the channel's own weekday pattern; outliers are removed by spend
 * bucket (Scott's rule for the width, days kept within one standard deviation of their bucket); Black Friday week is left out; a straight
 * line of revenue on daily ad spend is fitted and its R² says how far to trust it; a monthly seasonality index applies once two years of
 * days exist; past the highest spend the channel has run, returns fade (the standard guardrail).
 * The line's intercept is what the channel sells with none of its own ads: its organic sales, including what the own-site ads sent there.
 */
export interface ChannelModel {
  fit: FitResult;
  /** Weekday offsets in % (index 0 = Sunday) used to adjust each day; zeros when the channel has no pattern yet. */
  dow: number[];
  seasonal: { index: number[]; days: number[]; years: number };
  trust: "Good" | "Fair" | "Low";
  daysUsed: number;
  removed: { bfcm: number; outlier: number };
  /** First and last day the fit used. */
  from: string;
  to: string;
}

/** The same labels the New Customer model shows next to its R². */
export function trustOf(r2: number): "Good" | "Fair" | "Low" {
  return r2 >= 0.5 ? "Good" : r2 >= 0.25 ? "Fair" : "Low";
}

/** Fits the channel's model on its days up to `asOf`. Null with fewer than 60 usable days that have both ad spend and revenue, or when revenue does not rise with spend. */
export function fitChannelModel(days: Map<string, { revenue: number; adSpend: number }>, asOf: string): ChannelModel | null {
  const points: DayPoint[] = [...days]
    .filter(([date]) => date <= asOf)
    .map(([date, d]) => ({ date, spend: d.adSpend, newRevenue: d.revenue }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  const shares = weekdayShares(days, asOf);
  const dow = shares ? shares.map((s) => (s - 1) * 100) : [0, 0, 0, 0, 0, 0, 0];
  const fit = fitNewCustomerModel(points, dow, { kind: "revenue", guard: 1, outliers: "bucket" });
  if (!fit) return null;
  const dates = fit.used.map((p) => p.date).sort();
  return {
    fit,
    dow,
    seasonal: monthlyAmerIndex(fit.used, fit.curve),
    trust: trustOf(fit.curve.r2),
    daysUsed: fit.used.length,
    removed: { bfcm: fit.dropped.filter((d) => d.reason === "bfcm").length, outlier: fit.dropped.filter((d) => d.reason === "outlier").length },
    from: dates[0],
    to: dates[dates.length - 1],
  };
}

/** The channel's revenue for a month at a planned ad spend on the channel. With no spend it is the line's base (what sells with no ads of its own). */
export function modelRevenue(m: ChannelModel, monthlyAdSpend: number, month: string): number {
  const days = Number(endOfMonth(month).slice(8, 10));
  const season = m.seasonal.index[Number(month.slice(5, 7)) - 1] ?? 1;
  if (!(monthlyAdSpend > 0)) return m.fit.curve.kind === "revenue" ? Math.max(0, m.fit.curve.a) * days * season : 0;
  return monthlyAdSpend * curveAmer(m.fit.curve, monthlyAdSpend / days) * season;
}

/**
 * The channel's own ad spend per day lately: the average over the days that have sales in the 90 days ending on the channel's last day.
 * Dividing by the days that have data (not by 90) keeps a channel loaded late, or started recently, from looking half as big.
 * Null with fewer than 28 such days: too little to call a pace.
 */
export function recentAdSpendPace(days: Map<string, { adSpend: number }>, windowDays = 90, minDays = 28): number | null {
  let last: string | null = null;
  for (const d of days.keys()) if (last === null || d > last) last = d;
  if (last === null) return null;
  const from = addDays(last, -(windowDays - 1));
  let sum = 0;
  let n = 0;
  for (const [d, v] of days) {
    if (d < from || d > last) continue;
    sum += Number.isFinite(v.adSpend) && v.adSpend > 0 ? v.adSpend : 0;
    n += 1;
  }
  return n >= minDays ? sum / n : null;
}

export interface PlanFillInput {
  months: PlanMonth[];
  /** The channel's key. */
  channel: string;
  model: ChannelModel;
  /** Last day with own-site data: months that ended by then are closed and left alone. */
  lastData: string;
  /** Own-site ad spend per day over the days the model was fitted on: saved with the forecast as the spend it assumed. */
  siteDaily: number;
  /** `recentAdSpendPace`, for a month with no planned ad spend on the channel. Null = leave such months empty. */
  paceDaily: number | null;
  /** Also refill months that already have a forecast. Off by default: a number typed by hand is never replaced without asking. */
  replaceTyped: boolean;
}

export interface PlanFill {
  /** The new line per month (first day of the month) to write into the plan. */
  lines: Record<string, OtherLine>;
  filled: string[];
  /** Months left as they were because they already had a forecast. */
  keptTyped: string[];
  /** Months left empty: no planned ad spend and no pace to use instead. */
  noSpend: string[];
  /** Filled months whose ad spend is the recent pace, not a planned number. */
  paced: string[];
}

/**
 * Writes a channel's forecast into the open months of a plan from its model: each month's revenue is what the model gives at the month's
 * planned ad spend on the channel (or the recent pace when none is typed), and the own-site ad spend of the fitted days is saved as the
 * spend the forecast assumed, so the halo only moves it for the difference. Closed, locked and unstarted months are never touched.
 */
export function planFill({ months, channel, model, lastData, siteDaily, paceDaily, replaceTyped }: PlanFillInput): PlanFill {
  const out: PlanFill = { lines: {}, filled: [], keptTyped: [], noSpend: [], paced: [] };
  for (const m of months) {
    if (!m.inputs || m.locked || endOfMonth(m.month) <= lastData) continue;
    const existing = m.inputs.other?.[channel] ?? {};
    const typedRevenue = existing.revenue !== null && existing.revenue !== undefined && Number.isFinite(Number(existing.revenue));
    if (typedRevenue && !replaceTyped) {
      out.keptTyped.push(m.month);
      continue;
    }
    const days = Number(endOfMonth(m.month).slice(8, 10));
    const typedSpend = Number(existing.adSpend);
    const hasSpend = Number.isFinite(typedSpend) && typedSpend > 0;
    if (!hasSpend && paceDaily === null) {
      out.noSpend.push(m.month);
      continue;
    }
    const adSpend = hasSpend ? typedSpend : Math.round((paceDaily as number) * days);
    out.lines[m.month] = { ...existing, revenue: Math.round(modelRevenue(model, adSpend, m.month)), adSpend, assumedSpend: Math.round(siteDaily * days) };
    out.filled.push(m.month);
    if (!hasSpend) out.paced.push(m.month);
  }
  return out;
}
