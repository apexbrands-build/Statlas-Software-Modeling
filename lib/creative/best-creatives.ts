/**
 * Best Creatives: one Meta ad at a time against the account's own average. Pure arithmetic on already aggregated ad rows
 * (`aggregate.ts` builds them from ad-days, the SQL of migration 0014 mirrors it).
 */
import { addDays, diffDays, type Range } from "../dates";
import type { Format } from "../format";
import { cmParts, compare, div, orderRevenue, type Direction, type Tone, type Totals } from "../metrics";
import { metaWindows } from "../sync/meta-windows";
import type { ClientSettings, ExtraSettings } from "../types";
import type { AdFormat } from "./types";

/** Spend and revenue of one rolling 7-day window. */
export interface Window2 {
  spend: number;
  revenue: number;
}

/** One ad over the chosen range. `cur` and `prev` are the two rolling 7-day windows (they may start before the range). */
export interface AdAgg {
  adId: string;
  name: string;
  campaignName: string | null;
  format: AdFormat;
  isCatalog: boolean;
  status: string | null;
  /** Meta creation date, null when Meta did not describe the ad. */
  launched: string | null;
  firstSpend: string;
  lastSpend: string;
  /** Days with spend in the range. */
  activeDays: number;
  spend: number;
  revenue: number;
  purchases: number;
  impressions: number;
  clicks: number;
  cur: Window2;
  prev: Window2;
}

export interface FormatTotals {
  format: AdFormat;
  /** Ads that spent. */
  ads: number;
  spend: number;
  revenue: number;
  purchases: number;
  impressions: number;
  clicks: number;
  cur: Window2;
  prev: Window2;
}

export type CreativeTotals = Omit<FormatTotals, "format">;

export function sumFormats(rows: FormatTotals[]): CreativeTotals {
  const t: CreativeTotals = { ads: 0, spend: 0, revenue: 0, purchases: 0, impressions: 0, clicks: 0, cur: { spend: 0, revenue: 0 }, prev: { spend: 0, revenue: 0 } };
  for (const r of rows) {
    t.ads += r.ads;
    t.spend += r.spend;
    t.revenue += r.revenue;
    t.purchases += r.purchases;
    t.impressions += r.impressions;
    t.clicks += r.clicks;
    t.cur = { spend: t.cur.spend + r.cur.spend, revenue: t.cur.revenue + r.cur.revenue };
    t.prev = { spend: t.prev.spend + r.prev.spend, revenue: t.prev.revenue + r.prev.revenue };
  }
  return t;
}

/** The store's margin before ad spend, (CM + ad spend) / order revenue, for the same dates; null when the store had no order revenue. */
export function storeMargin(t: Totals, s: ClientSettings): number | null {
  const p = cmParts(t, s);
  return div(p.cm + p.adSpend, orderRevenue(t));
}

export type CreativeMetric = "spend" | "revenue" | "roas" | "purchases" | "cpa" | "ctr" | "cpm" | "estCm" | "share";

export const CREATIVE_METRICS: Record<CreativeMetric, { label: string; format: Format; direction: Direction | "none" }> = {
  spend: { label: "Spend", format: "currency0", direction: "up" },
  revenue: { label: "Revenue", format: "currency0", direction: "up" },
  roas: { label: "ROAS", format: "ratio2", direction: "up" },
  purchases: { label: "Purchases", format: "number", direction: "up" },
  cpa: { label: "CPA", format: "currency2", direction: "down" },
  ctr: { label: "CTR", format: "percent1", direction: "up" },
  cpm: { label: "CPM", format: "currency2", direction: "down" },
  estCm: { label: "Est. CM", format: "currency0", direction: "up" },
  share: { label: "Share of spend", format: "percent1", direction: "none" },
};

/** Revenue x store margin - spend: a stand-in for the ad's CM (Meta cannot know it); null without a margin. */
const estCmOf = (revenue: number, spend: number, margin: number | null) => (margin === null ? null : revenue * margin - spend);
const perThousand = (spend: number, impressions: number) => {
  const v = div(spend, impressions);
  return v === null ? null : v * 1000;
};

