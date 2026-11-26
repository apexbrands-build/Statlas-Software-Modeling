import { PLATFORMS } from "../channels";
import { addDays, diffDays, eachDay, endOfMonth, min } from "../dates";
import { factor } from "../metrics";
import { eventDays, type MarketingEvent } from "../planning/events";
import type { RoasOf } from "../planning/roas";
import { channelOf, isTestCampaign } from "../reports/paid-media";
import type { CampaignDay, ChannelKey, ClientSettings, PlanTargetDay } from "../types";

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

/** A type of a platform's spend, the way a media buyer says it. */
export function typeName(k: ChannelKey): string {
  if (k === "google_nonbrand") return "Non-brand";
  if (k === "google_brand") return "Brand";
  if (k === "google_nonbrand_returning") return "Non-brand, returning";
  if (k === "google_brand_returning") return "Brand, returning";
  return k.endsWith("_returning") ? "Returning customers" : "New customers";
}

export interface TrackerInput {
  /** A platform id of `TRACKER_PLATFORMS` (meta, google...). */
  platform: string;
  /** Any date of the month, or YYYY-MM. */
  month: string;
  /** The last day the store has data for. */
  lastData: string;
  /** Campaign days of the month and of the days before it that the share window reaches. Other platforms' rows are ignored. */
  campaigns: CampaignDay[];
  /** The plan's days of the month; empty when there is no plan. */
  plan: PlanTargetDay[];
  /** The plan's platform ROAS target per day and channel. */
  roasOf: RoasOf | null;
  settings: ClientSettings;
  events: MarketingEvent[];
  /** Days on which a campaign got new ads (Meta), with the campaign's name. */
  launches: { date: string; campaign: string }[];
  shareDays: ShareWindow;
  excludeTests: boolean;
}

/** One day of the platform, or of one campaign. */
export interface TrackerCell {
  target: number | null;
  projected: number | null;
  actual: number | null;
  delta: number | null;
  /** The day's return, read like the month's: on the spend that has a ROAS target, else on all of it. */
  roas: number | null;
  iRoas: number | null;
  roasTarget: number | null;
  iRoasTarget: number | null;
  /** Campaigns that got new ads that day (on a campaign: 1 when it did). */
  launches: number;
}

export interface TrackerDay extends TrackerCell {
  date: string;
  past: boolean;
  moments: string[];
}

/** One type of the platform's spend (Meta to new customers, Meta returning, Google non-brand, Google brand...). */
export interface TrackerChannel {
  key: ChannelKey;
  label: string;
  /** The plan's spend for this type over the month. */
  target: number | null;
  projected: number | null;
  actual: number;
  revenue: number;
  /** This type's spend so far ÷ its target so far. Its days to come are its target times this. */
  pace: number | null;
  roas: number | null;
  iRoas: number | null;
  roasTarget: number | null;
  iRoasTarget: number | null;
  days: TrackerCell[];
}

export interface TrackerCampaign {
  /** The campaign's id. Meta's existing-customer rows of a campaign (id ending in ":existing") are part of it. */
  id: string;
  name: string;
  /** The type that carries most of the campaign's spend. */
  channel: ChannelKey;
  type: string;
  /** The campaign's part of the platform's spend over the share window (for reading; the plan is split type by type). */
  share: number | null;
  /** The campaign's part of the plan: for each type, the type's target times the campaign's share of that type's spend. */
  target: number | null;
  /** What the campaign spent so far plus its part of each type's projection for the days left. */
  projected: number | null;
  actual: number;
  revenue: number;
  /** Read on the campaign's spend that has a ROAS target; on all of it when none has. */
  roas: number | null;
  iRoas: number | null;
  roasTarget: number | null;
  iRoasTarget: number | null;
  /** The campaign's own days, in the order of the tracker's days. On every day the campaigns add up to the platform. */
  days: TrackerCell[];
  /** Not a campaign: planned spend of a type that no campaign carries. */
  placeholder: boolean;
}

/** The sum of a group's campaigns. */
export interface TrackerSubtotal {
  target: number | null;
  projected: number | null;
  actual: number;
  revenue: number;
  roas: number | null;
  iRoas: number | null;
  roasTarget: number | null;
  iRoasTarget: number | null;
  days: TrackerCell[];
}

