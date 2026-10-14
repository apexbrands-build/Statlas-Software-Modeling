/**
 * Best Creatives query model and the reference aggregation of ad-days into ad rows. The SQL functions of migration 0014 do the same work in the
 * database (same filters, same order, same tie-break); this version is their specification and runs the tests and the demo data.
 */
import { div } from "../metrics";
import type { AdAgg, FormatTotals, WowWindows } from "./best-creatives";
import { AD_FORMATS, type AdFormat } from "./types";

/** One ad on one day (a `meta_ad_daily` row). */
export interface AdDayRow {
  adId: string;
  date: string;
  spend: number;
  impressions: number;
  clicks: number;
  purchases: number;
  revenue: number;
}

/** What `meta_ads` says about an ad. */
export interface AdInfo {
  adId: string;
  name: string;
  campaignName: string | null;
  format: AdFormat;
  isCatalog: boolean;
  status: string | null;
  launched: string | null;
}

/** "gain" = spend in the current 7-day window minus the previous one. */
export type CreativeSort = "spend" | "revenue" | "roas" | "purchases" | "estCm" | "gain";

export interface CreativeQuery {
  from: string;
  to: string;
  windows: WowWindows | null;
  format: AdFormat | "all";
  /** Case-insensitive "contains" on the campaign name; empty = no filter. */
  campaign: string;
  catalog: "all" | "exclude" | "only";
  live: "all" | "live" | "not_live";
  sort: CreativeSort;
  /** Store margin before ads, for the estimated CM sort; null when the store had no order revenue. */
  margin: number | null;
  limit: number;
  offset: number;
}

export interface CreativePage {
  rows: AdAgg[];
  /** All ads matching the filters, not only this page. */
  total: number;
}

/** Page size 1 to 200, whole offset of at least 0, trimmed campaign text, and no estimated-CM sort without a margin. */
export function normalizeQuery(q: CreativeQuery): CreativeQuery {
  return {
    ...q,
    limit: Math.min(200, Math.max(1, Math.floor(q.limit) || 1)),
    offset: Math.max(0, Math.floor(q.offset) || 0),
    campaign: q.campaign.trim(),
    sort: q.sort === "estCm" && q.margin === null ? "spend" : q.sort,
  };
}

const blank = (adId: string, info: AdInfo | undefined): AdAgg => ({
  adId,
  name: info?.name ?? adId,
  campaignName: info?.campaignName ?? null,
  format: info?.format ?? "other",
  isCatalog: info?.isCatalog ?? false,
  status: info?.status ?? null,
  launched: info?.launched ?? null,
  firstSpend: "",
  lastSpend: "",
  activeDays: 0,
  spend: 0,
  revenue: 0,
  purchases: 0,
  impressions: 0,
  clicks: 0,
  cur: { spend: 0, revenue: 0 },
  prev: { spend: 0, revenue: 0 },
});

const sortValue = (r: AdAgg, q: CreativeQuery): number | null => {
  switch (q.sort) {
    case "spend":
      return r.spend;
    case "revenue":
      return r.revenue;
    case "purchases":
      return r.purchases;
    case "roas":
      return div(r.revenue, r.spend);
    case "estCm":
      return q.margin === null ? null : r.revenue * q.margin - r.spend;
    case "gain":
      return r.cur.spend - r.prev.spend;
  }
};

