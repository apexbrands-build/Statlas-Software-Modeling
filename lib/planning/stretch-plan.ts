import { endOfMonth } from "../dates";
import { aggregate, amerSpend } from "../metrics";
import type { ClientSettings, DailyFact, PlanSeasonality, PlanTargetDay, StretchGoal } from "../types";
import type { DayMultipliers } from "./events";
import { generateMonth } from "./generate";
import { acqShare, cohortMultipliers, type CohortStat, type NewCustomerSettings, type ReturningSettings } from "./models";
import { defaultNewCustomerMonth, monthModelSettings, resolveNewCustomerMonth } from "./month-model";
import { monthlyAmerIndex } from "./new-customer";
import { fitPlanModel } from "./plan-fit";
import { forecastReturning, type CohortRow } from "./returning";
import { buildStretch, stretchPlanMonths, type StretchMonthInput, type StretchResult } from "./stretch";
import type { PlanMonth } from "./types";

export interface StretchPlanInput {
  /** Plan id written on the generated daily rows (the stretch plan's id). */
  planId: string;
  clientId: string;
  year: number;
  settings: ClientSettings;
  /** Whole store history up to `lastData`. */
  facts: DailyFact[];
  lastData: string;
  seasonality: PlanSeasonality;
  eventMults: Record<string, DayMultipliers>;
  /** The baseline's saved New Customer and Returning model settings (defaults when none were saved). */
  newSettings: NewCustomerSettings;
  retSettings: ReturningSettings;
  cohort: { available: boolean; stats: CohortStat[]; cohorts: CohortRow[] };
  baseline: { months: PlanMonth[]; rows: Record<string, PlanTargetDay[]> };
  goal: StretchGoal;
}

export type StretchPlanOutcome = { ok: false; reason: string } | { ok: true; result: StretchResult; months: PlanMonth[]; rows: Record<string, PlanTargetDay[]> };

