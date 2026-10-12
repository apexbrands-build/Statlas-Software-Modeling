import type { ClientSettings, StretchGoal } from "../types";
import { acqShare } from "./models";
import { evaluateSpend, type Curve, type ModelSettings } from "./new-customer";
import type { PlanMonth } from "./types";

const GRID = 200;
const BISECT = 60;
/** Total-revenue goals count as met inside this share of the goal. */
const TOLERANCE = 0.005;
const MAX_STEPS = 40;

/**
 * The monthly spend that earns `targetRevenue` of new revenue on the model, between 0 and `maxMonthlySpend`.
 * Revenue normally rises with spend; when the curve bends over (aMER line) the search stops at the spend that earns the most, so a
 * target beyond that is reported as not reached instead of being chased with spend that makes revenue fall.
 */
export function spendForRevenue(curve: Curve, s: ModelSettings, targetRevenue: number, days: number, seasonIdx: number, maxMonthlySpend: number): { spend: number; reached: boolean } {
  if (targetRevenue <= 0) return { spend: 0, reached: true };
  const rev = (spend: number) => evaluateSpend(curve, s, spend, days, seasonIdx).newRevenue;
  const at = (i: number) => (maxMonthlySpend * i) / GRID;
  let peakI = 0;
  let peakRev = 0;
  let first = -1;
  for (let i = 1; i <= GRID; i++) {
    const r = rev(at(i));
    if (r > peakRev) {
      peakRev = r;
      peakI = i;
    }
    if (first < 0 && r >= targetRevenue) first = i;
  }
  if (first < 0) return { spend: at(peakI), reached: false };
  let lo = at(first - 1);
  let hi = at(first);
  for (let k = 0; k < BISECT; k++) {
    const mid = (lo + hi) / 2;
    if (rev(mid) >= targetRevenue) hi = mid;
    else lo = mid;
  }
  return { spend: hi, reached: true };
}

export type StretchFlag = "beyond_history" | "cm_negative" | "cm_below_floor" | "amer_below_floor" | "unreachable";

export interface StretchMonthInput {
  /** First day of the month, YYYY-MM-01. */
  month: string;
  days: number;
  locked: boolean;
  /** The month's seasonality index on the New Customer model (1 = none). */
  seasonIdx: number;
  /** The month's model settings (over-model %, costs, AOV); the stretch is solved on the model as the strategist set it. */
  model: ModelSettings;
  /** New revenue the baseline plans for the month: gives the month shape of the stretch. */
  baselineNewRevenue: number;
}

export interface StretchMonth {
  month: string;
  newRevenue: number;
  /** Spend that counts toward aMER (brand and retention spend left out per the client's settings). */
  acqSpend: number;
  amer: number;
  returningRevenue: number;
  flags: StretchFlag[];
}

export interface StretchRequest {
  goal: StretchGoal;
  months: StretchMonthInput[];
  lastYearNewRevenue: number;
  lastYearTotalRevenue: number;
  curve: Curve;
  /** Spend the solver may not pass in one month (the caller uses a multiple of the highest month the client ran). */
  maxMonthlySpend: number;
  /** Returning revenue per month given new revenue per month (all months, locked ones with their baseline new revenue). Locked months should return what the plan holds. */
  returningFor: (newByMonth: Record<string, number>) => Record<string, number>;
  cmFor: (m: { month: string; newRevenue: number; returningRevenue: number; acqSpend: number }) => number;
}

export interface StretchResult {
  /** Unlocked months only; locked months keep the baseline's inputs. */
  months: StretchMonth[];
  /** Every free month hits its target within the model, and a total-revenue goal lands within half a percent. */
  reachable: boolean;
  aboveBaseline: boolean;
  /** New revenue for the whole year, locked months included. */
  annualNewRevenue: number;
  /** Steps the total-revenue search took (0 for the new-revenue goal). */
  iterations: number;
  message: string;
}

const pct = (v: number) => `${Math.round(v * 10) / 10}%`;

