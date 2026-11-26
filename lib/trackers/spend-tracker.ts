import { PLATFORMS } from "../channels";
import { addDays, eachDay, endOfMonth, min } from "../dates";
import { factor } from "../metrics";
import { eventDays, type MarketingEvent } from "../planning/events";
import type { RoasOf } from "../planning/roas";
import { channelOf, isTestCampaign } from "../reports/paid-media";
import { CHANNEL_LABELS, type CampaignDay, type ChannelKey, type ClientSettings, type PlanTargetDay } from "../types";

/**
 * The spend tracker of one ad platform for one month: what the plan expected each day, what was spent, where the month is heading at
 * the pace so far, how much of it each campaign carries, and the return against target. The method is the channel tracker of the
 * operating model in `docs/superpowers/specs/2026-11-26-ctc-operating-model-notes.md`; design in `2026-11-27-slice2-trackers-design.md`.
 */

export type ShareWindow = 7 | 14 | 28;
export const SHARE_WINDOWS: ShareWindow[] = [7, 14, 28];

export interface TrackerPlatform {
  id: string;
  label: string;
  /** The report's slug in the library. */
  slug: string;
  channels: ChannelKey[];
}

const SLUGS: Record<string, string> = { meta: "facebook-tracker" };

/** One tracker per ad platform. Google's holds its campaigns for returning customers too. */
export const TRACKER_PLATFORMS: TrackerPlatform[] = PLATFORMS.filter((p) => !p.returningOnly).map((p) => ({
  id: p.id,
  label: p.label,
  slug: SLUGS[p.id] ?? `${p.id}-tracker`,
  channels: [p.acquisition, p.nonAcquisition, ...PLATFORMS.filter((r) => r.returningOnly && r.id.startsWith(`${p.id}_`)).flatMap((r) => [r.acquisition, r.nonAcquisition])],
}));

export const trackerChannels = (platform: string): ChannelKey[] => TRACKER_PLATFORMS.find((p) => p.id === platform)?.channels ?? [];
export const trackerOfSlug = (slug: string): TrackerPlatform | null => TRACKER_PLATFORMS.find((p) => p.slug === slug) ?? null;

const platformId = (p: string) => (p === "google_ads" ? "google" : p);

export interface TrackerInput {
  /** A platform id of `TRACKER_PLATFORMS` (meta, google...). */
  platform: string;
  /** Any date of the month, or YYYY-MM. */
  month: string;
  /** The last day the store has data for. Days up to it are read as actuals. */
  lastData: string;
  /** Campaign days of the month and of the days before it that the share window reaches. Other platforms' rows are ignored. */
  campaigns: CampaignDay[];
  /** The plan's days of the month; empty when there is no plan. */
  plan: PlanTargetDay[];
  /** The plan's platform ROAS target per day and channel. */
  roasOf: RoasOf | null;
  settings: ClientSettings;
  events: MarketingEvent[];
  /** Days on which new ads went live (Meta). */
  launches: { date: string; campaign: string }[];
  shareDays: ShareWindow;
  excludeTests: boolean;
  /** A picked campaign: the day table shows its own days. */
  campaignId: string | null;
}

export interface TrackerDay {
  date: string;
  past: boolean;
  moments: string[];
  launches: number;
  target: number | null;
  projected: number | null;
  actual: number | null;
  delta: number | null;
}

export interface TrackerCampaign {
  id: string;
  name: string;
  /** The channel that carries most of the campaign's spend. */
  channel: ChannelKey;
  type: string;
  share: number | null;
  target: number | null;
  projected: number | null;
  actual: number;
  revenue: number;
  roas: number | null;
  iRoas: number | null;
  roasTarget: number | null;
}

export interface TrackerSummary {
  hasPlan: boolean;
  daysElapsed: number;
  daysLeft: number;
  targetMonth: number | null;
  targetToDate: number | null;
  spentToDate: number;
  /** Spent so far ÷ target so far. */
  pace: number | null;
  projectedMonth: number | null;
  revenueToDate: number;
  roas: number | null;
  iRoas: number | null;
  roasTarget: number | null;
  iRoasTarget: number | null;
  /** The platform ROAS the days left need for the month to make its planned platform revenue. */
  roasNeeded: number | null;
  launches: number;
}

export interface Tracker {
  days: TrackerDay[];
  campaigns: TrackerCampaign[];
  summary: TrackerSummary;
  /** The days the campaign shares are read over. */
  shareFrom: string | null;
  shareTo: string | null;
  /** The picked campaign's name, when the day table shows one campaign. */
  picked: string | null;
}

const ratio = (a: number, b: number): number | null => (b > 0 ? a / b : null);

