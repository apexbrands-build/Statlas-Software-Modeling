import type { PlanMonth, PlanMonthInputs } from "./types";

/** The revenue lines planned as a share of order revenue (Details: Email revenue, SMS revenue, Organic revenue). */
export type MixKey = "email" | "sms" | "organic";
export const MIX_KEYS: MixKey[] = ["email", "sms", "organic"];

const FIELD = { email: "emailPct", sms: "smsPct", organic: "organicPct" } as const;

/** The month's planned share of a line, in % of order revenue (0 when not planned, for the table's editable cell). */
export function mixGet(i: PlanMonthInputs, k: MixKey): number {
  return i.mix?.[FIELD[k]] ?? 0;
}

/** The month's inputs with one line's share set; the others stay. */
export function mixSet(i: PlanMonthInputs, k: MixKey, pct: number): PlanMonthInputs {
  return { ...i, mix: { ...i.mix, [FIELD[k]]: pct } };
}

/** A line's share in a set of actuals (inputs built from facts); null when the actuals carry none. */
export function mixActual(x: PlanMonthInputs | null, k: MixKey): number | null {
  return x?.mix?.[FIELD[k]] ?? null;
}

/** Planned shares per month (key YYYY-MM) as fractions of order revenue, only for the lines a month plans. */
export type MonthMixShares = Record<string, Partial<Record<MixKey, number>>>;

export function planMixShares(months: PlanMonth[]): MonthMixShares {
  const out: MonthMixShares = {};
  for (const m of months) {
    const mix = m.inputs?.mix;
    if (!mix) continue;
    const row: Partial<Record<MixKey, number>> = {};
    for (const k of MIX_KEYS) {
      const v = mix[FIELD[k]];
      if (v !== undefined && Number.isFinite(v)) row[k] = v / 100;
    }
    if (Object.keys(row).length) out[m.month.slice(0, 7)] = row;
  }
  return out;
}

/** The planned share of order revenue for a line on a date (its month's), or null when the plan has none. */
export type MixOf = (date: string, key: MixKey) => number | null;

export function mixOf(shares: MonthMixShares): MixOf {
  return (date, key) => shares[date.slice(0, 7)]?.[key] ?? null;
}
