import type { DailyFact, ClientSettings } from "../types";
import { addDays, endOfMonth } from "../dates";
import { aggregate, cmParts } from "../metrics";
import type { CurveKind, OptimizeFor } from "./new-customer";

/** Where a model number comes from: a recent window of the client's data, a cohort estimate, or typed by hand. */
export type Source = "last30" | "last90" | "last365" | "recommended" | "manual";
export const SOURCE_LABELS: Record<Source, string> = { last30: "Last 30 days", last90: "Last 90 days", last365: "Last 365 days", recommended: "Recommended", manual: "Manual" };
export const SOURCE_DAYS: Partial<Record<Source, number>> = { last30: 30, last90: 90, last365: 365 };

/** One month of the New Customer Model, as in the plan table of the reference tool. */
export interface NewCustomerMonth {
  optimizeFor: OptimizeFor;
  /** Monthly spend that counts toward aMER (what the strategist chose, or the optimum for `optimizeFor`). */
  spend: number;
  aov: number;
  aovSource: Source;
  newCostPct: number;
  newCostSource: Source;
  returningCostPct: number;
  returningCostSource: Source;
  /** Repeat revenue within 60 days / 365 days as a multiple of the first order. */
  ltv60Multiplier: number;
  ltv365Multiplier: number;
  /** 90-day payback. Missing in models saved before it existed: the screen then uses the recommended value or an estimate between 60 days and 1 year. */
  ltv90Multiplier?: number;
  ltvSource: Source;
  overModelPct: number;
  minCm: number;
  minCm60: number;
  minCm365: number;
  minCm90?: number;
}

export type BeyondHistory = "off" | "mild" | "standard" | "strict";
export const BEYOND_LABELS: Record<BeyondHistory, string> = { off: "Off (follow the fitted line)", mild: "Mild", standard: "Standard", strict: "Strict" };
/** Exponent of the fade: marginal return beyond the observed spend x0 is the marginal at x0 times (x0/x)^gamma. */
export const BEYOND_GAMMA: Record<BeyondHistory, number | null> = { off: null, mild: 0.5, standard: 1, strict: 2 };

export interface NewCustomerSettings {
  fitKind: CurveKind | "auto";
  /** How fast returns fade beyond the spend the client has ever run (guardrail). Missing = "standard". */
  beyondHistory?: BeyondHistory;
  /** Actualize: days from this date count `recentWeight` times as much. Null = full history, equal weight. */
  actualizeFrom: string | null;
  recentWeight: number;
  months: Record<string, NewCustomerMonth>;
}

export interface NewCustomerResults {
  fittedAt: string;
  kind: CurveKind;
  a: number;
  b: number;
  r2: number;
  daysUsed: number;
  actualizedFrom: string | null;
}

export interface ReturningSettings {
  /** Most recent cohorts that form the lift curve. */
  window: number;
  /** Actualize: months of recent data the forecast is calibrated on (0 = off). */
  calibrationMonths: number;
  seasonality: boolean;
  /** Where the AOV of repeat orders comes from: a recent window (default last 30 days) or typed. It only turns revenue into orders; it never changes returning revenue. */
  aovSource?: Source;
  /** The typed AOV, used when `aovSource` is "manual" and as the fallback when a window has no returning orders. */
  aov?: number;
}

export interface ReturningResults {
  fittedAt: string;
  calibration: number;
  r2: number | null;
  mape: number | null;
  months: { month: string; total: number; preCohort: number; knownCohorts: number; futureCohorts: number }[];
}

export type ModelKind = "new_customer" | "returning" | "event" | "creative";

export interface SavedModel<S, R> {
  settings: S;
  results: R | null;
  updatedAt: string | null;
  updatedBy: string | null;
}

/** Creative Demand model settings: how long before a calendar moment an ad counts as a moment ad, and the rule that tags moments (calendar only for now). */
export interface CreativeSettings {
  leadDays: number;
  momentRule: "calendar";
}
export const DEFAULT_CREATIVE: CreativeSettings = { leadDays: 14, momentRule: "calendar" };

export const DEFAULT_RETURNING: ReturningSettings = { window: 12, calibrationMonths: 0, seasonality: true, aovSource: "last30" };
export const DEFAULT_NEW_CUSTOMER: Omit<NewCustomerSettings, "months"> = { fitKind: "revenue", actualizeFrom: null, recentWeight: 3 };

/** One cohort acquisition month's totals (migration 0007). */
export interface CohortStat {
  month: string;
  customers: number;
  firstRevenue: number;
  rev60d: number;
  /** Repeat revenue within 90 days (the first three 30-day periods). Missing for cohorts stored before this existed. */
  rev90d?: number;
  rev365d: number;
}

