import { endOfMonth } from "../dates";
import { curveAmer, fitNewCustomerModel, monthlyAmerIndex, type DayPoint, type FitResult } from "../planning/new-customer";
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