/** The campaigns that mostly spend on one type, in the tracker's order. Each campaign is in one group, with all of its spend. */
export interface TrackerGroup {
  key: ChannelKey;
  label: string;
  campaigns: TrackerCampaign[];
  /** Null when it would repeat something on the page: a group with one block, or the only group (it equals the total). */
  subtotal: TrackerSubtotal | null;
  /**
   * The group holds all of its type's spend and nothing else, so its numbers are the type's own plan and spend. False when one of its
   * campaigns also carries another type (on Meta, a prospecting campaign's reach to existing customers) or when a campaign of
   * another group carries part of this type.
   */
  matchesType: boolean;
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
  /** The return on the spend that has a ROAS target in the plan (all the spend when none has), so it can be read against the target. */
  roas: number | null;
  iRoas: number | null;
  /** What that same spend should have returned: each day's spend at its channel's target, i.e. the target at the mix really spent. */
  roasTarget: number | null;
  iRoasTarget: number | null;
  /** The return on everything the platform spent. */
  roasAll: number | null;
  iRoasAll: number | null;
  /** The part of the spend so far that has a ROAS target (1 = all of it). Null with no spend. */
  targetedShare: number | null;
  /** The types the plan holds spend for, with a ROAS target: what the plan expects the platform to bring is read on these. */
  planTypes: ChannelKey[];
  /** The ROAS the days left need on those types' planned spend, for them to make the platform revenue the plan expects for the month. */
  roasNeeded: number | null;
  /** The ROAS the plan itself expects on the days left (planned mix). */
  roasPlanLeft: number | null;
  /** The platform revenue those types made so far already covers what the plan expects for the month. */
  planMet: boolean;
  /** A day of this month has store data but is read as still to come, because the ad platform's data ends before it. */
  lateSync: boolean;
  launches: number;
  /** Spend of test campaigns in the month that was left out of the actuals (the plan's target still holds their budget). */
  testsLeftOut: number;
}

export interface Tracker {
  days: TrackerDay[];
  /** The platform's types that have a plan or spend, in the platform's order. */
  channels: TrackerChannel[];
  campaigns: TrackerCampaign[];
  /** The same campaigns under the type they mostly spend on, each group with its subtotal. */
  groups: TrackerGroup[];
  summary: TrackerSummary;
  /** The last day read as an actual: the store's last day, or the ad platform's when its sync is up to three days behind. */
  through: string;
  /** The days the campaign shares are read over. */
  shareFrom: string | null;
  shareTo: string | null;
}

const ratio = (a: number, b: number): number | null => (b > 0 ? a / b : null);
/** Meta's existing-customer rows carry the campaign's id with ":existing"; they are the same campaign. */
const campaignOf = (id: string) => id.replace(/:existing$/, "");
/** How many days the ad platform's data may trail the store's before a missing day is read as "nothing spent". */
const SYNC_LAG_DAYS = 3;

interface Return {
  spend: number;
  revenue: number;
  iRevenue: number;
  /** The same four numbers on the spend that has a ROAS target, plus what that spend should have returned at target. */
  tSpend: number;
  tRevenue: number;
  tIRevenue: number;
  expected: number;
  iExpected: number;
}
const noReturn = (): Return => ({ spend: 0, revenue: 0, iRevenue: 0, tSpend: 0, tRevenue: 0, tIRevenue: 0, expected: 0, iExpected: 0 });
/** The return to show against a target: on the targeted spend when there is any, else on all of it (with no target). */
const readReturn = (r: Return) =>
  r.tSpend > 0
    ? { roas: ratio(r.tRevenue, r.tSpend), iRoas: ratio(r.tIRevenue, r.tSpend), roasTarget: ratio(r.expected, r.tSpend), iRoasTarget: ratio(r.iExpected, r.tSpend) }
    : { roas: ratio(r.revenue, r.spend), iRoas: ratio(r.iRevenue, r.spend), roasTarget: null, iRoasTarget: null };

const NO_RETURN = { roas: null, iRoas: null, roasTarget: null, iRoasTarget: null };