export function buildStretch(req: StretchRequest): StretchResult {
  const { goal, curve } = req;
  const free = req.months.filter((m) => !m.locked);
  const locked = req.months.filter((m) => m.locked);
  const baselineSum = req.months.reduce((a, m) => a + m.baselineNewRevenue, 0);
  const lockedNew = locked.reduce((a, m) => a + m.baselineNewRevenue, 0);
  const freeBase = free.reduce((a, m) => a + m.baselineNewRevenue, 0);
  const share = (m: StretchMonthInput) => (freeBase > 0 ? m.baselineNewRevenue / freeBase : 1 / free.length);
  const guardLimit = (m: StretchMonthInput) => (curve.guard ? m.days * curve.guard.s0 : Infinity);

  /** Solve every free month for an annual new revenue `annual` (locked months included in it). */
  const evaluate = (annual: number) => {
    const freeTotal = Math.max(0, annual - lockedNew);
    const solved = free.map((m) => {
      const target = freeTotal * share(m);
      const { spend, reached } = spendForRevenue(curve, m.model, target, m.days, m.seasonIdx, req.maxMonthlySpend);
      const point = evaluateSpend(curve, m.model, spend, m.days, m.seasonIdx);
      return { m, reached, spend, newRevenue: point.newRevenue };
    });
    const newByMonth: Record<string, number> = {};
    for (const m of locked) newByMonth[m.month] = m.baselineNewRevenue;
    for (const s of solved) newByMonth[s.m.month] = s.newRevenue;
    const returning = req.returningFor(newByMonth);
    const total = Object.entries(newByMonth).reduce((a, [k, v]) => a + v + (returning[k] ?? 0), 0);
    return { solved, returning, total, annual: lockedNew + solved.reduce((a, s) => a + s.newRevenue, 0) };
  };

  let iterations = 0;
  let annualGoal: number;
  let totalGoal: number | null = null;
  if (goal.metric === "newRevenueGrowth") annualGoal = req.lastYearNewRevenue * (1 + goal.value / 100);
  else {
    totalGoal = goal.metric === "totalRevenueGrowth" ? req.lastYearTotalRevenue * (1 + goal.value / 100) : goal.value;
    let lo = lockedNew;
    let hi = Math.max(lo, totalGoal);
    annualGoal = hi;
    for (let step = 0; step < MAX_STEPS; step++) {
      const mid = (lo + hi) / 2;
      iterations += 1;
      annualGoal = mid;
      const { total } = evaluate(mid);
      if (Math.abs(total - totalGoal) <= TOLERANCE * totalGoal) break;
      if (total < totalGoal) lo = mid;
      else hi = mid;
    }
  }

  const r = evaluate(annualGoal);
  const months: StretchMonth[] = r.solved.map((s) => {
    const returningRevenue = r.returning[s.m.month] ?? 0;
    const amer = s.spend > 0 ? s.newRevenue / s.spend : 0;
    const cm = req.cmFor({ month: s.m.month, newRevenue: s.newRevenue, returningRevenue, acqSpend: s.spend });
    const flags: StretchFlag[] = [];
    if (!s.reached) flags.push("unreachable");
    if (s.spend > guardLimit(s.m)) flags.push("beyond_history");
    if (cm < 0) flags.push("cm_negative");
    if (goal.cmFloor !== undefined && cm < goal.cmFloor) flags.push("cm_below_floor");
    if (goal.amerFloor !== undefined && amer < goal.amerFloor) flags.push("amer_below_floor");
    return { month: s.m.month, newRevenue: s.newRevenue, acqSpend: s.spend, amer, returningRevenue, flags };
  });

  const capped = months.filter((m) => m.flags.includes("unreachable")).length;
  const totalMissed = totalGoal !== null && Math.abs(r.total - totalGoal) > TOLERANCE * totalGoal;
  const reachable = capped === 0 && !totalMissed;
  const aboveBaseline = r.annual > baselineSum + 0.5;
  const message = !reachable
    ? `The model cannot reach this goal: ${capped} of ${months.length} months are capped at the most the model supports.`
    : !aboveBaseline
      ? "The goal is not above the baseline, so this stretch is not a stretch."
      : `Goal reached: new revenue ${pct((r.annual / baselineSum - 1) * 100)} above the baseline.`;
  return { months, reachable, aboveBaseline, annualNewRevenue: r.annual, iterations, message };
}

/**
 * The stretch's plan months: each unlocked month with a result gets the solved spend (acquisition spend back to total spend with the
 * month's acquisition share), aMER and returning revenue; everything else (rates, SG&A, platform split) and every locked or
 * unplanned month is copied from the baseline.
 */
export function stretchPlanMonths(base: PlanMonth[], stretch: StretchMonth[], settings: ClientSettings): PlanMonth[] {
  const byMonth = new Map(stretch.map((s) => [s.month, s]));
  return base.map((m) => {
    const copy: PlanMonth = structuredClone(m);
    const s = byMonth.get(m.month);
    if (!s || m.locked || !m.inputs) return copy;
    const returning = Math.round(s.returningRevenue);
    return {
      ...copy,
      status: "in_progress",
      inputs: {
        ...copy.inputs!,
        spend: Math.round(s.acqSpend / acqShare(m.inputs, settings)),
        amer: Math.round(s.amer * 10000) / 10000,
        returningRevenue: returning,
        returningModel: returning,
        returningOverride: null,
      },
    };
  });
}
