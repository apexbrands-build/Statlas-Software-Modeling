import { RETENTION_CHANNELS } from "../channels";
import { diffDays, endOfMonth } from "../dates";
import type { ChannelKey, ClientSettings, DailyFact, HaloCell, OtherChannel, RetailerRow } from "../types";
import { acquisitionShares, blendedAmer, cellValue, channelSpendShares, haloMix, haloOf, haloRevenue, haloSettingsOf } from "./halo";
import { acqShare } from "./models";
import { curveAmer, type Curve } from "./new-customer";
import { actualPlatformRoas } from "./roas";
import type { PlanMonthInputs } from "./types";

/**
 * The plan side of the halo layer: the revenue lines of the other sales channels (Amazon, TikTok Shop, retail), the simple
 * retail frame, what retention ads add to returning revenue, and the guardrails on the halo factors.
 */

const num = (v: unknown) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0);
/** A retailer row counts in a month once it has a launch month (YYYY-MM) that is not after it. */
const onShelf = (r: RetailerRow | undefined, key: string) => Boolean(r) && typeof r!.launchMonth === "string" && /^\d{4}-\d{2}/.test(r!.launchMonth) && r!.launchMonth.slice(0, 7) <= key;

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
    if (!onShelf(r, key) || d <= 0 || units <= 0 || price <= 0) continue;
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

/**
 * A channel's forecast at the planned spend, and the part of it the ads created. `base` is the typed line (or the retail frame),
 * `halo` what the ads create on the channel at the planned spend, `ratio` from `spendRatio`.
 * The line moves by the halo on the spend it did not assume: forecast = base + halo x (1 - ratio).
 * The typed number wins over the factor: when the factor says the ads created more than the whole line at the spend it assumed, the
 * halo is scaled down to fit (capped), so the ads are never credited with more than the channel sells and the forecast never goes negative.
 */