export function buildTracker(input: TrackerInput): Tracker {
  const { platform, lastData, settings, roasOf } = input;
  const monthStart = `${input.month.slice(0, 7)}-01`;
  const monthEnd = endOfMonth(monthStart);
  const dates = eachDay(monthStart, monthEnd);
  const channels = trackerChannels(platform);
  const ofPlatform = input.campaigns.filter((r) => platformId(r.platform) === platform);
  const rows = input.excludeTests ? ofPlatform.filter((r) => !isTestCampaign(r, settings)) : ofPlatform;

  // The ad platform's sync can trail the store's by a day or two: those days are still to come, not days of zero spend.
  const lastRow = ofPlatform.reduce<string | null>((m, r) => (r.date <= lastData && (m === null || r.date > m) ? r.date : m), null);
  const through = lastRow !== null && lastRow < lastData && lastRow >= addDays(lastData, -SYNC_LAG_DAYS) ? lastRow : lastData;
  const isPast = (d: string) => d <= through;
  const inMonth = (d: string) => d >= monthStart && d <= monthEnd && isPast(d);
  const daysElapsed = dates.filter(isPast).length;
  const daysLeft = dates.length - daysElapsed;

  // The plan: spend per day and type. A plan that holds no spend for this platform in the month is read as "no plan" here.
  const planByDay = new Map(input.plan.filter((p) => p.date >= monthStart && p.date <= monthEnd).map((p) => [p.date, p] as const));
  const hasPlan = [...planByDay.values()].some((p) => channels.some((k) => (p.spendByChannel[k] ?? 0) > 0));
  const planOf = (d: string, k: ChannelKey): number | null => {
    const p = hasPlan ? planByDay.get(d) : undefined;
    return p ? (p.spendByChannel[k] ?? 0) : null;
  };

  // Shares: over the last days with data, each campaign's part of each type's spend. The plan is split type by type, so a brand
  // campaign only carries brand budget and a campaign for returning customers only returning budget.
  const shareTo = min(through, monthEnd);
  const shareFrom = addDays(shareTo, -(input.shareDays - 1));
  const winByType = new Map<ChannelKey, number>();
  const winByCampaign = new Map<string, Map<ChannelKey, number>>();
  let winTotal = 0;
  for (const r of rows) {
    if (r.date < shareFrom || r.date > shareTo || r.spend <= 0) continue;
    const k = channelOf(r);
    const id = campaignOf(r.campaignId);
    winByType.set(k, (winByType.get(k) ?? 0) + r.spend);
    const own = winByCampaign.get(id) ?? new Map<ChannelKey, number>();
    own.set(k, (own.get(k) ?? 0) + r.spend);
    winByCampaign.set(id, own);
    winTotal += r.spend;
  }
  const partOf = (id: string, k: ChannelKey): number => ((winByType.get(k) ?? 0) > 0 ? (winByCampaign.get(id)?.get(k) ?? 0) / (winByType.get(k) ?? 1) : 0);

  // Actuals of the month: per day, per type and per campaign.
  const dayOf = (m: Map<string, Return>, d: string): Return => {
    const have = m.get(d);
    if (have) return have;
    const fresh = noReturn();
    m.set(d, fresh);
    return fresh;
  };
  const total = noReturn();
  const totalByDay = new Map<string, Return>();
  const types = new Map<ChannelKey, { ret: Return; byDay: Map<string, Return> }>(channels.map((k) => [k, { ret: noReturn(), byDay: new Map<string, Return>() }] as const));
  const byCampaign = new Map<string, { name: string; ret: Return; byDay: Map<string, Return>; byType: Map<ChannelKey, number>; seen: Set<ChannelKey> }>();
  for (const r of rows) {
    // Rows after the month are loaded only to tell a month that is over from a late sync (the cut-off above).
    if (r.date > monthEnd) continue;
    const id = campaignOf(r.campaignId);
    const counts = inMonth(r.date);
    if (!counts && !winByCampaign.has(id)) continue;
    const c = byCampaign.get(id) ?? { name: r.campaignName, ret: noReturn(), byDay: new Map<string, Return>(), byType: new Map<ChannelKey, number>(), seen: new Set<ChannelKey>() };
    const k = channelOf(r);
    c.byType.set(k, (c.byType.get(k) ?? 0) + r.spend);
    // The types the page shows this campaign spending on: in the month so far, or in the days its share is read over.
    if (r.spend > 0 && (counts || (r.date >= shareFrom && r.date <= shareTo))) c.seen.add(k);
    if (counts) {
      const f = factor(settings, k);
      const target = roasOf?.(r.date, k) ?? null;
      const type = types.get(k);
      for (const ret of [c.ret, total, dayOf(c.byDay, r.date), dayOf(totalByDay, r.date), ...(type ? [type.ret, dayOf(type.byDay, r.date)] : [])]) {
        ret.spend += r.spend;
        ret.revenue += r.platformRevenue;
        ret.iRevenue += r.platformRevenue * f;
        if (target === null) continue;
        ret.tSpend += r.spend;
        ret.tRevenue += r.platformRevenue;
        ret.tIRevenue += r.platformRevenue * f;
        ret.expected += r.spend * target;
        ret.iExpected += r.spend * target * f;
      }
    }
    byCampaign.set(id, c);
  }
  const testsLeftOut = input.excludeTests ? ofPlatform.filter((r) => inMonth(r.date) && isTestCampaign(r, settings)).reduce((a, r) => a + r.spend, 0) : 0;

  // Each type's projection for a day to come: its target times its own pace so far. With no plan, the average of its last seven
  // days with data (fewer when the data starts later).
  const firstRow = rows.reduce<string | null>((m, r) => (m === null || r.date < m ? r.date : m), null);
  const rateFrom = addDays(through, -6);
  const rateSpan = firstRow === null ? 7 : Math.min(7, Math.max(1, diffDays(firstRow > rateFrom ? firstRow : rateFrom, through) + 1));
  const typeInfo = new Map(
    channels.map((k) => {
      const spent = types.get(k)?.ret.spend ?? 0;
      const targetSoFar = dates.filter(isPast).reduce((a, d) => a + (planOf(d, k) ?? 0), 0);
      const runRate = rows.filter((r) => r.date >= rateFrom && r.date <= through && channelOf(r) === k).reduce((a, r) => a + r.spend, 0) / rateSpan;
      return [k, { spent, pace: hasPlan ? ratio(spent, targetSoFar) : null, runRate }] as const;
    }),
  );
  const projectedOf = (d: string, k: ChannelKey): number | null => {
    const info = typeInfo.get(k);
    if (!info) return null;
    if (!hasPlan) return rows.length ? info.runRate : null;
    const p = planOf(d, k);
    if (p === null) return null;
    if (info.pace !== null) return p * info.pace;
    // No target so far for this type: the plan as it is, or what the type is spending when the plan holds nothing for it.
    return p > 0 ? p : info.spent > 0 ? info.runRate : 0;
  };

  const moments = new Map<string, string[]>();
  for (const e of input.events) for (const d of eventDays(e)) if (d >= monthStart && d <= monthEnd) moments.set(d, [...(moments.get(d) ?? []), e.name]);
  const launchesByDay = new Map<string, number>();
  const launched = new Set<string>();
  for (const l of input.launches) {
    if (l.date < monthStart || l.date > monthEnd) continue;
    launchesByDay.set(l.date, (launchesByDay.get(l.date) ?? 0) + 1);
    launched.add(`${l.date}|${l.campaign}`);
  }

  /** The days of a slice of the platform: `part(k)` is the slice's part of type k's plan, `own` its actual days. */
  const cells = (part: (k: ChannelKey) => number, own: Map<string, Return> | null, name: string | null): TrackerCell[] =>
    dates.map((d) => {
      const past = isPast(d);
      let target: number | null = null;
      let ahead: number | null = null;
      for (const k of channels) {
        const p = planOf(d, k);
        if (p !== null) target = (target ?? 0) + p * part(k);
        const x = past ? null : projectedOf(d, k);
        if (x !== null) ahead = (ahead ?? 0) + x * part(k);
      }
      const ret = own?.get(d);
      const actual = past ? (ret?.spend ?? 0) : null;
      return {
        target,
        projected: past ? actual : ahead,
        actual,
        delta: actual !== null && target !== null ? actual - target : null,
        ...(past && ret ? readReturn(ret) : NO_RETURN),
        launches: name === null ? (launchesByDay.get(d) ?? 0) : launched.has(`${d}|${name}`) ? 1 : 0,
      };
    });
  const sumOf = (list: TrackerCell[], key: "target" | "projected") => list.reduce<number | null>((a, c) => (c[key] === null ? a : (a ?? 0) + (c[key] as number)), null);

  const platformCells = cells(() => 1, totalByDay, null);
  const days: TrackerDay[] = dates.map((d, i) => ({ date: d, past: isPast(d), moments: moments.get(d) ?? [], ...platformCells[i] }));
  const projectedMonth = sumOf(platformCells, "projected");

  const typeTarget = (k: ChannelKey): number | null => roasOf?.(monthStart, k) ?? null;
  /** The return of a slice; with no spend that has a target yet, the target shown is its type's. */
  const returnOf = (ret: Return, k: ChannelKey) => {
    const r = readReturn(ret);
    const fallback = ret.tSpend > 0 ? null : typeTarget(k);
    return { roas: r.roas, iRoas: r.iRoas, roasTarget: r.roasTarget ?? fallback, iRoasTarget: r.iRoasTarget ?? (fallback === null ? null : fallback * factor(settings, k)) };
  };

  const planned = (k: ChannelKey) => dates.reduce((a, d) => a + (planOf(d, k) ?? 0), 0);
  const trackerChannelsOut: TrackerChannel[] = channels
    .filter((k) => planned(k) > 0 || (types.get(k)?.ret.spend ?? 0) > 0 || (winByType.get(k) ?? 0) > 0)
    .map((k) => {
      const type = types.get(k);
      const own = cells((x) => (x === k ? 1 : 0), type?.byDay ?? null, null).map((c) => ({ ...c, launches: 0 }));
      const ret = type?.ret ?? noReturn();
      return { key: k, label: typeName(k), target: hasPlan ? planned(k) : null, projected: sumOf(own, "projected"), actual: ret.spend, revenue: ret.revenue, pace: typeInfo.get(k)?.pace ?? null, ...returnOf(ret, k), days: own };
    });

  const raw = new Map<string, { ret: Return; byDay: Map<string, Return> }>([...byCampaign.entries()].map(([id, c]) => [id, { ret: c.ret, byDay: c.byDay }] as const));
  const real: TrackerCampaign[] = [...byCampaign.entries()]
    .map(([id, c]) => {
      const channel = [...c.byType.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? channels[0];
      const own = cells((k) => partOf(id, k), c.byDay, c.name);
      const window = [...(winByCampaign.get(id)?.values() ?? [])].reduce((a, v) => a + v, 0);
      return {
        id,
        name: c.name,
        channel,
        type: typeName(channel),
        share: winTotal > 0 ? window / winTotal : null,
        target: hasPlan ? (sumOf(own, "target") ?? 0) : null,
        projected: sumOf(own, "projected"),
        actual: c.ret.spend,
        revenue: c.ret.revenue,
        ...returnOf(c.ret, channel),
        days: own,
        placeholder: false,
      };
    })
    .filter((c) => c.actual > 0 || (c.share ?? 0) > 0)
    .sort((a, b) => (b.share ?? 0) - (a.share ?? 0) || b.actual - a.actual || (a.name < b.name ? -1 : 1));
  // Planned spend of a type that no campaign carries: shown as its own block, so the grid adds up and the gap is visible.
  const unassigned: TrackerCampaign[] = channels
    .filter((k) => planned(k) > 0 && !((winByType.get(k) ?? 0) > 0))
    .map((k) => {
      const own = cells((x) => (x === k ? 1 : 0), null, "");
      return { id: `none:${k}`, name: `No campaign (${typeName(k)})`, channel: k, type: typeName(k), share: null, target: sumOf(own, "target"), projected: sumOf(own, "projected"), actual: 0, revenue: 0, ...returnOf(noReturn(), k), days: own, placeholder: true };
    });

  // The campaigns under the type they mostly spend on. A subtotal adds its campaigns up, whatever types they spend on, so the
  // subtotals add up to the total and the campaigns to their subtotal.
  const campaigns = [...real, ...unassigned];
  const addInto = (into: Return, r: Return) => {
    for (const f of Object.keys(into) as (keyof Return)[]) into[f] += r[f];
  };
  const subtotalOf = (list: TrackerCampaign[], k: ChannelKey): TrackerSubtotal => {
    const sum = noReturn();
    for (const c of list) {
      const r = raw.get(c.id);
      if (r && !c.placeholder) addInto(sum, r.ret);
    }
    const own: TrackerCell[] = dates.map((d, i) => {
      const past = isPast(d);
      const day = noReturn();
      let target: number | null = null;
      let projected: number | null = null;
      let actual: number | null = past ? 0 : null;
      let launches = 0;
      for (const c of list) {
        const x = c.days[i];
        if (x.target !== null) target = (target ?? 0) + x.target;
        if (x.projected !== null) projected = (projected ?? 0) + x.projected;
        if (x.actual !== null) actual = (actual ?? 0) + x.actual;
        launches += x.launches;
        const r = c.placeholder ? undefined : raw.get(c.id)?.byDay.get(d);
        if (r) addInto(day, r);
      }
      return { target, projected, actual, delta: actual !== null && target !== null ? actual - target : null, ...(past && day.spend > 0 ? readReturn(day) : NO_RETURN), launches };
    });
    return { target: hasPlan ? (sumOf(own, "target") ?? 0) : null, projected: sumOf(own, "projected"), actual: sum.spend, revenue: sum.revenue, ...returnOf(sum, k), days: own };
  };
  const grouped = channels.map((k) => ({ k, list: campaigns.filter((c) => c.channel === k) })).filter((g) => g.list.length > 0);
  const typesOf = (c: TrackerCampaign): ChannelKey[] => (c.placeholder ? [c.channel] : [...(byCampaign.get(c.id)?.seen ?? [])]);
  const groups: TrackerGroup[] = grouped.map((g) => ({
    key: g.k,
    label: typeName(g.k),
    campaigns: g.list,
    subtotal: grouped.length > 1 && g.list.length > 1 ? subtotalOf(g.list, g.k) : null,
    matchesType: campaigns.every((c) => (c.channel === g.k ? typesOf(c).every((x) => x === g.k) : !typesOf(c).includes(g.k))),
  }));

  // What the plan expects the platform to bring: each type's spend at its ROAS target.
  let targetMonth = 0;
  let targetToDate = 0;
  let plannedRevenue = 0;
  let plannedRevenueLeft = 0;
  let plannedWithTargetLeft = 0;
  const inPlan = new Set<ChannelKey>();
  for (const d of dates) {
    for (const k of channels) {
      const p = planOf(d, k);
      if (p === null) continue;
      targetMonth += p;
      if (isPast(d)) targetToDate += p;
      const target = roasOf?.(d, k) ?? null;
      if (target === null || p <= 0) continue;
      inPlan.add(k);
      plannedRevenue += p * target;
      if (!isPast(d)) {
        plannedRevenueLeft += p * target;
        plannedWithTargetLeft += p;
      }
    }
  }

  // Like for like: what the plan expects is each planned type's spend at its target, so what was made is read on those types only.
  // A type the plan holds no spend for (campaigns for returning customers, Meta's reach to existing customers) is not counted.
  const planTypes = channels.filter((k) => inPlan.has(k));
  const madeOnPlan = planTypes.reduce((a, k) => a + (types.get(k)?.ret.tRevenue ?? 0), 0);

  const summary: TrackerSummary = {
    hasPlan,
    daysElapsed,
    daysLeft,
    targetMonth: hasPlan ? targetMonth : null,
    targetToDate: hasPlan ? targetToDate : null,
    spentToDate: total.spend,
    pace: hasPlan ? ratio(total.spend, targetToDate) : null,
    projectedMonth,
    revenueToDate: total.revenue,
    ...readReturn(total),
    roasAll: ratio(total.revenue, total.spend),
    iRoasAll: ratio(total.iRevenue, total.spend),
    targetedShare: ratio(total.tSpend, total.spend),
    planTypes,
    roasNeeded: planTypes.length > 0 && plannedWithTargetLeft > 0 ? Math.max(0, (plannedRevenue - madeOnPlan) / plannedWithTargetLeft) : null,
    roasPlanLeft: ratio(plannedRevenueLeft, plannedWithTargetLeft),
    planMet: planTypes.length > 0 && plannedRevenue > 0 && madeOnPlan >= plannedRevenue,
    lateSync: through < lastData && through < monthEnd && addDays(through, 1) >= monthStart,
    launches: [...launchesByDay.values()].reduce((a, n) => a + n, 0),
    testsLeftOut,
  };

  const hasRows = rows.length > 0;
  return { days, channels: trackerChannelsOut, campaigns, groups, summary, through, shareFrom: hasRows ? shareFrom : null, shareTo: hasRows ? shareTo : null };
}

/**
 * The last day the tracker needs campaign rows up to: the month's end. Once the month is over, up to three days past it (never past
 * the store's last day): without them a quiet month end cannot be told from a late sync.
 */
export function trackerLoadTo(month: string, lastData: string): string {
  const monthEnd = endOfMonth(`${month.slice(0, 7)}-01`);
  return lastData > monthEnd ? min(lastData, addDays(monthEnd, SYNC_LAG_DAYS)) : monthEnd;
}

/** The first day the tracker needs campaign rows from: the start of the month, or earlier when the share window reaches back. */
export function trackerLoadFrom(month: string, lastData: string, shareDays: ShareWindow = 28): string {
  const monthStart = `${month.slice(0, 7)}-01`;
  const reach = addDays(min(lastData, endOfMonth(monthStart)), -(shareDays + SYNC_LAG_DAYS - 1));
  return reach < monthStart ? reach : monthStart;
}