const fail = (reason: string): StretchPlanOutcome => ({ ok: false, reason });
const NO_LAST_YEAR = "There is no revenue from last year to grow from. Use the goal \"Total revenue for the year\" and type an amount instead.";
const daysIn = (month: string) => Number(endOfMonth(month).slice(8, 10));
const addMonth = (k: string, n: number) => {
  const i = Number(k.slice(0, 4)) * 12 + Number(k.slice(5, 7)) - 1 + n;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}-01`;
};
/** Spend the solver may use in one month: ten times the most the client has ever run or planned in a month. */
const SPEND_CAP_FACTOR = 10;

/**
 * Builds a stretch plan from a baseline and one goal, on the models as the strategist saved them: months that have ended and months
 * locked in the baseline are kept; every other planned month gets the spend the New Customer Model needs for its share of the goal,
 * the returning revenue the Returning Customer Model gives for that new revenue, and the same rates, SG&A and platform split.
 */
export function planStretch(inp: StretchPlanInput): StretchPlanOutcome {
  return run(inp, false) as StretchPlanOutcome;
}

/** Whether a stretch can be built from this baseline at all, without solving one: the same checks and reasons as planStretch, much cheaper. */
export function preflightStretch(inp: Omit<StretchPlanInput, "goal" | "planId">): { ok: true } | { ok: false; reason: string } {
  const r = run({ ...inp, planId: "check", goal: { metric: "totalRevenue", value: 1 } }, true);
  return r.ok ? { ok: true } : r;
}

function run(inp: StretchPlanInput, checkOnly: boolean): StretchPlanOutcome | { ok: true; checkOnly: true } {
  const { settings, facts, lastData, year } = inp;
  const fit = fitPlanModel(facts, settings, inp.seasonality.dow, inp.newSettings);
  if (!fit) return fail("Not enough history to fit the New Customer Model (it needs about 60 days with ad spend and new-customer revenue).");
  if (!inp.cohort.available) return fail("Build the cohorts first (Models, Returning Customer Model), so the stretch can forecast returning revenue.");
  const planned = inp.baseline.months.filter((m) => m.inputs !== null).sort((a, b) => (a.month < b.month ? -1 : 1));
  if (!planned.length) return fail("The baseline has no planned months yet.");

  const lastYear = aggregate(facts.filter((f) => f.date.startsWith(`${year - 1}-`)));
  if (inp.goal.metric === "newRevenueGrowth" && lastYear.newOrderRevenue <= 0) return fail(NO_LAST_YEAR);
  if (inp.goal.metric === "totalRevenueGrowth" && lastYear.newOrderRevenue + lastYear.returningOrderRevenue <= 0) return fail(NO_LAST_YEAR);

  const byKey = new Map(planned.map((m) => [m.month, m]));
  const lastKey = planned[planned.length - 1].month;
  const closed = (key: string) => endOfMonth(key) <= lastData;
  const monthFacts = (key: string) => facts.filter((f) => f.date >= key && f.date <= endOfMonth(key));
  const cohortMult = cohortMultipliers(inp.cohort.stats, lastData);
  const mctx = { facts, lastData, settings, cohortMult };
  const seasonal = monthlyAmerIndex(fit.used, fit.curve);
  const baselineNew = (key: string) => (closed(key) ? aggregate(monthFacts(key)).newOrderRevenue : (inp.baseline.rows[key] ?? []).reduce((a, r) => a + r.newRevenue, 0));

  // Planned months, plus every month of the year that is already over even if the baseline never planned it: those count as actuals.
  const yearKeys = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}-01`);
  const keys = [...new Set([...planned.map((m) => m.month), ...yearKeys.filter((k) => closed(k))])].sort();
  const monthInputs: StretchMonthInput[] = keys.map((key) => {
    const pm = byKey.get(key);
    const saved = inp.newSettings.months[key] ?? defaultNewCustomerMonth(key, pm?.inputs ?? null, mctx, fit.recommendedOverPct);
    return {
      month: key,
      days: daysIn(key),
      locked: Boolean(pm?.locked) || closed(key),
      seasonIdx: seasonal.index[Number(key.slice(5, 7)) - 1] ?? 1,
      model: monthModelSettings(saved, resolveNewCustomerMonth(saved, mctx)),
      baselineNewRevenue: baselineNew(key),
    };
  });

  /* ---- returning revenue for a given new revenue per month ---- */
  const lastComplete = endOfMonth(`${lastData.slice(0, 7)}-01`) === lastData ? `${lastData.slice(0, 7)}-01` : addMonth(`${lastData.slice(0, 7)}-01`, -1);
  const actualReturning: Record<string, number> = {};
  const monthlyNew = new Map<string, number>();
  for (const f of facts) {
    const k = `${f.date.slice(0, 7)}-01`;
    if (k <= lastComplete) actualReturning[k] = (actualReturning[k] ?? 0) + f.returningOrderRevenue;
    monthlyNew.set(k, (monthlyNew.get(k) ?? 0) + f.newOrderRevenue);
  }
  const avgNew = [-2, -1, 0].reduce((a, n) => a + (monthlyNew.get(addMonth(lastComplete, n)) ?? 0), 0) / 3;
  const model = (newByMonth: Record<string, number>) => {
    const futureNew: Record<string, number> = {};
    for (let k = addMonth(lastComplete, 1); k <= lastKey; k = addMonth(k, 1)) futureNew[k] = newByMonth[k] ?? avgNew;
    return forecastReturning({
      cohorts: inp.cohort.cohorts,
      actualReturning,
      lastData,
      futureNew,
      from: `${Math.min(year, Number(lastData.slice(0, 4)))}-01-01`,
      to: lastKey,
      window: inp.retSettings.window,
      calibrationMonths: inp.retSettings.calibrationMonths,
      seasonality: inp.retSettings.seasonality,
    });
  };
  const baselineNewByMonth = Object.fromEntries(monthInputs.map((m) => [m.month, m.baselineNewRevenue]));
  if (!model(baselineNewByMonth)) return fail("Not enough cohort history for the Returning Customer Model (it needs at least 3 cohorts with a few months of repeat purchases).");
  if (checkOnly) return { ok: true, checkOnly: true };

  const returningFor = (newByMonth: Record<string, number>) => {
    const totals = new Map((model(newByMonth)?.months ?? []).map((m) => [m.month, m.total]));
    const out: Record<string, number> = {};
    for (const key of Object.keys(newByMonth)) {
      // Ended months are what happened; months locked in the baseline keep the revenue the baseline holds.
      if (closed(key)) out[key] = actualReturning[key] ?? aggregate(monthFacts(key)).returningOrderRevenue;
      else {
        const pm = byKey.get(key)!;
        out[key] = pm.locked ? pm.inputs!.returningRevenue : (totals.get(key) ?? 0);
      }
    }
    return out;
  };

  /* ---- CM of a stretch month: the plan's own daily rows, summed ---- */
  const rowsFor = (planId: string, pm: PlanMonth) =>
    generateMonth({
      planId,
      clientId: inp.clientId,
      month: pm.month,
      inputs: pm.inputs!,
      seasonality: inp.seasonality,
      deliveryCostPerOrder: settings.deliveryCostPerOrder,
      excludeBrandFromAmer: settings.excludeBrandFromAmer,
      excludeMetaReturningFromAmer: settings.excludeMetaReturningFromAmer,
      events: inp.eventMults,
    });
  const cmFor = (m: { month: string; newRevenue: number; returningRevenue: number; acqSpend: number }) => {
    const pm = byKey.get(m.month)!;
    const [only] = stretchPlanMonths([pm], [{ month: m.month, newRevenue: m.newRevenue, acqSpend: m.acqSpend, amer: m.acqSpend > 0 ? m.newRevenue / m.acqSpend : 0, returningRevenue: m.returningRevenue, flags: [] }], settings);
    return rowsFor(inp.planId, { ...only, locked: false }).reduce((a, r) => a + r.cm, 0);
  };

  /* ---- spend cap, goal, build ---- */
  const monthlySpend = new Map<string, number>();
  for (const f of facts) {
    const k = `${f.date.slice(0, 7)}-01`;
    monthlySpend.set(k, (monthlySpend.get(k) ?? 0) + amerSpend(aggregate([f]), settings));
  }
  const planSpend = planned.map((m) => m.inputs!.spend * acqShare(m.inputs!, settings));
  const maxMonthlySpend = SPEND_CAP_FACTOR * Math.max(1000, ...monthlySpend.values(), ...planSpend);

  const result = buildStretch({
    goal: inp.goal,
    months: monthInputs,
    lastYearNewRevenue: lastYear.newOrderRevenue,
    lastYearTotalRevenue: lastYear.newOrderRevenue + lastYear.returningOrderRevenue,
    curve: fit.curve,
    maxMonthlySpend,
    returningFor,
    cmFor,
  });

  const months = stretchPlanMonths(inp.baseline.months, result.months, settings);
  const rows: Record<string, PlanTargetDay[]> = {};
  for (const m of months) if (m.inputs) rows[m.month] = rowsFor(inp.planId, m);
  return { ok: true, result, months, rows };
}
