import { aggregate, aggregatePlan, amerSpend, cmParts, div, orderRevenue, planAmerSpend, totalSpend } from "../metrics";
import type { ClientSettings, DailyFact, PlanTargetDay, StretchGoal } from "../types";
import type { Curve } from "./new-customer";
import type { StretchFlag } from "./stretch";
import type { PlanMonth } from "./types";

/** One month of the Summary: the same figures for a plan and for actuals, so the two compare line by line. */
export interface MonthFigures {
  /** First day of the month, YYYY-MM-01. */
  month: string;
  /** False when the plan has no days (or there are no facts) for the month. */
  hasData: boolean;
  /** Total ad spend. */
  spend: number;
  /** Spend counted for aMER: total spend less brand search and retention spend, per the client's settings. */
  acqSpend: number;
  /** New revenue / acquisition spend; null without acquisition spend. */
  amer: number | null;
  newRevenue: number;
  returningRevenue: number;
  totalRevenue: number;
  cm: number;
  /** Operating expenses (SG&A): the plan month's fixed costs, else the client's monthly setting. */
  opex: number;
  ebitda: number;
}

const monthKey = (year: number, i: number) => `${year}-${String(i + 1).padStart(2, "0")}`;

function emptyMonth(year: number, i: number): MonthFigures {
  return { month: `${monthKey(year, i)}-01`, hasData: false, spend: 0, acqSpend: 0, amer: null, newRevenue: 0, returningRevenue: 0, totalRevenue: 0, cm: 0, opex: 0, ebitda: 0 };
}

/** Twelve months (January first) of a plan's figures, from its daily rows and its month inputs. */
export function planFigures(rows: PlanTargetDay[], months: PlanMonth[], year: number, s: ClientSettings): MonthFigures[] {
  return Array.from({ length: 12 }, (_, i) => {
    const key = monthKey(year, i);
    const mrows = rows.filter((r) => r.date.startsWith(key));
    if (!mrows.length) return emptyMonth(year, i);
    const sum = (pick: (r: PlanTargetDay) => number) => mrows.reduce((a, r) => a + pick(r), 0);
    const newRevenue = sum((r) => r.newRevenue);
    const returningRevenue = sum((r) => r.returningRevenue);
    const cm = sum((r) => r.cm);
    const acqSpend = planAmerSpend(aggregatePlan(mrows), s);
    const opex = months.find((m) => m.month.startsWith(key))?.inputs?.fixedCosts ?? s.monthlyFixedCosts;
    return { month: `${key}-01`, hasData: true, spend: sum((r) => r.spend), acqSpend, amer: div(newRevenue, acqSpend), newRevenue, returningRevenue, totalRevenue: newRevenue + returningRevenue, cm, opex, ebitda: cm - opex };
  });
}

/** Twelve months of actuals in the same shape, so CM and aMER spend are the dashboard's own. */
export function actualFigures(facts: DailyFact[], year: number, s: ClientSettings): MonthFigures[] {
  return Array.from({ length: 12 }, (_, i) => {
    const key = monthKey(year, i);
    const fs = facts.filter((f) => f.date.startsWith(key));
    if (!fs.length) return emptyMonth(year, i);
    const t = aggregate(fs);
    const cm = cmParts(t, s).cm;
    const acqSpend = amerSpend(t, s);
    const opex = s.monthlyFixedCosts;
    return { month: `${key}-01`, hasData: true, spend: totalSpend(t), acqSpend, amer: div(t.newOrderRevenue, acqSpend), newRevenue: t.newOrderRevenue, returningRevenue: t.returningOrderRevenue, totalRevenue: orderRevenue(t), cm, opex, ebitda: cm - opex };
  });
}

export type SummaryKey = "spend" | "amer" | "newRevenue" | "returningRevenue" | "totalRevenue" | "cm" | "opex" | "ebitda";

export interface SummaryCell {
  value: number | null;
  lastYear: number | null;
  /** value / lastYear - 1; null when either is missing or last year is zero. */
  yoy: number | null;
  /** Against the month before (January against last year's December). */
  mom: number | null;
  /** Share of the year; only spend and the three revenue rows have one. */
  share: number | null;
}

export interface SummaryRow {
  key: SummaryKey;
  label: string;
  format: "currency0" | "ratio2";
  months: SummaryCell[];
  total: Pick<SummaryCell, "value" | "lastYear" | "yoy">;
}