export function buildTracker(input: TrackerInput): Tracker {
  const { platform, lastData, settings, roasOf } = input;
  const monthStart = `${input.month.slice(0, 7)}-01`;
  const monthEnd = endOfMonth(monthStart);
  const dates = eachDay(monthStart, monthEnd);
  const channels = trackerChannels(platform);
  const rows = input.campaigns.filter((r) => platformId(r.platform) === platform && !(input.excludeTests && isTestCampaign(r, settings)));
  const isPast = (d: string) => d <= lastData;

  // Campaign shares: each campaign's part of the platform's spend over the last days with data.
  const shareTo = min(lastData, monthEnd);
  const shareFrom = addDays(shareTo, -(input.shareDays - 1));
  const windowSpend = new Map<string, number>();
  let windowTotal = 0;
  for (const r of rows) {
    if (r.date < shareFrom || r.date > shareTo) continue;
    windowSpend.set(r.campaignId, (windowSpend.get(r.campaignId) ?? 0) + r.spend);
    windowTotal += r.spend;
  }
  const shareOf = (id: string): number | null => (windowTotal > 0 ? (windowSpend.get(id) ?? 0) / windowTotal : null);

  // The plan, per day: spend of the platform's channels, and the platform revenue that spend is planned to bring at its ROAS target.
  // A plan that holds no spend for this platform in the month is read as "no plan" here: a target of zero would be noise.
  const planByDay = new Map(input.plan.filter((p) => p.date >= monthStart && p.date <= monthEnd).map((p) => [p.date, p] as const));
  const hasPlan = [...planByDay.values()].some((p) => channels.some((k) => (p.spendByChannel[k] ?? 0) > 0));
  const planOf = (d: string) => {
    const p = hasPlan ? planByDay.get(d) : undefined;
    if (!p) return null;
    let spend = 0;
    let withTarget = 0;
    let revenue = 0;
    let iRevenue = 0;
    for (const k of channels) {
      const s = p.spendByChannel[k] ?? 0;
      spend += s;
      const target = roasOf?.(d, k) ?? null;
      if (target === null || s <= 0) continue;
      withTarget += s;
      revenue += s * target;
      iRevenue += s * target * factor(settings, k);
    }
    return { spend, withTarget, revenue, iRevenue };
  };

  // Actuals of the month, per day and per campaign.
  const actualByDay = new Map<string, number>();
  const byCampaign = new Map<string, { name: string; spend: number; revenue: number; iRevenue: number; byDay: Map<string, number>; byChannel: Map<ChannelKey, number> }>();
  let revenueToDate = 0;
  let iRevenueToDate = 0;
  for (const r of rows) {
    const inMonth = r.date >= monthStart && r.date <= monthEnd && isPast(r.date);
    if (!inMonth && !windowSpend.has(r.campaignId)) continue;
    const c = byCampaign.get(r.campaignId) ?? { name: r.campaignName, spend: 0, revenue: 0, iRevenue: 0, byDay: new Map<string, number>(), byChannel: new Map<ChannelKey, number>() };
    c.name = r.campaignName;
    const channel = channelOf(r);
    c.byChannel.set(channel, (c.byChannel.get(channel) ?? 0) + r.spend);
    if (inMonth) {
      c.spend += r.spend;
      c.revenue += r.platformRevenue;
      c.iRevenue += r.platformRevenue * factor(settings, channel);
      c.byDay.set(r.date, (c.byDay.get(r.date) ?? 0) + r.spend);
      actualByDay.set(r.date, (actualByDay.get(r.date) ?? 0) + r.spend);
      revenueToDate += r.platformRevenue;
      iRevenueToDate += r.platformRevenue * factor(settings, channel);
    }
    byCampaign.set(r.campaignId, c);
  }

  let targetMonth = 0;
  let targetToDate = 0;
  let targetLeft = 0;
  let spentToDate = 0;
  let plannedRevenue = 0;
  let plannedRevenueToDate = 0;
  let plannedIRevenueToDate = 0;
  let plannedWithTargetToDate = 0;
  let anyRoasTarget = false;
  for (const d of dates) {
    const p = planOf(d);
    if (isPast(d)) spentToDate += actualByDay.get(d) ?? 0;
    if (!p) continue;
    targetMonth += p.spend;
    plannedRevenue += p.revenue;
    if (p.withTarget > 0) anyRoasTarget = true;
    if (isPast(d)) {
      targetToDate += p.spend;
      plannedRevenueToDate += p.revenue;
      plannedIRevenueToDate += p.iRevenue;
      plannedWithTargetToDate += p.withTarget;
    } else targetLeft += p.spend;
  }
  const pace = hasPlan ? ratio(spentToDate, targetToDate) : null;

  // With no plan, the days to come run at the average of the last seven days with data.
  let runRate: number | null = null;
  if (!hasPlan) {
    const from = addDays(lastData, -6);
    const last7 = rows.filter((r) => r.date >= from && r.date <= lastData);
    runRate = last7.length ? last7.reduce((a, r) => a + r.spend, 0) / 7 : null;
  }

  const pickedShare = input.campaignId ? shareOf(input.campaignId) : null;
  const picked = input.campaignId ? (byCampaign.get(input.campaignId) ?? null) : null;
  const scale = (v: number | null): number | null => (input.campaignId ? (v === null || pickedShare === null ? null : v * pickedShare) : v);

  const moments = new Map<string, string[]>();
  for (const e of input.events) for (const d of eventDays(e)) if (d >= monthStart && d <= monthEnd) moments.set(d, [...(moments.get(d) ?? []), e.name]);
  const launchesByDay = new Map<string, number>();
  for (const l of input.launches) if (l.date >= monthStart && l.date <= monthEnd) launchesByDay.set(l.date, (launchesByDay.get(l.date) ?? 0) + 1);

  let projectedMonth: number | null = null;
  const days: TrackerDay[] = dates.map((d) => {
    const past = isPast(d);
    const p = planOf(d);
    const platformActual = past ? (actualByDay.get(d) ?? 0) : null;
    const platformProjected = past ? platformActual : hasPlan ? (p ? p.spend * (pace ?? 1) : null) : runRate;
    if (platformProjected !== null) projectedMonth = (projectedMonth ?? 0) + platformProjected;
    const target = scale(p ? p.spend : null);
    const actual = past ? (input.campaignId ? (picked?.byDay.get(d) ?? 0) : platformActual) : null;
    const projected = past ? actual : scale(platformProjected);
    return { date: d, past, moments: moments.get(d) ?? [], launches: launchesByDay.get(d) ?? 0, target, projected, actual, delta: actual !== null && target !== null ? actual - target : null };
  });

  const month: number | null = projectedMonth;
  const campaigns: TrackerCampaign[] = [...byCampaign.entries()]
    .map(([id, c]) => {
      const share = shareOf(id);
      const channel = [...c.byChannel.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? channels[0];
      return {
        id,
        name: c.name,
        channel,
        type: CHANNEL_LABELS[channel] ?? channel,
        share,
        target: hasPlan && share !== null ? targetMonth * share : null,
        projected: month !== null && share !== null ? month * share : null,
        actual: c.spend,
        revenue: c.revenue,
        roas: ratio(c.revenue, c.spend),
        iRoas: ratio(c.iRevenue, c.spend),
        roasTarget: roasOf?.(monthStart, channel) ?? null,
      };
    })
    .filter((c) => c.actual > 0 || (c.share ?? 0) > 0)
    .sort((a, b) => (b.share ?? 0) - (a.share ?? 0) || b.actual - a.actual || (a.name < b.name ? -1 : 1));

  const daysElapsed = dates.filter(isPast).length;
  const summary: TrackerSummary = {
    hasPlan,
    daysElapsed,
    daysLeft: dates.length - daysElapsed,
    targetMonth: hasPlan ? targetMonth : null,
    targetToDate: hasPlan ? targetToDate : null,
    spentToDate,
    pace,
    projectedMonth: month,
    revenueToDate,
    roas: ratio(revenueToDate, spentToDate),
    iRoas: ratio(iRevenueToDate, spentToDate),
    roasTarget: ratio(plannedRevenueToDate, plannedWithTargetToDate),
    iRoasTarget: ratio(plannedIRevenueToDate, plannedWithTargetToDate),
    roasNeeded: anyRoasTarget && targetLeft > 0 ? Math.max(0, (plannedRevenue - revenueToDate) / targetLeft) : null,
    launches: [...launchesByDay.values()].reduce((a, n) => a + n, 0),
  };

  return { days, campaigns, summary, shareFrom: windowTotal > 0 || rows.length ? shareFrom : null, shareTo: windowTotal > 0 || rows.length ? shareTo : null, picked: picked?.name ?? null };
}

/** The first day the tracker needs campaign rows from: the start of the month, or earlier when the share window reaches back. */
export function trackerLoadFrom(month: string, lastData: string, shareDays: ShareWindow = 28): string {
  const monthStart = `${month.slice(0, 7)}-01`;
  const reach = addDays(min(lastData, endOfMonth(monthStart)), -(shareDays - 1));
  return reach < monthStart ? reach : monthStart;
}