export function adMetrics(a: AdAgg, t: CreativeTotals, margin: number | null): Record<CreativeMetric, number | null> {
  return {
    spend: a.spend,
    revenue: a.revenue,
    roas: div(a.revenue, a.spend),
    purchases: a.purchases,
    cpa: div(a.spend, a.purchases),
    ctr: div(a.clicks, a.impressions),
    cpm: perThousand(a.spend, a.impressions),
    estCm: estCmOf(a.revenue, a.spend, margin),
    share: div(a.spend, t.spend) ?? 0,
  };
}

/** The account for the period: ratios of the totals, amounts averaged over the ads that spent. Everything null without such ads. */
export function benchmark(t: CreativeTotals, margin: number | null): Record<CreativeMetric, number | null> {
  if (t.ads <= 0) return { spend: null, revenue: null, roas: null, purchases: null, cpa: null, ctr: null, cpm: null, estCm: null, share: null };
  const est = estCmOf(t.revenue, t.spend, margin);
  return {
    spend: t.spend / t.ads,
    revenue: t.revenue / t.ads,
    roas: div(t.revenue, t.spend),
    purchases: t.purchases / t.ads,
    cpa: div(t.spend, t.purchases),
    ctr: div(t.clicks, t.impressions),
    cpm: perThousand(t.spend, t.impressions),
    estCm: est === null ? null : est / t.ads,
    share: null,
  };
}

/** Grey within 10% of the account's figure, green or red beyond it by the metric's direction; share of spend has no colour. */
export function metricTone(m: CreativeMetric, v: number | null, bench: Record<CreativeMetric, number | null>): Tone {
  const dir = CREATIVE_METRICS[m].direction;
  return dir === "none" ? "neutral" : compare(v, bench[m], dir).tone;
}

/** Two rolling 7-day windows ending on the anchor (the earlier of the range end and the last day with ad data); null without any ad data. */
export interface WowWindows {
  cur: Range;
  prev: Range;
}

export function wowWindows(rangeTo: string, lastAdDate: string | null): WowWindows | null {
  if (!lastAdDate) return null;
  const anchor = rangeTo < lastAdDate ? rangeTo : lastAdDate;
  return { cur: { from: addDays(anchor, -6), to: anchor }, prev: { from: addDays(anchor, -13), to: addDays(anchor, -7) } };
}

/** Current window's spend against the previous one's, as a fraction; null when there was no spend before. */
export function wowChange(a: AdAgg): number | null {
  return a.prev.spend > 0 ? a.cur.spend / a.prev.spend - 1 : null;
}

/** Days from the launch (first spend when Meta did not say) to the last spend: a paused ad stops counting where it stopped spending. */
export function daysLive(a: AdAgg): number {
  return diffDays(a.launched ?? a.firstSpend, a.lastSpend) + 1;
}

/** "New" for an ad launched in the current window, "Stopped" when it spent in the range but not in the current window, else the change in spend. */
export function trendLabel(a: AdAgg, w: WowWindows | null): string {
  if (!w) return "–";
  if (a.launched && a.launched >= w.cur.from && a.launched <= w.cur.to) return "New";
  if (a.cur.spend <= 0) return a.spend > 0 ? "Stopped" : "–";
  const change = wowChange(a);
  if (change === null) return "–";
  const pct = Math.round(change * 100);
  return `${pct > 0 ? "+" : ""}${pct}%`;
}

/** The attribution windows the ad rows were synced with (Store Settings), for the page caption. */
export function attributionCaption(extra: ExtraSettings): string {
  const names = metaWindows(extra.fbAttrClick, extra.fbAttrView).map((w) => {
    const [n, kind] = w.split("d_");
    return `${n}-day ${kind}`;
  });
  return `Meta-reported, ${names.join(" + ")}`;
}