export function channelForecast(base: number | null, halo: number, ratio: number): { forecast: number | null; created: number; capped: boolean } {
  if (base === null || !Number.isFinite(base)) return { forecast: null, created: halo, capped: false };
  const b = Math.max(0, base);
  const atAssumed = halo * ratio;
  // A hair of tolerance, so a halo that exactly fills the line is not called capped because of rounding in the arithmetic.
  const scale = atAssumed > b * (1 + 1e-9) ? b / atAssumed : 1;
  return { forecast: Math.max(0, b + halo * scale * (1 - ratio)), created: halo * scale, capped: scale < 1 };
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
export function adCreatedReturning(
  inputs: PlanMonthInputs,
  settings: ClientSettings,
  recentFacts: DailyFact[],
): { revenue: number; byChannel: Partial<Record<ChannelKey, number>>; halo: Record<string, number>; haloRevenue: number } {
  const shares = channelSpendShares(inputs);
  const byChannel: Partial<Record<ChannelKey, number>> = {};
  const halo: Record<string, number> = {};
  let revenue = 0;
  let haloRevenue = 0;
  for (const k of RETENTION_CHANNELS) {
    const spend = num(inputs.spend) * (shares[k] ?? 0);
    if (spend <= 0) continue;
    const roas = actualPlatformRoas(recentFacts, k);
    if (roas === null || roas <= 0) continue;
    const v = spend * roas * Math.max(0, settings.multipliers[k] ?? 1);
    if (v > 0) {
      byChannel[k] = v;
      revenue += v;
    }
    // The same ads' halo on the other sales channels: kept out of the blended aMER (an acquisition measure) and shown here instead.
    for (const [key, h] of Object.entries(haloOf(k, settings))) {
      halo[key] = (halo[key] ?? 0) + spend * roas * h;
      haloRevenue += spend * roas * h;
    }
  }
  return { revenue, byChannel, halo, haloRevenue };
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

/** The brand's average net price per unit across the retailers on shelf in a month, weighted by the units each sells. Null before any launch. */
export function retailNetPrice(rows: RetailerRow[], netPct: number, month: string): number | null {
  const key = month.slice(0, 7);
  let units = 0;
  let value = 0;
  for (const r of rows ?? []) {
    const u = num(r?.doors) * num(r?.unitsPerStoreWeek);
    const price = num(r?.shelfPrice);
    if (!onShelf(r, key) || u <= 0 || price <= 0) continue;
    units += u;
    value += u * price;
  }
  return units > 0 ? (value / units) * (num(netPct) / 100) : null;
}

export interface OtherMonthLine {
  channel: OtherChannel;
  /** What is typed for the month (null = nothing usable). */
  typed: number | null;
  /** Retail only: the frame's net revenue for the month (null before any launch). */
  frame: number | null;
  /** What the forecast starts from: the typed number, else the retail frame, else nothing. */
  base: number | null;
  assumedSpend: number | null;
  /** Revenue the plan's ads create on this channel at the planned spend. */
  halo: number;
  /** The base moved by the halo on the spend it did not assume (null with no base). */
  forecast: number | null;
  /** Of the forecast, the part the ads created (never more than the forecast). */
  created: number;
  capped: boolean;
  /** Retail only: stores on shelf, and the units per store per week the ads would have to create. */
  doors: number;
  unitsPerStoreWeek: number | null;
}

export interface OtherMonth {
  /** Spend that counts toward aMER and the .com new revenue it brings (spend x aMER). */
  acqSpend: number;
  newRevenue: number;
  blendedAmer: number;
  modelled: boolean;
  benchmark: boolean;
  lines: OtherMonthLine[];
}

/**
 * Everything the plan's "Other sales channels" line shows for one month. `curve` is the fitted spend curve (null = a straight line)
 * and only matters for a line that assumed a different ad spend than the plan's.
 */
export function otherMonth(month: string, inputs: PlanMonthInputs, settings: ClientSettings, curve: Curve | null): OtherMonth {
  const acqSpend = num(inputs.spend) * acqShare(inputs, settings);
  const newRevenue = acqSpend * num(inputs.amer);
  const mix = haloMix(acquisitionShares(inputs, settings), settings);
  const days = Number(endOfMonth(month).slice(8, 10));
  const created = haloRevenue(newRevenue, mix);
  const lines = haloSettingsOf(settings).channels.map((channel): OtherMonthLine => {
    const line = inputs.other?.[channel.key] ?? {};
    const rev = Number(line.revenue);
    const typed = line.revenue !== null && line.revenue !== undefined && Number.isFinite(rev) && rev >= 0 ? rev : null;
    const assumed = Number(line.assumedSpend);
    const assumedSpend = line.assumedSpend !== null && line.assumedSpend !== undefined && Number.isFinite(assumed) && assumed >= 0 ? assumed : null;
    const retail = channel.kind === "retail" ? retailFrame(channel.retailers ?? [], channel.netPct ?? 0, month) : null;
    const frame = retail && retail.netRevenue > 0 ? retail.netRevenue : null;
    const base = typed ?? frame;
    const halo = created[channel.key] ?? 0;
    const moved = channelForecast(base, halo, spendRatio(curve, acqSpend / days, assumedSpend === null ? null : assumedSpend / days));
    const netPrice = retail ? retailNetPrice(channel.retailers ?? [], channel.netPct ?? 0, month) : null;
    return {
      channel,
      typed,
      frame,
      base,
      assumedSpend,
      halo,
      forecast: moved.forecast,
      created: moved.created,
      capped: moved.capped,
      doors: retail?.doors ?? 0,
      // Checked against the full halo, not the capped one: the check exists to show when the factor overshoots.
      unitsPerStoreWeek: retail && netPrice !== null ? adCreatedUnitsPerStoreWeek(halo, netPrice, retail.doors, retail.weeks) : null,
    };
  });
  return { acqSpend, newRevenue, blendedAmer: blendedAmer(num(inputs.amer), mix), modelled: mix.modelled, benchmark: mix.benchmark, lines };
}