/** Ads that spent in the range, filtered, ranked (value descending, nulls last, then spend descending, then ad id) and cut to one page. */
export function aggregateAds(days: AdDayRow[], ads: AdInfo[], query: CreativeQuery): CreativePage {
  const q = normalizeQuery(query);
  const infoById = new Map(ads.map((a) => [a.adId, a]));
  const acc = new Map<string, AdAgg>();
  const activeDates = new Map<string, Set<string>>();
  const inWindow = (date: string, r: { from: string; to: string } | undefined) => Boolean(r && date >= r.from && date <= r.to);

  for (const d of days) {
    const inRange = d.date >= q.from && d.date <= q.to;
    const inCur = inWindow(d.date, q.windows?.cur);
    const inPrev = inWindow(d.date, q.windows?.prev);
    if (!inRange && !inCur && !inPrev) continue;
    let row = acc.get(d.adId);
    if (!row) {
      row = blank(d.adId, infoById.get(d.adId));
      acc.set(d.adId, row);
    }
    if (inRange) {
      row.spend += d.spend;
      row.revenue += d.revenue;
      row.purchases += d.purchases;
      row.impressions += d.impressions;
      row.clicks += d.clicks;
      if (d.spend > 0) {
        const dates = activeDates.get(d.adId) ?? new Set<string>();
        dates.add(d.date);
        activeDates.set(d.adId, dates);
        if (!row.firstSpend || d.date < row.firstSpend) row.firstSpend = d.date;
        if (!row.lastSpend || d.date > row.lastSpend) row.lastSpend = d.date;
      }
    }
    if (inCur) {
      row.cur.spend += d.spend;
      row.cur.revenue += d.revenue;
    }
    if (inPrev) {
      row.prev.spend += d.spend;
      row.prev.revenue += d.revenue;
    }
  }

  const needle = q.campaign.toLowerCase();
  const listed = [...acc.values()]
    .filter((r) => r.spend > 0)
    .map((r) => ({ ...r, activeDays: activeDates.get(r.adId)?.size ?? 0 }))
    .filter((r) => q.format === "all" || r.format === q.format)
    .filter((r) => !needle || (r.campaignName ?? "").toLowerCase().includes(needle))
    .filter((r) => q.catalog === "all" || (q.catalog === "only" ? r.isCatalog : !r.isCatalog))
    .filter((r) => q.live === "all" || (q.live === "live" ? r.status === "ACTIVE" : r.status !== "ACTIVE"));

  listed.sort((a, b) => {
    const va = sortValue(a, q);
    const vb = sortValue(b, q);
    if (va !== vb) {
      if (va === null) return 1;
      if (vb === null) return -1;
      if (va !== vb) return vb - va;
    }
    return b.spend - a.spend || (a.adId < b.adId ? -1 : a.adId > b.adId ? 1 : 0);
  });
  return { rows: listed.slice(q.offset, q.offset + q.limit), total: listed.length };
}

/** Totals per format over the range for the whole account (the query's filters do not apply); always one row per format. */
export function aggregateFormats(days: AdDayRow[], ads: AdInfo[], from: string, to: string, w: WowWindows | null): FormatTotals[] {
  const formatOf = new Map(ads.map((a) => [a.adId, a.format]));
  const out = new Map<AdFormat, FormatTotals>(AD_FORMATS.map((f) => [f, { format: f, ads: 0, spend: 0, revenue: 0, purchases: 0, impressions: 0, clicks: 0, cur: { spend: 0, revenue: 0 }, prev: { spend: 0, revenue: 0 } }]));
  const spentInRange = new Map<string, number>();
  const inWindow = (date: string, r: { from: string; to: string } | undefined) => Boolean(r && date >= r.from && date <= r.to);

  for (const d of days) {
    const t = out.get(formatOf.get(d.adId) ?? "other")!;
    if (d.date >= from && d.date <= to) {
      t.spend += d.spend;
      t.revenue += d.revenue;
      t.purchases += d.purchases;
      t.impressions += d.impressions;
      t.clicks += d.clicks;
      spentInRange.set(d.adId, (spentInRange.get(d.adId) ?? 0) + d.spend);
    }
    if (inWindow(d.date, w?.cur)) {
      t.cur.spend += d.spend;
      t.cur.revenue += d.revenue;
    }
    if (inWindow(d.date, w?.prev)) {
      t.prev.spend += d.spend;
      t.prev.revenue += d.revenue;
    }
  }
  for (const [adId, spend] of spentInRange) if (spend > 0) out.get(formatOf.get(adId) ?? "other")!.ads += 1;
  return [...out.values()];
}
