import { aggregate, aggregatePlan, type MetricDef, type Totals } from "./metrics";
import { diffDays, eachDay, monthKey, monthKeys, type Range } from "./dates";
import type { CompareSource, DashData } from "./dashboard-data";

export interface MonthRow {
  /** YYYYMM */
  key: string;
  tot: Totals;
  hasActual: boolean;
  actual: number | null;
  target: number | null;
  compare: number | null;
}

/**
 * Groups the selected range by calendar month. Targets cover only elapsed days; the comparison period
 * (last year, previous or custom) is matched day by day, so months compare like for like.
 */
export function monthRows(def: MetricDef, data: DashData, cmp: CompareSource, window?: Range): MonthRow[] {
  const w = window ?? data.range;
  const dates = window ? eachDay(w.from, w.to) : data.dates;
  const byMonth: Record<string, string[]> = {};
  for (const d of dates) (byMonth[monthKey(d)] ??= []).push(d);
  return monthKeys(w.from, w.to).map((k) => {
    const ds = byMonth[k] ?? [];
    const facts = ds.map((d) => data.facts.get(d)).filter((f): f is NonNullable<typeof f> => Boolean(f));
    const tot = aggregate(facts);
    const cmpFacts = ds.map((d) => cmp.facts.get(cmp.date(d))).filter((f): f is NonNullable<typeof f> => Boolean(f));
    const planRows = ds.filter((d) => d <= data.effTo).map((d) => data.plan.get(d)).filter((p): p is NonNullable<typeof p> => Boolean(p));
    return {
      key: k,
      tot,
      hasActual: facts.length > 0,
      actual: facts.length ? def.value(tot, data.settings) : null,
      target: planRows.length && def.target ? def.target(aggregatePlan(planRows)) : null,
      compare: cmpFacts.length ? def.value(aggregate(cmpFacts), data.settings) : null,
    };
  });
}

/** Up to about two months the trend is shown per day; longer ranges are grouped by month. */
export const DAILY_MAX_DAYS = 62;
export type Granularity = "day" | "month";

export function chartGranularity(range: Range): Granularity {
  return diffDays(range.from, range.to) + 1 <= DAILY_MAX_DAYS ? "day" : "month";
}

/** One row per day of the selected range (same shape as the monthly rows; key = YYYY-MM-DD). */
export function dayRows(def: MetricDef, data: DashData, cmp: CompareSource): MonthRow[] {
  return data.dates.map((d) => {
    const f = data.facts.get(d);
    const tot = aggregate(f ? [f] : []);
    const c = cmp.facts.get(cmp.date(d));
    const p = d <= data.effTo ? data.plan.get(d) : undefined;
    return {
      key: d,
      tot,
      hasActual: Boolean(f),
      actual: f ? def.value(tot, data.settings) : null,
      target: p && def.target ? def.target(aggregatePlan([p])) : null,
      compare: c ? def.value(aggregate([c]), data.settings) : null,
    };
  });
}
