import { diffDays, endOfMonth } from "../dates";
import { ols } from "./new-customer";

/**
 * Returning Customer Model (retention). Method, in plain words:
 *  1. Every acquisition month is a cohort: first-order revenue F, then repeat revenue R in 30-day periods after the first order.
 *     Lift of a period = R / F.
 *  2. The expected lift for each period is the average of the most recent cohorts that have been observed that long
 *     (revenue-weighted). Past the longest observed age, the lift keeps decaying at the recent rate.
 *  3. Returning revenue of a future month = repeat revenue still coming from cohorts we already have
 *     + repeat revenue from FUTURE cohorts (the new revenue the plan expects to acquire x the same lifts)
 *     + the old "pre-cohort" (customers acquired before the history starts), which decays and is projected with a fitted decay line.
 *  4. A calendar-month index (e.g. November) is learned from past years, and a calibration factor actualizes the model:
 *     it compares what recent months really delivered with what the lifts predicted and scales the cohort part forward.
 * A 30-day period is placed half in the calendar month it starts in and half in the next (customers are acquired mid-month on average).
 */

export interface CohortRow {
  /** First day of the acquisition month. */
  month: string;
  customers: number;
  firstRevenue: number;
  /** Repeat revenue per 30-day period since the first order (index 0 = period 1). */
  periods: number[];
}

export interface ReturningInput {
  cohorts: CohortRow[];
  /** Actual returning order revenue per month (first of month -> amount). Only complete months are used. */
  actualReturning: Record<string, number>;
  lastData: string;
  /** First-order (new) revenue the plan expects per future month: these months become future cohorts. */
  futureNew: Record<string, number>;
  /** Months to output (first of month, inclusive). */
  from: string;
  to: string;
  /** How many of the most recent cohorts form the lift curve. */
  window?: number;
  /** Actualize: months of recent data used to calibrate (0 = off). */
  calibrationMonths?: number;
  seasonality?: boolean;
}

export interface ReturningMonth {
  month: string;
  kind: "actual" | "forecast";
  preCohort: number;
  knownCohorts: number;
  futureCohorts: number;
  total: number;
}

export interface ReturningResult {
  months: ReturningMonth[];
  /** Expected lift per period (index 0 = period 1), as a fraction of first-order revenue. */
  lifts: number[];
  calibration: number;
  /** Calendar-month index (1 = no effect), index 0 = January. */
  seasonIndex: number[];
  /** Fit over the last 12 complete months (model vs actual). */
  fit: { r2: number | null; mape: number | null; months: number };
  /** Last cohorts: actual lift per period (null = not observed yet), for the matrix. */
  matrix: { month: string; actual: (number | null)[] }[];
  cohortsUsed: number;
}

const PERIODS = 24;
const mIdx = (m: string) => Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) - 1;
const idxToMonth = (i: number) => `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}-01`;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Periods of a cohort that are fully observed (every customer has had the full 30 days). */
function observedPeriods(c: CohortRow, lastData: string): number {
  return Math.max(0, Math.floor(diffDays(endOfMonth(c.month), lastData) / 30));
}

