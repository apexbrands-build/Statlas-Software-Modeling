import { RETENTION_CHANNELS } from "../channels";
import { diffDays, endOfMonth } from "../dates";
import type { ChannelKey, ClientSettings, DailyFact, HaloCell, OtherChannel, RetailerRow } from "../types";
import { cellValue, channelSpendShares, haloSettingsOf } from "./halo";
import { curveAmer, type Curve } from "./new-customer";
import { actualPlatformRoas } from "./roas";
import type { OtherLine, PlanMonthInputs } from "./types";

/**
 * The plan side of the halo layer: the revenue lines of the other sales channels (Amazon, TikTok Shop, retail), the simple
 * retail frame, what retention ads add to returning revenue, and the guardrails on the halo factors.
 */

const num = (v: unknown) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0);

/** Weeks in a month (days / 7). */
export function weeksIn(month: string): number {
  return Number(endOfMonth(month).slice(8, 10)) / 7;
}

/**
 * Retail before any data: doors x units per store per week x weeks x shelf price is what shoppers buy (sell-through); the brand's
 * net share of it is its revenue. A retailer counts from its launch month on, and its first stocking order (pipeline fill) is added
 * once, in the launch month.
 */
export function retailFrame(rows: RetailerRow[], netPct: number, month: string): { sellThrough: number; netRevenue: number; doors: number; weeks: number } {
  const weeks = weeksIn(month);
  const key = month.slice(0, 7);
  const net = num(netPct) / 100;
  let sellThrough = 0;
  let netRevenue = 0;
  let doors = 0;
  for (const r of rows ?? []) {
    const d = num(r?.doors);
    const units = num(r?.unitsPerStoreWeek);
    const price = num(r?.shelfPrice);
    if (!r || typeof r.launchMonth !== "string" || r.launchMonth.slice(0, 7) > key || d <= 0 || units <= 0 || price <= 0) continue;
    const st = d * units * weeks * price;
    sellThrough += st;
    netRevenue += st * net + (r.launchMonth.slice(0, 7) === key ? num(r.pipelineUnits) * price * net : 0);
    doors += d;
  }
  return { sellThrough, netRevenue, doors, weeks };
}

/**
 * New revenue at the spend a forecast assumed, over new revenue at the planned spend (both per day). The halo scales with it.
 * No assumed spend typed = 1 (same spend); 0 = 0 (no ads, no halo). It follows the fitted curve, so doubling spend does not double the halo;
 * with no curve it is a straight line.
 */
export function spendRatio(curve: Curve | null, plannedDaily: number, assumedDaily: number | null | undefined): number {
  if (assumedDaily === null || assumedDaily === undefined || !Number.isFinite(assumedDaily)) return 1;
  if (assumedDaily <= 0) return 0;
  if (!(plannedDaily > 0)) return 1;
  if (!curve) return assumedDaily / plannedDaily;
  const planned = plannedDaily * curveAmer(curve, plannedDaily);
  const assumed = assumedDaily * curveAmer(curve, assumedDaily);
  return planned > 0 ? assumed / planned : assumedDaily / plannedDaily;
}

/** A channel's forecast: its typed line plus the halo on the spend that line did not assume (`ratio` from `spendRatio`). */
export function otherForecast(typed: number, haloPlanned: number, ratio: number): number {
  return typed + haloPlanned * (1 - ratio);
}

/** The halo credited to a channel can never be more than the channel sells. */
export function capHalo(halo: number, forecast: number | null): { value: number; capped: boolean } {
  if (forecast === null || !Number.isFinite(forecast) || halo <= forecast) return { value: halo, capped: false };
  return { value: Math.max(0, forecast), capped: true };
}

/** Retail sanity check: the units per store per week the ads would have to create for the retail halo to be true. Null without doors, a net price or weeks. */
export function adCreatedUnitsPerStoreWeek(haloRevenue: number, netPrice: number, doors: number, weeks: number): number | null {
  if (!(netPrice > 0) || !(doors > 0) || !(weeks > 0)) return null;
  return haloRevenue / netPrice / doors / weeks;
}

/**
 * Returning revenue that ads aimed at existing and churned customers create: each retention channel's planned spend x its platform
 * ROAS in `recentFacts` (pass the last 90 days) x its incrementality factor. Small next to rebills and repeat orders, and already
 * inside the Returning model's history at the past level of spend: this shows how much of returning revenue depends on the ads.
 */
export function adCreatedReturning(inputs: PlanMonthInputs, settings: ClientSettings, recentFacts: DailyFact[]): { revenue: number; byChannel: Partial<Record<ChannelKey, number>> } {
  const shares = channelSpendShares(inputs);
  const byChannel: Partial<Record<ChannelKey, number>> = {};
  let revenue = 0;
  for (const k of RETENTION_CHANNELS) {
    const spend = num(inputs.spend) * (shares[k] ?? 0);
    if (spend <= 0) continue;
    const roas = actualPlatformRoas(recentFacts, k);
    if (roas === null || roas <= 0) continue;
    const v = spend * roas * Math.max(0, settings.multipliers[k] ?? 1);
    if (v <= 0) continue;
    byChannel[k] = v;
    revenue += v;
  }
  return { revenue, byChannel };
}

export type HaloWarningKind = "benchmark" | "old" | "range";
export interface HaloWarning {
  channel: ChannelKey;
  salesChannel: string;
  kind: HaloWarningKind;
}

/** A factor older than this many days is flagged (about six months). */
export const HALO_MAX_AGE_DAYS = 183;
/** Planned spend further than this share from the spend a factor was measured at is flagged. */
export const HALO_RANGE = 0.3;

/**
 * What to say about the halo factors a month relies on: a benchmark or assumption instead of the client's own test, a factor measured
 * long ago, or planned spend far from the spend it was measured at (a factor is a slope that only holds near that point).
 * Only cells with a value, on an existing sales channel, for an ad channel with planned spend.
 */
export function haloWarnings(settings: ClientSettings, spendByChannel: Partial<Record<ChannelKey, number>>, today: string): HaloWarning[] {
  const { channels, cells } = haloSettingsOf(settings);
  const out: HaloWarning[] = [];
  for (const [k, row] of Object.entries(cells) as [ChannelKey, Record<string, HaloCell>][]) {
    const planned = num(spendByChannel[k]);
    if (planned <= 0 || !row) continue;
    for (const c of channels) {
      const cell = row[c.key];
      if (cellValue(cell, c) <= 0) continue;
      const add = (kind: HaloWarningKind) => out.push({ channel: k, salesChannel: c.key, kind });
      if (cell.source !== "own_test") add("benchmark");
      if (cell.measuredOn && /^\d{4}-\d{2}-\d{2}$/.test(cell.measuredOn) && diffDays(cell.measuredOn, today) > HALO_MAX_AGE_DAYS) add("old");
      const at = num(cell.measuredSpend);
      if (at > 0 && Math.abs(planned - at) / at > HALO_RANGE) add("range");
    }
  }
  return out;
}

/** The client's other sales channels with what a plan month has typed for each. Lines whose channel was deleted are left out. */
export function otherChannelsOf(inputs: PlanMonthInputs | null, settings: ClientSettings): { channel: OtherChannel; line: OtherLine }[] {
  return haloSettingsOf(settings).channels.map((channel) => ({ channel, line: inputs?.other?.[channel.key] ?? {} }));
}