const ROWS: { key: SummaryKey; label: string; format: SummaryRow["format"]; share: boolean }[] = [
  { key: "spend", label: "Spend", format: "currency0", share: true },
  { key: "amer", label: "aMER", format: "ratio2", share: false },
  { key: "newRevenue", label: "New revenue", format: "currency0", share: true },
  { key: "returningRevenue", label: "Returning revenue", format: "currency0", share: true },
  { key: "totalRevenue", label: "Total order revenue", format: "currency0", share: true },
  { key: "cm", label: "Contribution margin", format: "currency0", share: false },
  { key: "opex", label: "Operating expenses", format: "currency0", share: false },
  { key: "ebitda", label: "EBITDA", format: "currency0", share: false },
];

const valueOf = (f: MonthFigures, key: SummaryKey): number | null => (f.hasData ? f[key] : null);
const change = (value: number | null, ref: number | null): number | null => (value === null || ref === null || ref === 0 ? null : value / ref - 1);

/** The year column: flows add up over the months in `use`; aMER is total new revenue over total acquisition spend. */
function totalOf(figs: MonthFigures[], key: SummaryKey, use: boolean[]): number | null {
  const picked = figs.filter((f, i) => use[i] && f.hasData);
  if (!picked.length) return null;
  if (key === "amer") return div(picked.reduce((a, f) => a + f.newRevenue, 0), picked.reduce((a, f) => a + f.acqSpend, 0));
  return picked.reduce((a, f) => a + f[key], 0);
}

/**
 * The Summary grid: for each row and month, the plan value, last year's actual, year over year, month over month and
 * share of the year, plus a year column. The year column compares only the months the current figures have, so a plan
 * with a few months is not set against a whole year.
 */
export function buildSummaryGrid(current: MonthFigures[], lastYear: MonthFigures[]): SummaryRow[] {
  const has = current.map((f) => f.hasData);
  return ROWS.map(({ key, label, format, share }) => {
    const total = totalOf(current, key, has);
    const lyTotal = totalOf(lastYear, key, has);
    const months = current.map((f, i): SummaryCell => {
      const value = valueOf(f, key);
      const prev = i === 0 ? valueOf(lastYear[11], key) : valueOf(current[i - 1], key);
      const ly = valueOf(lastYear[i], key);
      return { value, lastYear: ly, yoy: change(value, ly), mom: change(value, prev), share: share && value !== null && total ? value / total : null };
    });
    return { key, label, format, months, total: { value: total, lastYear: lyTotal, yoy: change(total, lyTotal) } };
  });
}

/** The warnings a saved stretch month deserves, from its figures: the same checks the stretch solver applies (it also knows "unreachable" while building). */
export function monthFlags(f: MonthFigures, goal: StretchGoal | null, curve: Curve | null, days: number): StretchFlag[] {
  if (!f.hasData) return [];
  const flags: StretchFlag[] = [];
  if (curve?.guard && f.acqSpend > days * curve.guard.s0) flags.push("beyond_history");
  if (f.cm < 0) flags.push("cm_negative");
  if (goal?.cmFloor !== undefined && f.cm < goal.cmFloor) flags.push("cm_below_floor");
  if (goal?.amerFloor !== undefined && f.amer !== null && f.amer < goal.amerFloor) flags.push("amer_below_floor");
  return flags;
}

/** A change as a whole percent with its sign ("+13%", "-10%"); a dash when there is nothing to compare, and "0%" instead of "-0%". */
export function formatChange(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return "–";
  const r = Math.round(v * 100);
  return r === 0 ? "0%" : `${r > 0 ? "+" : ""}${r}%`;
}

/**
 * The Forecast basis: actuals for months that have ended, the plan for the rest. An ended month keeps the plan's own operating
 * expenses (so EBITDA is measured the same way on both bases) and falls back to the plan when it has no actuals.
 */
export function forecastFigures(plan: MonthFigures[], actual: MonthFigures[], ended: boolean[]): MonthFigures[] {
  return plan.map((p, i) => {
    const a = actual[i];
    if (!ended[i] || !a?.hasData) return p;
    return p.hasData ? { ...a, opex: p.opex, ebitda: a.cm - p.opex } : a;
  });
}

/** What a stretch goal asks the year to reach, and what the year (on the Forecast basis) adds up to. Null for a growth goal with no last year. */
export function goalCheck(goal: StretchGoal, year: MonthFigures[], lastYear: MonthFigures[]): { target: number; actual: number; label: string } | null {
  const sum = (fs: MonthFigures[], k: "newRevenue" | "totalRevenue") => fs.reduce((a, f) => a + (f.hasData ? f[k] : 0), 0);
  const metric = goal.metric === "newRevenueGrowth" ? "newRevenue" : "totalRevenue";
  const label = metric === "newRevenue" ? "New revenue" : "Total revenue";
  const actual = sum(year, metric);
  if (goal.metric === "totalRevenue") return { target: goal.value, actual, label };
  const ly = sum(lastYear, metric);
  return ly > 0 ? { target: ly * (1 + goal.value / 100), actual, label } : null;
}
