import { RETENTION_CHANNELS } from "../channels";
import { CHANNEL_KEYS, type ChannelKey, type ClientSettings, type DailyFact } from "../types";
import { acquisitionShares, blendedAmer, haloMix, totalFactor } from "./halo";
import { PLAN_PLATFORMS, type PlanMonth, type PlanMonthInputs } from "./types";

/** Channels that are always listed: the core of every client's media plan. */
const CORE: ChannelKey[] = ["google_nonbrand", "google_brand", "meta_acquisition"];

/** Platform ROAS target = the month's aMER divided by the channel's incrementality factor. Null when either is missing or not positive. */
export function suggestedRoas(amer: number, factor: number): number | null {
  if (!Number.isFinite(amer) || !Number.isFinite(factor) || amer <= 0 || factor <= 0) return null;
  return amer / factor;
}

/**
 * Channels that get a ROAS target: every acquisition channel and Google Brand that is core, has an incrementality factor or has planned spend.
 * The returning channels are left out: aMER is an acquisition measure.
 */
export function roasChannels(settings: ClientSettings, months: PlanMonth[]): ChannelKey[] {
  const planned = new Set<ChannelKey>();
  for (const m of months) {
    if (!m.inputs) continue;
    for (const p of PLAN_PLATFORMS) if ((m.inputs.platformPct[p.key] ?? 0) > 0) planned.add(p.main);
  }
  return CHANNEL_KEYS.filter((k) => !RETENTION_CHANNELS.includes(k) && (CORE.includes(k) || settings.multipliers[k] !== undefined || planned.has(k)));
}

/**
 * What a month's suggested targets are built on. With no halo typed: the month's aMER and each channel's incrementality factor.
 * With halo factors (Store Settings): the blended aMER (new revenue on every sales channel over aMER spend) and each channel's
 * total factor (.com + halo), so a channel that sends buyers to Amazon or stores gets a lower bar and one that does not gets a higher one.
 */
export interface RoasBasis {
  amer: number;
  factorOf: (k: ChannelKey) => number;
  /** True when a halo changes this month's numbers. */
  modelled: boolean;
  /** True when a halo factor behind them is a benchmark or an assumption. */
  benchmark: boolean;
}

export function roasBasis(inputs: PlanMonthInputs | null, settings: ClientSettings): RoasBasis {
  const factorOf = (k: ChannelKey) => totalFactor(k, settings);
  if (!inputs) return { amer: 0, factorOf, modelled: false, benchmark: false };
  const mix = haloMix(acquisitionShares(inputs, settings), settings);
  return { amer: blendedAmer(inputs.amer, mix), factorOf, modelled: mix.modelled, benchmark: mix.benchmark };
}

/** A month's target for one channel: the typed value when it is above zero, else the suggested one (`amer` defaults to the month's aMER; pass the basis's blended aMER and total factor to include the halo). */
export function roasTarget(inputs: PlanMonthInputs | null, channel: ChannelKey, factor: number, amer?: number): { value: number | null; manual: boolean } {
  if (!inputs) return { value: null, manual: false };
  const typed = inputs.roas?.[channel];
  if (typed !== undefined && Number.isFinite(typed) && typed > 0) return { value: typed, manual: true };
  return { value: suggestedRoas(amer ?? inputs.amer, factor), manual: false };
}

/** Platform ROAS targets per month (key YYYY-MM) and channel. */
export type MonthRoasTargets = Record<string, Partial<Record<ChannelKey, number>>>;

export function planRoasTargets(months: PlanMonth[], settings: ClientSettings): MonthRoasTargets {
  const channels = roasChannels(settings, months);
  const out: MonthRoasTargets = {};
  for (const m of months) {
    if (!m.inputs) continue;
    const row: Partial<Record<ChannelKey, number>> = {};
    const basis = roasBasis(m.inputs, settings);
    for (const k of channels) {
      const v = roasTarget(m.inputs, k, basis.factorOf(k), basis.amer).value;
      if (v !== null) row[k] = v;
    }
    out[m.month.slice(0, 7)] = row;
  }
  return out;
}

/** The platform ROAS target for a channel on a date (its month's target), or null. */
export type RoasOf = (date: string, channel: ChannelKey) => number | null;

export function roasOf(targets: MonthRoasTargets): RoasOf {
  return (date, channel) => targets[date.slice(0, 7)]?.[channel] ?? null;
}

/** The month's inputs with one channel's typed target set; null, zero or a negative number clears it (back to Suggested). */
export function withRoas(inputs: PlanMonthInputs, channel: ChannelKey, value: number | null): PlanMonthInputs {
  const roas = { ...(inputs.roas ?? {}) };
  if (value !== null && Number.isFinite(value) && value > 0) roas[channel] = value;
  else delete roas[channel];
  const { roas: _old, ...rest } = inputs;
  void _old;
  return Object.keys(roas).length ? { ...rest, roas } : rest;
}

/** Whether a channel's row is all suggested, all typed (every month with inputs), or a mix. */
export function rowMethod(months: PlanMonth[], channel: ChannelKey): "suggested" | "manual" | "mixed" {
  // A month with no aMER (and nothing typed) cannot have a target, so it does not count either way.
  const open = months.filter((m) => m.inputs && (m.inputs.amer > 0 || (m.inputs.roas?.[channel] ?? 0) > 0));
  const typed = open.filter((m) => (m.inputs!.roas?.[channel] ?? 0) > 0).length;
  if (typed === 0) return "suggested";
  return typed === open.length ? "manual" : "mixed";
}

/** Platform-reported ROAS a channel actually achieved over some days (revenue over spend); null with no spend. */
export function actualPlatformRoas(facts: DailyFact[], channel: ChannelKey): number | null {
  let spend = 0;
  let revenue = 0;
  for (const f of facts) {
    const c = f.channels?.[channel];
    if (!c) continue;
    spend += c.spend;
    revenue += c.platformRevenue;
  }
  return spend > 0 ? revenue / spend : null;
}

/** What a ROAS cell shows and holds: the target rounded to two decimals (so leaving a cell untouched changes nothing), or null with no target. */
export function roasCellValue(value: number | null): number | null {
  return value === null ? null : Math.round(value * 100) / 100;
}
