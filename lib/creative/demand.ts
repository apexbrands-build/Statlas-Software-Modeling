/**
 * Creative Demand arithmetic (Canon):
 * new ads = max(0, ceil((target spend - current spend x carry rate) / expected spend per new ad)).
 * Catalog ads are left out of every number: MonthAgg.spend is non-catalog, catalogSpend the catalog part.
 */
import { addDays, addMonths } from "../dates";
import type { PlanMonthInputs } from "../planning/types";
import type { LaunchedAd, MonthAgg } from "./types";

export const DEFAULT_CARRY = 0.725;
export const CARRY_MIN = 0.5;
export const CARRY_MAX = 1.1;
export const DEFAULT_SPEND_PER_AD = 295;
export const SPEND_PER_AD_RANGE: [number, number] = [192, 397];
export const MIN_MONTHS = 3;

const hasData = (m: MonthAgg) => m.spend + m.catalogSpend > 0;
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

/** Complete months (before the open month), oldest first. */
function completeMonths(months: MonthAgg[], openMonth: string): MonthAgg[] {
  return months.filter((m) => m.month < openMonth).sort((a, b) => (a.month < b.month ? -1 : 1));
}

export function monthsWithData(months: MonthAgg[]): number {
  return months.filter(hasData).length;
}

/**
 * Median of the last 3 complete months with data of carriedSpend / previous month's non-catalog spend, clamped 0.5 to 1.1.
 * Months whose previous month had no non-catalog spend are skipped. Under 3 months of data: the Canon default 0.725.
 */
export function carryRate(months: MonthAgg[], openMonth: string): { value: number; source: "account" | "defaults"; samples: number[] } {
  const complete = completeMonths(months, openMonth);
  const byMonth = new Map(complete.map((m) => [m.month, m]));
  const samples: number[] = [];
  for (let i = complete.length - 1; i >= 0 && samples.length < 3; i--) {
    const m = complete[i];
    if (!hasData(m)) continue;
    const prev = byMonth.get(addMonths(m.month, -1));
    if (!prev || !(prev.spend > 0)) continue;
    samples.unshift(m.carriedSpend / prev.spend);
  }
  if (monthsWithData(complete) < MIN_MONTHS || !samples.length) return { value: DEFAULT_CARRY, source: "defaults", samples };
  return { value: clamp(median(samples), CARRY_MIN, CARRY_MAX), source: "account", samples };
}

/**
 * Mean first-30-day spend of non-catalog ads launched between asOf - 212 and asOf - 30 (so each has its full 30 days);
 * zero-spend ads count. Under 3 months of data (or no ads): the Canon default 295. Values outside 192 to 397 are flagged, not changed.
 */
export function spendPerNewAd(
  ads: LaunchedAd[],
  asOf: string,
  monthsOfData: number,
): { value: number; source: "account" | "defaults"; count: number; outsideRange: boolean } {
  const from = addDays(asOf, -30 - 182);
  const to = addDays(asOf, -30);
  const pool = ads.filter((a) => !a.isCatalog && a.launchDate >= from && a.launchDate <= to);
  const count = pool.length;
  if (monthsOfData < MIN_MONTHS || !count) return { value: DEFAULT_SPEND_PER_AD, source: "defaults", count, outsideRange: false };
  const value = pool.reduce((s, a) => s + a.spend30, 0) / count;
  return { value, source: "account", count, outsideRange: value < SPEND_PER_AD_RANGE[0] || value > SPEND_PER_AD_RANGE[1] };
}

/** The plan month's Meta spend: spend x platformPct.meta / sum of platformPct (0 with no inputs or no shares). */
export function metaSpendOf(inputs: PlanMonthInputs | null): number {
  if (!inputs) return 0;
  const pct = inputs.platformPct ?? {};
  const sum = Object.values(pct).reduce((s, x) => s + (Number.isFinite(x) ? x : 0), 0);
  if (!(sum > 0)) return 0;
  const meta = pct.meta ?? 0;
  const v = ((inputs.spend || 0) * meta) / sum;
  return Number.isFinite(v) && v > 0 ? v : 0;
}

/** Catalog / total Meta spend over the last 3 complete months (0 when none). */
export function catalogShare(months: MonthAgg[], openMonth: string): number {
  const last = completeMonths(months, openMonth).slice(-3);
  const catalog = last.reduce((s, m) => s + m.catalogSpend, 0);
  const total = last.reduce((s, m) => s + m.spend + m.catalogSpend, 0);
  return total > 0 ? catalog / total : 0;
}

/**
 * Spend already running into `month`: previous month complete → its actual non-catalog spend; previous month is the open month → the latest
 * 30 days; previous month in the future → the plan's non-catalog Meta target for it. Where the ad-level data has nothing for that period
 * (no history, a month without a row, no recent ad days) the campaign-level Meta spend (`facts`, the source of truth) stands in and the source
 * says "facts"; only with neither is it 0.
 */