export function forecastReturning(input: ReturningInput): ReturningResult | null {
  const { cohorts, actualReturning, lastData, futureNew } = input;
  const window = input.window ?? 12;
  const lastComplete = endOfMonth(`${lastData.slice(0, 7)}-01`) === lastData ? `${lastData.slice(0, 7)}-01` : idxToMonth(mIdx(lastData.slice(0, 7) + "-01") - 1);
  const lcIdx = mIdx(lastComplete);
  const usable = cohorts.filter((c) => c.firstRevenue > 0 && mIdx(c.month) <= lcIdx).sort((a, b) => (a.month < b.month ? -1 : 1));
  if (usable.length < 3) return null;

  /* ---- 2. lift curve ---- */
  const lifts: number[] = [];
  let maxObserved = 0;
  for (let p = 1; p <= PERIODS; p++) {
    const have = usable.filter((c) => observedPeriods(c, lastData) >= p).slice(-window);
    if (have.length < 2) break;
    const f = have.reduce((a, c) => a + c.firstRevenue, 0);
    const r = have.reduce((a, c) => a + (c.periods[p - 1] ?? 0), 0);
    lifts.push(r / f);
    maxObserved = p;
  }
  if (maxObserved < 2) return null;
  const tail = lifts.slice(Math.max(0, maxObserved - 5));
  const steps: number[] = [];
  for (let i = 1; i < tail.length; i++) if (tail[i - 1] > 0 && tail[i] > 0) steps.push(tail[i] / tail[i - 1]);
  const decay = clamp(steps.length ? Math.exp(steps.reduce((a, s) => a + Math.log(s), 0) / steps.length) : 0.9, 0.6, 0.98);
  while (lifts.length < PERIODS) lifts.push(lifts[lifts.length - 1] * decay);

  /* ---- 5. spreading cohorts over calendar months ---- */
  const spread = (c: { month: string }, p: number, amount: number, into: Map<number, number>) => {
    const i = mIdx(c.month) + p - 1;
    into.set(i, (into.get(i) ?? 0) + amount / 2);
    into.set(i + 1, (into.get(i + 1) ?? 0) + amount / 2);
  };

  // Actual cohort revenue per calendar month, and what the lifts alone would have predicted for the same cohorts.
  const cohortActual = new Map<number, number>();
  const cohortModelFull = new Map<number, number>();
  for (const c of usable) {
    const o = observedPeriods(c, lastData);
    for (let p = 1; p <= PERIODS; p++) {
      if (p <= o) spread(c, p, c.periods[p - 1] ?? 0, cohortActual);
      spread(c, p, c.firstRevenue * lifts[p - 1], cohortModelFull);
    }
  }

  /* ---- pre-cohort: what is left of the actual returning revenue after the cohorts ---- */
  const histMonths = Object.keys(actualReturning).filter((m) => mIdx(m) <= lcIdx).sort();
  const preActual = new Map<number, number>();
  for (const m of histMonths) preActual.set(mIdx(m), Math.max(0, actualReturning[m] - (cohortActual.get(mIdx(m)) ?? 0)));
  const recentPre = histMonths.slice(-12).map((m) => ({ i: mIdx(m), v: preActual.get(mIdx(m)) ?? 0 })).filter((x) => x.v > 0);
  let preAt: (i: number) => number;
  if (recentPre.length >= 6) {
    const f = ols(recentPre.map((x) => x.i), recentPre.map((x) => Math.log(x.v)));
    const slope = f ? Math.min(f.b, -0.005) : -0.03;
    const anchor = recentPre[recentPre.length - 1];
    const level = f ? Math.exp(f.a + f.b * anchor.i) : anchor.v;
    preAt = (i) => (i <= lcIdx && preActual.has(i) ? preActual.get(i)! : level * Math.exp(slope * (i - anchor.i)));
  } else {
    const last = recentPre.length ? recentPre[recentPre.length - 1] : { i: lcIdx, v: 0 };
    preAt = (i) => (i <= lcIdx && preActual.has(i) ? preActual.get(i)! : last.v * 0.97 ** Math.max(0, i - last.i));
  }
  const preFit = (i: number) => {
    // smooth version used only to judge the model on history
    if (recentPre.length >= 6) {
      const f = ols(recentPre.map((x) => x.i), recentPre.map((x) => Math.log(x.v)));
      if (f) return Math.exp(f.a + f.b * i);
    }
    return preActual.get(i) ?? 0;
  };

  /* ---- 4a. calendar-month index (needs a full year of history) ---- */
  const seasonIndex = Array<number>(12).fill(1);
  if (input.seasonality !== false && histMonths.length >= 12) {
    const sums = Array.from({ length: 12 }, () => ({ s: 0, n: 0 }));
    for (const m of histMonths) {
      const i = mIdx(m);
      const model = (preActual.get(i) ?? 0) + (cohortModelFull.get(i) ?? 0);
      if (model > 0 && actualReturning[m] > 0) {
        const cal = i % 12;
        sums[cal].s += actualReturning[m] / model;
        sums[cal].n += 1;
      }
    }
    sums.forEach((x, k) => {
      if (!x.n) return;
      const raw = clamp(x.s / x.n, 0.6, 2.5);
      seasonIndex[k] = x.n >= 2 ? raw : 1 + (raw - 1) * 0.5; // one observation only: trust it halfway
    });
  }

  /* ---- 4b. actualize: recent cohort revenue vs what the lifts predicted ---- */
  let calibration = 1;
  const calMonths = input.calibrationMonths ?? 0;
  if (calMonths > 0) {
    const recent = histMonths.slice(-calMonths).map(mIdx);
    const act = recent.reduce((a, i) => a + (cohortActual.get(i) ?? 0), 0);
    const mod = recent.reduce((a, i) => a + (cohortModelFull.get(i) ?? 0) * seasonIndex[i % 12], 0);
    if (mod > 0) calibration = clamp(act / mod, 0.5, 2);
  }

  /* ---- 3. forecast ---- */
  const known = new Map<number, number>();
  for (const c of usable) {
    const o = observedPeriods(c, lastData);
    for (let p = o + 1; p <= PERIODS; p++) spread(c, p, c.firstRevenue * lifts[p - 1], known);
  }
  const future = new Map<number, number>();
  for (const [m, rev] of Object.entries(futureNew)) {
    if (mIdx(m) <= lcIdx || rev <= 0) continue;
    for (let p = 1; p <= PERIODS; p++) spread({ month: m }, p, rev * lifts[p - 1], future);
  }

  const months: ReturningMonth[] = [];
  for (let i = mIdx(input.from); i <= mIdx(input.to); i++) {
    const m = idxToMonth(i);
    if (i <= lcIdx && actualReturning[m] != null) {
      months.push({ month: m, kind: "actual", preCohort: preAt(i), knownCohorts: cohortActual.get(i) ?? 0, futureCohorts: 0, total: actualReturning[m] });
      continue;
    }
    const s = seasonIndex[i % 12];
    const pre = preAt(i) * s;
    const kn = (known.get(i) ?? 0) * s * calibration;
    const fu = (future.get(i) ?? 0) * s * calibration;
    months.push({ month: m, kind: "forecast", preCohort: pre, knownCohorts: kn, futureCohorts: fu, total: pre + kn + fu });
  }

  /* ---- fit over the last 12 complete months ---- */
  const last12 = histMonths.slice(-12);
  const pairs = last12.map((m) => {
    const i = mIdx(m);
    return { a: actualReturning[m], f: (preFit(i) + (cohortModelFull.get(i) ?? 0)) * seasonIndex[i % 12] };
  });
  let r2: number | null = null;
  let mape: number | null = null;
  if (pairs.length >= 6) {
    const mean = pairs.reduce((a, p) => a + p.a, 0) / pairs.length;
    const ssTot = pairs.reduce((a, p) => a + (p.a - mean) ** 2, 0);
    const ssRes = pairs.reduce((a, p) => a + (p.a - p.f) ** 2, 0);
    r2 = ssTot > 0 ? 1 - ssRes / ssTot : null;
    mape = (pairs.reduce((a, p) => a + (p.a > 0 ? Math.abs(p.a - p.f) / p.a : 0), 0) / pairs.length) * 100;
  }

  const matrix = usable.slice(-12).map((c) => {
    const o = observedPeriods(c, lastData);
    return { month: c.month, actual: Array.from({ length: 12 }, (_, k) => (k + 1 <= o ? (c.periods[k] ?? 0) / c.firstRevenue : null)) };
  });

  return { months, lifts, calibration, seasonIndex, fit: { r2, mape, months: pairs.length }, matrix, cohortsUsed: usable.length };
}
