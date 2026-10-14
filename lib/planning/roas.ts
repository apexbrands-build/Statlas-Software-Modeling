import { RETENTION_CHANNELS } from "../channels";
import { CHANNEL_KEYS, type ChannelKey, type ClientSettings, type DailyFact } from "../types";
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

/** A month's target for one channel: the typed value when it is above zero, else the suggested one. */
export function roasTarget(inputs: PlanMonthInputs | null, channel: ChannelKey, factor: number): { value: number | null; manual: boolean } {
  if (!inputs) return { value: null, manual: false };
  const typed = inputs.roas?.[channel];
  if (typed !== undefined && Number.isFinite(typed) && typed > 0) return { value: typed, manual: true };
  return { value: suggestedRoas(inputs.amer, factor), manual: false };
}

/** Platform ROAS targets per month (key YYYY-MM) and channel. */
export type MonthRoasTargets = Record<string, Partial<Record<ChannelKey, number>>>;

export function planRoasTargets(months: PlanMonth[], settings: ClientSettings): MonthRoasTargets {
  const channels = roasChannels(settings, months);
  const out: MonthRoasTargets = {};
  for (const m of months) {
    if (!m.inputs) continue;
    const row: Partial<Record<ChannelKey, number>> = {};
    for (const k of channels) {
      const v = roasTarget(m.inputs, k, settings.multipliers[k] ?? 1).value;
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