export function currentSpend(
  month: string,
  a: {
    months: MonthAgg[];
    openMonth: string;
    last30NonCatalog: number;
    planNonCatalog: Record<string, number>;
    /** Whether the ad-level history has any daily rows (so `last30NonCatalog` means something). Default true. */
    hasAdDays?: boolean;
    /** Campaign-level Meta spend by month (YYYY-MM-01) and over the latest 30 days. */
    facts?: { byMonth: Record<string, number>; last30: number };
  },
): { value: number; source: "actual" | "last30" | "plan" | "facts" } {
  const prev = addMonths(month, -1);
  if (prev < a.openMonth) {
    const row = a.months.find((m) => m.month === prev);
    if (row) return { value: row.spend, source: "actual" };
    const f = a.facts?.byMonth[prev];
    return f !== undefined ? { value: f, source: "facts" } : { value: 0, source: "actual" };
  }
  if (prev === a.openMonth) {
    if (a.hasAdDays === false && a.facts) return { value: a.facts.last30, source: "facts" };
    return { value: a.last30NonCatalog, source: "last30" };
  }
  return { value: a.planNonCatalog[prev] ?? 0, source: "plan" };
}

export function neededAds(target: number, current: number, carry: number, perAd: number): { needed: number; covered: boolean } {
  if (!(target > 0) || !(perAd > 0)) return { needed: 0, covered: false };
  const gap = target - (current > 0 ? current : 0) * (carry > 0 ? carry : 0);
  if (!(gap > 0)) return { needed: 0, covered: true };
  // tolerate float noise so 53,000 / 300 stays 177 and an exact 177.0000000001 does not become 178
  return { needed: Math.ceil(gap / perAd - 1e-9), covered: false };
}

/* ---------- The CTC Modeling page's recommendation (section 05, "How the Recommendation Works") ---------- */

/** The multiplier moves this much for each Creative Score point away from 50 (score 50 = 1.0, 0 = 1.5, 100 = 0.5). CTC gives the direction, not the coefficient. */
export const HEALTH_PER_POINT = 0.01;
export const HEALTH_MIN = 0.5;
export const HEALTH_MAX = 1.5;
/** Share of the evergreen share that counts as creative carried forward (35% evergreen = 17.5% fewer new ads). Apex calibration. */
export const EVERGREEN_CARRY_WEIGHT = 0.5;
/** Year-over-year spend change is limited to a quarter or four times, so one odd month cannot swing the number. */
export const SPEND_RATIO_MIN = 0.25;
export const SPEND_RATIO_MAX = 4;

/** Less healthy account (score under 50) = higher multiplier = more new ads; no score yet = 1. */
export function healthMultiplier(score: number | null): number {
  if (score === null || !Number.isFinite(score)) return 1;
  return clamp(1 + (50 - score) * HEALTH_PER_POINT, HEALTH_MIN, HEALTH_MAX);
}

export interface CtcRecommendation {
  /** The recommended new ads (after the sanity check). */
  ads: number;
  /** Before the sanity check. */
  fromInputs: number;
  /** Input 1: ads created in the same month last year. */
  lastYearAds: number;
  lastYearSpend: number;
  /** Input 2: planned spend this month over last year's spend that month. */
  spendRatio: number;
  /** Input 3: the Creative Score as a health multiplier. */
  health: number;
  /** Input 4: how much existing creative carries forward (1 = nothing carries). */
  carryForward: number;
  evergreenShare: number | null;
  /** The sanity check: fewest ads the spend gap needs even at the top of the Canon's spend-per-ad range. */
  floor: number;
  raisedBySanity: boolean;
}

/**
 * New ads = ads created the same month last year x planned-spend change year over year x health multiplier x (1 - carried-forward share),
 * never below what the spend gap needs at the Canon's highest spend per ad ("if last year's ad volume was clearly insufficient for the spend
 * level, adjust upward rather than anchoring to a bad baseline"). Null without last year's spend for the month (no baseline to scale).
 * `gap` = target spend minus the spend that carries over, as the Canon computes it.
 */
export function ctcRecommendation(a: { lastYearAds: number; lastYearSpend: number; targetSpend: number; score: number | null; evergreenShare: number | null; gap: number }): CtcRecommendation | null {
  if (!(a.lastYearSpend > 0) || !(a.targetSpend > 0)) return null;
  const spendRatio = clamp(a.targetSpend / a.lastYearSpend, SPEND_RATIO_MIN, SPEND_RATIO_MAX);
  const health = healthMultiplier(a.score);
  const carryForward = 1 - EVERGREEN_CARRY_WEIGHT * clamp(a.evergreenShare ?? 0, 0, 1);
  const fromInputs = Math.max(0, Math.ceil(a.lastYearAds * spendRatio * health * carryForward - 1e-9));
  const floor = a.gap > 0 ? Math.ceil(a.gap / SPEND_PER_AD_RANGE[1] - 1e-9) : 0;
  const ads = Math.max(fromInputs, floor);
  return { ads, fromInputs, lastYearAds: a.lastYearAds, lastYearSpend: a.lastYearSpend, spendRatio, health, carryForward, evergreenShare: a.evergreenShare, floor, raisedBySanity: floor > fromInputs };
}