/** AOV of new customers' first orders over the `days` up to `asOf`. */
export function recentNewAov(facts: DailyFact[], asOf: string, days: number): number | null {
  const from = addDays(asOf, -(days - 1));
  let rev = 0;
  let orders = 0;
  for (const f of facts) {
    if (f.date < from || f.date > asOf) continue;
    rev += f.newOrderRevenue;
    orders += f.newOrders;
  }
  return orders > 0 ? rev / orders : null;
}

/** AOV of returning customers' orders over the `days` up to `asOf`. */
export function recentReturningAov(facts: DailyFact[], asOf: string, days: number): number | null {
  const from = addDays(asOf, -(days - 1));
  let rev = 0;
  let orders = 0;
  for (const f of facts) {
    if (f.date < from || f.date > asOf) continue;
    rev += f.returningOrderRevenue;
    orders += f.returningOrders;
  }
  return orders > 0 ? rev / orders : null;
}

/** The returning AOV the model uses: the typed value when Manual, else the chosen recent window (default 30 days), else the typed value or `fallback`. */
export function resolveReturningAov(s: Pick<ReturningSettings, "aovSource" | "aov">, facts: DailyFact[], asOf: string, fallback = 0): number {
  const typed = s.aov && s.aov > 0 ? s.aov : fallback;
  if (s.aovSource === "manual") return typed;
  return recentReturningAov(facts, asOf, SOURCE_DAYS[s.aovSource ?? "last30"] ?? 30) ?? typed;
}

/**
 * Costs between order revenue and contribution before ad spend (tax, returns, COGS, cost of delivery) as % of order revenue,
 * over the `days` up to `asOf`. Uses the same CM definition as the dashboard, so model CM = new revenue x (1 - cost %) - spend.
 */
export function recentCostPct(facts: DailyFact[], asOf: string, days: number, settings: ClientSettings): number | null {
  const from = addDays(asOf, -(days - 1));
  const t = aggregate(facts.filter((f) => f.date >= from && f.date <= asOf));
  const orderRevenue = t.newOrderRevenue + t.returningOrderRevenue;
  if (orderRevenue <= 0) return null;
  const p = cmParts(t, settings);
  const cmBeforeAds = p.cm + p.adSpend;
  return Math.round((1 - cmBeforeAds / orderRevenue) * 1000) / 10;
}

/**
 * "Recommended" LTV multipliers from cohorts that have had the full time to repeat-purchase
 * (a month's cohort counts for 60 days once 60 days have passed since the month ended; same for 365).
 * Uses the most recent 12 such cohorts, weighted by first-order revenue. Null when there is no mature cohort yet.
 */
export function cohortMultipliers(stats: CohortStat[], asOf: string): { ltv60: number | null; ltv90: number | null; ltv365: number | null } {
  const mult = (horizon: number, pick: (c: CohortStat) => number | undefined) => {
    const mature = stats.filter((c) => c.firstRevenue > 0 && pick(c) !== undefined && addDays(endOfMonth(c.month), horizon) <= asOf).sort((a, b) => (a.month < b.month ? -1 : 1)).slice(-12);
    if (!mature.length) return null;
    const first = mature.reduce((a, c) => a + c.firstRevenue, 0);
    const repeat = mature.reduce((a, c) => a + (pick(c) ?? 0), 0);
    return Math.round((1 + repeat / first) * 10000) / 10000;
  };
  return { ltv60: mult(60, (c) => c.rev60d), ltv90: mult(90, (c) => c.rev90d), ltv365: mult(365, (c) => c.rev365d) };
}

/**
 * Share of total ad spend that counts toward aMER for a plan month (brand search and every platform's retention spend removed per client settings).
 * Model spend (acquisition spend) x aMER = new revenue, so total spend = model spend / this share.
 */
export function acqShare(inputs: { platformPct: Record<string, number>; altPct: Record<string, number> }, s: { excludeBrandFromAmer: boolean; excludeMetaReturningFromAmer: boolean }): number {
  const sum = Object.values(inputs.platformPct).reduce((a, b) => a + b, 0);
  if (sum <= 0) return 1;
  let excluded = 0;
  if (s.excludeBrandFromAmer) excluded += ((inputs.platformPct.google ?? 0) / sum) * ((inputs.altPct.google ?? 0) / 100);
  if (s.excludeMetaReturningFromAmer) {
    for (const [platform, pct] of Object.entries(inputs.platformPct)) if (platform !== "google") excluded += (pct / sum) * ((inputs.altPct[platform] ?? 0) / 100);
  }
  return Math.max(0.05, 1 - excluded);
}
