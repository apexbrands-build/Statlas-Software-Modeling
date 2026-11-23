import { eachDay, endOfMonth } from "../dates";
import type { OtherChannel } from "../types";
import type { MonthLine } from "./forecast";
import type { ChannelDay } from "./types";

/**
 * What Home shows for a sales channel other than the own site, and for the whole business. Reported numbers only: the one modelled
 * figure is `createdByAds` (the share of the channel's sales the halo factors credit to the own-site ads).
 * As on the own-site Home, a forecast is compared only over the days that have sales loaded.
 */

export interface ChannelViewInput {
  channel: OtherChannel;
  /** The channel's sales by day (retailers already added together). */
  days: Map<string, ChannelDay>;
  /** The channel's forecast by day (`dailyForecast`). */
  forecast: Map<string, number>;
  /** The channel's plan line per month, "YYYY-MM" -> line. */
  lines: Record<string, MonthLine>;
  from: string;
  to: string;
}

export interface ChannelView {
  key: string;
  label: string;
  /** False when no sales are loaded for the range. */
  hasData: boolean;
  /** Last day of the range with sales. */
  lastData: string | null;
  revenue: number;
  orders: number;
  units: number;
  adSpend: number;
  /** Revenue over the channel's own ad spend; null with no ad spend. */
  roas: number | null;
  /** Revenue at the channel's margin (1 - its variable cost %) minus its own ad spend. */
  contribution: number;
  /** Forecast for the days that have sales; null with no sales or no forecast. */
  forecastToDate: number | null;
  /** Forecast for the whole range; null when the plan has none for it. */
  forecastFull: number | null;
  pctToForecast: number | null;
  /** Sales so far plus the forecast of the days still to come. */
  projected: number | null;
  planAdSpendToDate: number | null;
  planContributionToDate: number | null;
  /** Modelled: sales credited to the own-site ads by the halo factors; null with no halo. */
  createdByAds: number | null;
  /** One entry per day of the range, for the chart. */
  dates: string[];
  actual: (number | null)[];
  plan: (number | null)[];
}

const marginOf = (c: OtherChannel) => 1 - Math.min(100, Math.max(0, Number.isFinite(c.costPct) ? c.costPct : 0)) / 100;
const daysIn = (key: string) => Number(endOfMonth(`${key}-01`).slice(8, 10));

export function channelView({ channel, days, forecast, lines, from, to }: ChannelViewInput): ChannelView {
  const dates = eachDay(from, to);
  const margin = marginOf(channel);
  let revenue = 0;
  let orders = 0;
  let units = 0;
  let adSpend = 0;
  let lastData: string | null = null;
  const byMonth = new Map<string, number>();
  for (const d of dates) {
    const day = days.get(d);
    if (!day) continue;
    revenue += day.revenue;
    orders += day.orders;
    units += day.units;
    adSpend += day.adSpend;
    lastData = d;
    byMonth.set(d.slice(0, 7), (byMonth.get(d.slice(0, 7)) ?? 0) + day.revenue);
  }
  const hasData = lastData !== null;
  let full = 0;
  let toDate = 0;
  let any = false;
  const elapsed = new Map<string, number>();
  for (const d of dates) {
    const f = forecast.get(d);
    if (f !== undefined) {
      any = true;
      full += f;
      if (lastData !== null && d <= lastData) toDate += f;
    }
    if (lastData !== null && d <= lastData) elapsed.set(d.slice(0, 7), (elapsed.get(d.slice(0, 7)) ?? 0) + 1);
  }
  const forecastFull = any ? full : null;
  const forecastToDate = any && hasData ? toDate : null;
  let planSpend = 0;
  let anyLine = false;
  for (const [key, n] of elapsed) {
    const l = lines[key];
    if (!l) continue;
    anyLine = true;
    planSpend += (l.adSpend / daysIn(key)) * n;
  }
  const planAdSpendToDate = anyLine && hasData ? planSpend : null;
  let created = 0;
  for (const [key, rev] of byMonth) {
    const l = lines[key];
    if (l && l.forecast !== null && l.forecast > 0 && l.created > 0) created += rev * Math.min(1, l.created / l.forecast);
  }
  return {
    key: channel.key,
    label: channel.label,
    hasData,
    lastData,
    revenue,
    orders,
    units,
    adSpend,
    roas: adSpend > 0 ? revenue / adSpend : null,
    contribution: revenue * margin - adSpend,
    forecastToDate,
    forecastFull,
    pctToForecast: forecastToDate !== null && forecastToDate > 0 ? revenue / forecastToDate : null,
    projected: hasData && forecastFull !== null ? revenue + (forecastFull - (forecastToDate ?? 0)) : null,
    planAdSpendToDate,
    planContributionToDate: forecastToDate === null ? null : forecastToDate * margin - (planAdSpendToDate ?? 0),
    createdByAds: created > 0 ? created : null,
    dates,
    actual: dates.map((d) => days.get(d)?.revenue ?? (lastData !== null && d <= lastData ? 0 : null)),
    plan: dates.map((d) => forecast.get(d) ?? null),
  };
}

/** The own site's numbers for the same range, as Home already has them. */
export interface SiteNumbers {
  revenue: number;
  spend: number;
  cm: number;
  /** The plan for the days with data; null with no plan. */
  plan: { revenue: number; spend: number; cm: number } | null;
  amer: number | null;
  /** Modelled: aMER with what the same ads create on the other channels. */
  blendedAmer: number | null;
}

export interface BusinessView {
  revenue: number;
  spend: number;
  mer: number | null;
  contribution: number;
  plan: { revenue: number; spend: number; mer: number | null; contribution: number } | null;
  rows: { key: string; label: string; actual: number; forecast: number | null; pct: number | null; share: number | null; createdByAds: number | null }[];
}

const ratio = (a: number, b: number | null) => (b !== null && b > 0 ? a / b : null);

/** The whole business: the own site plus every other channel, for what happened and for the plan. A channel with no forecast adds nothing to the plan. */
export function businessView(site: SiteNumbers, channels: ChannelView[]): BusinessView {
  const sum = (f: (c: ChannelView) => number | null) => channels.reduce((a, c) => a + (f(c) ?? 0), 0);
  const revenue = site.revenue + sum((c) => c.revenue);
  const spend = site.spend + sum((c) => c.adSpend);
  const planRevenue = site.plan ? site.plan.revenue + sum((c) => c.forecastToDate) : null;
  const planSpend = site.plan ? site.plan.spend + sum((c) => c.planAdSpendToDate) : null;
  return {
    revenue,
    spend,
    mer: ratio(revenue, spend),
    contribution: site.cm + sum((c) => c.contribution),
    plan: site.plan && planRevenue !== null && planSpend !== null ? { revenue: planRevenue, spend: planSpend, mer: ratio(planRevenue, planSpend), contribution: site.plan.cm + sum((c) => c.planContributionToDate) } : null,
    rows: [
      { key: "site", label: "Own site", actual: site.revenue, forecast: site.plan?.revenue ?? null, pct: ratio(site.revenue, site.plan?.revenue ?? null), share: ratio(site.revenue, revenue), createdByAds: null },
      ...channels.map((c) => ({ key: c.key, label: c.label, actual: c.revenue, forecast: c.forecastToDate, pct: c.pctToForecast, share: ratio(c.revenue, revenue), createdByAds: c.createdByAds })),
    ],
  };
}
