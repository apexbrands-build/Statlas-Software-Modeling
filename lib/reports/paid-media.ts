import { PLATFORMS } from "../channels";
import { addDays, diffDays, startOfWeek } from "../dates";
import { div, factor } from "../metrics";
import { googleChannel } from "../sync/google-split";
import { CHANNEL_LABELS, type CampaignDay, type ChannelKey, type ClientSettings } from "../types";

export type PmGroup = "campaign" | "platform" | "type" | "day" | "week" | "month";
export const PM_GROUP_LABELS: Record<PmGroup, string> = {
  campaign: "Campaign",
  platform: "Platform",
  type: "Channel type",
  day: "Day",
  week: "Week",
  month: "Month",
};

export interface PmFilters {
  /** "all" or a platform id from lib/channels (meta, google, pinterest...). */
  platform: string;
  /** Keep only campaigns whose name contains this text (case-insensitive). */
  nameContains: string;
  /** Drop campaigns whose name contains any of these. */
  removeNames: string[];
  excludeTests: boolean;
}

const platformId = (p: string) => (p === "google_ads" ? "google" : p);

/** Which incrementality channel a campaign row belongs to (decides its multiplier and label). */
export function channelOf(c: Pick<CampaignDay, "platform" | "category" | "audience">): ChannelKey {
  const plat = PLATFORMS.find((p) => p.id === platformId(c.platform));
  if (!plat) return "meta_acquisition";
  if (plat.id === "google") return googleChannel(c.category === "brand", c.audience);
  const nonAcq = c.audience === "returning" || c.category === "retention";
  return nonAcq ? plat.nonAcquisition : plat.acquisition;
}

export function platformLabel(p: string): string {
  return PLATFORMS.find((x) => x.id === platformId(p))?.label ?? p;
}

/** Test campaigns: category test, or the name matches the Store Settings keyword / starts with / ends with. */
export function isTestCampaign(c: CampaignDay, s: ClientSettings): boolean {
  if (c.category === "test") return true;
  const n = c.campaignName.toLowerCase();
  const { testKeyword: k, testStartsWith: a, testEndsWith: z } = s.extra;
  return Boolean((k && n.includes(k.toLowerCase())) || (a && n.startsWith(a.toLowerCase())) || (z && n.endsWith(z.toLowerCase())));
}

export function filterCampaigns(rows: CampaignDay[], f: PmFilters, s: ClientSettings): CampaignDay[] {
  const must = f.nameContains.trim().toLowerCase();
  const drop = f.removeNames.map((x) => x.trim().toLowerCase()).filter(Boolean);
  return rows.filter((r) => {
    if (f.platform !== "all" && platformId(r.platform) !== f.platform) return false;
    const n = r.campaignName.toLowerCase();
    if (must && !n.includes(must)) return false;
    if (drop.some((d) => n.includes(d))) return false;
    if (f.excludeTests && isTestCampaign(r, s)) return false;
    return true;
  });
}

export interface PmStats {
  spend: number;
  platformRevenue: number;
  purchases: number;
  iRevenue: number;
  iPurchases: number;
  roas: number | null;
  iRoas: number | null;
  cpa: number | null;
  iCpa: number | null;
  aov: number | null;
}
export interface PmRow extends PmStats {
  key: string;
  label: string;
  /** Platform name shown next to the label (campaign grouping). */
  platform: string;
  shareOfSpend: number | null;
  /** Same group in the comparison period. */
  cmp: PmStats | null;
}

function stats(rows: CampaignDay[], s: ClientSettings): PmStats {
  let spend = 0, platformRevenue = 0, purchases = 0, iRevenue = 0, iPurchases = 0;
  for (const r of rows) {
    const f = factor(s, channelOf(r));
    spend += r.spend;
    platformRevenue += r.platformRevenue;
    purchases += r.platformPurchases;
    iRevenue += r.platformRevenue * f;
    iPurchases += r.platformPurchases * f;
  }
  return { spend, platformRevenue, purchases, iRevenue, iPurchases, roas: div(platformRevenue, spend), iRoas: div(iRevenue, spend), cpa: div(spend, purchases), iCpa: div(spend, iPurchases), aov: div(platformRevenue, purchases) };
}

function keyOf(r: CampaignDay, by: PmGroup): { key: string; label: string } {
  switch (by) {
    case "campaign":
      return { key: `${r.platform}|${r.campaignId}`, label: r.campaignName };
    case "platform":
      return { key: platformId(r.platform), label: platformLabel(r.platform) };
    case "type": {
      const ch = channelOf(r);
      return { key: ch, label: CHANNEL_LABELS[ch] };
    }
    case "day":
      return { key: r.date, label: r.date };
    case "week": {
      const w = startOfWeek(r.date);
      return { key: w, label: `${w} – ${addDays(w, 6)}` };
    }
    case "month":
      return { key: r.date.slice(0, 7), label: r.date.slice(0, 7) };
  }
}

const group = (rows: CampaignDay[], by: PmGroup) => {
  const m = new Map<string, { label: string; platform: string; rows: CampaignDay[] }>();
  for (const r of rows) {
    const { key, label } = keyOf(r, by);
    const g = m.get(key) ?? { label, platform: platformLabel(r.platform), rows: [] };
    g.rows.push(r);
    m.set(key, g);
  }
  return m;
};

/** Compare is only meaningful when rows are not time-based (a campaign / platform / type exists in both periods). */
export const canCompare = (by: PmGroup) => by === "campaign" || by === "platform" || by === "type";

export function buildPaidMedia(cur: CampaignDay[], cmp: CampaignDay[] | null, by: PmGroup, s: ClientSettings): { rows: PmRow[]; total: PmRow } {
  const curGroups = group(cur, by);
  const cmpGroups = cmp && canCompare(by) ? group(cmp, by) : null;
  const total = stats(cur, s);
  const rows: PmRow[] = [...curGroups.entries()].map(([key, g]) => {
    const st = stats(g.rows, s);
    const c = cmpGroups?.get(key);
    return { key, label: g.label, platform: g.platform, ...st, shareOfSpend: div(st.spend, total.spend), cmp: cmpGroups ? (c ? stats(c.rows, s) : null) : null };
  });
  // Time groups read chronologically; the rest by spend, biggest first.
  if (by === "day" || by === "week" || by === "month") rows.sort((a, b) => a.key.localeCompare(b.key));
  else rows.sort((a, b) => b.spend - a.spend);
  return {
    rows,
    total: { key: "total", label: "TOTAL", platform: "", ...total, shareOfSpend: total.spend > 0 ? 1 : null, cmp: cmp && canCompare(by) ? stats(cmp, s) : null },
  };
}

/** The period right before `range` with the same length, or the same dates a year earlier. */
export function compareRange(range: { from: string; to: string }, mode: "prev" | "yoy") {
  if (mode === "yoy") return { from: addDays(range.from, -365), to: addDays(range.to, -365) };
  const len = diffDays(range.from, range.to) + 1;
  return { from: addDays(range.from, -len), to: addDays(range.from, -1) };
}
