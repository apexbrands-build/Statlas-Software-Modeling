import { addDays, endOfMonth } from "../dates";
import { aggregate, amerSpend } from "../metrics";
import type { ClientSettings, DailyFact } from "../types";
import { acqShare, recentCostPct, recentNewAov, SOURCE_DAYS, type NewCustomerMonth, type Source } from "./models";
import { interpolate90, type ModelSettings } from "./new-customer";
import type { PlanMonthInputs } from "./types";

/** What a month of the New Customer Model needs from the client's history. */
export interface MonthModelCtx {
  facts: DailyFact[];
  lastData: string;
  settings: ClientSettings;
  /** "Recommended" LTV multipliers from mature cohorts (null = none yet). */
  cohortMult: { ltv60: number | null; ltv90: number | null; ltv365: number | null };
}

const daysIn = (month: string) => Number(endOfMonth(month).slice(8, 10));

/** A month the strategist has not touched: last-30-day AOV and costs, recommended LTV, spend from the plan (else the 90-day pace). */
export function defaultNewCustomerMonth(key: string, inputs: PlanMonthInputs | null, c: MonthModelCtx, overModelPct: number): NewCustomerMonth {
  const { facts, lastData, settings, cohortMult } = c;
  const aov = recentNewAov(facts, lastData, 30) ?? inputs?.rates.newAov ?? 0;
  const cost = recentCostPct(facts, lastData, 30, settings) ?? 30;
  const recentSpend = (() => {
    const from = addDays(lastData, -89);
    const t = aggregate(facts.filter((f) => f.date >= from && f.date <= lastData));
    return t.days ? (amerSpend(t, settings) / t.days) * daysIn(key) : 0;
  })();
  return {
    optimizeFor: "cm",
    spend: inputs ? Math.round(inputs.spend * acqShare(inputs, settings)) : Math.round(recentSpend),
    aov: Math.round(aov * 100) / 100,
    aovSource: "last30",
    newCostPct: cost,
    newCostSource: "last30",
    returningCostPct: cost,
    returningCostSource: "last30",
    ltv60Multiplier: cohortMult.ltv60 ?? 1,
    ltv365Multiplier: cohortMult.ltv365 ?? 1,
    ltv90Multiplier: cohortMult.ltv90 ?? interpolate90(cohortMult.ltv60 ?? 1, cohortMult.ltv365 ?? 1),
    ltvSource: cohortMult.ltv365 != null ? "recommended" : "manual",
    overModelPct,
    minCm: 0,
    minCm60: 0,
    minCm365: 0,
    minCm90: 0,
  };
}

/** The numbers a month actually uses, after "Last 30 days / Recommended / Manual" are resolved. */
export function resolveNewCustomerMonth(m: NewCustomerMonth, c: MonthModelCtx) {
  const { facts, lastData, settings, cohortMult } = c;
  const win = (src: Source) => SOURCE_DAYS[src];
  const aov = m.aovSource === "manual" ? m.aov : (recentNewAov(facts, lastData, win(m.aovSource) ?? 30) ?? m.aov);
  const nc = m.newCostSource === "manual" ? m.newCostPct : (recentCostPct(facts, lastData, win(m.newCostSource) ?? 30, settings) ?? m.newCostPct);
  const rc = m.returningCostSource === "manual" ? m.returningCostPct : (recentCostPct(facts, lastData, win(m.returningCostSource) ?? 30, settings) ?? m.returningCostPct);
  const m60 = m.ltvSource === "manual" ? m.ltv60Multiplier : (cohortMult.ltv60 ?? m.ltv60Multiplier);
  const m365 = m.ltvSource === "manual" ? m.ltv365Multiplier : (cohortMult.ltv365 ?? m.ltv365Multiplier);
  const m90 = m.ltvSource === "manual" ? (m.ltv90Multiplier ?? interpolate90(m60, m365)) : (cohortMult.ltv90 ?? m.ltv90Multiplier ?? interpolate90(m60, m365));
  return { aov, nc, rc, m60, m90, m365 };
}

export function monthModelSettings(m: NewCustomerMonth, e: ReturnType<typeof resolveNewCustomerMonth>): ModelSettings {
  return { newCostPct: e.nc, returningCostPct: e.rc, aov: e.aov, ltv60Multiplier: e.m60, ltv90Multiplier: e.m90, ltv365Multiplier: e.m365, overModelPct: m.overModelPct, minCm: m.minCm, minCm60: m.minCm60, minCm90: m.minCm90 ?? 0, minCm365: m.minCm365 };
}
