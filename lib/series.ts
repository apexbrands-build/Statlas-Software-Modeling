import { addYears } from "./dates";
import { aggregate, aggregatePlan, type MetricDef } from "./metrics";
import type { ClientSettings, DailyFact, PlanTargetDay } from "./types";

export interface SeriesContext {
  dates: string[];
  facts: Map<string, DailyFact>;
  /** Facts keyed by date, used to look up "same day last year". */
  allFacts: Map<string, DailyFact>;
  plan: Map<string, PlanTargetDay>;
  settings: ClientSettings;
}

export interface MetricSeries {
  actual: (number | null)[];
  target: (number | null)[];
  lastYear: (number | null)[];
}

export function metricSeries(def: MetricDef, ctx: SeriesContext): MetricSeries {
  const actual: (number | null)[] = [];
  const target: (number | null)[] = [];
  const lastYear: (number | null)[] = [];
  for (const d of ctx.dates) {
    const f = ctx.facts.get(d);
    actual.push(f ? def.value(aggregate([f]), ctx.settings) : null);
    const p = ctx.plan.get(d);
    target.push(p && def.target ? def.target(aggregatePlan([p])) : null);
    const ly = ctx.allFacts.get(addYears(d, -1));
    lastYear.push(ly ? def.value(aggregate([ly]), ctx.settings) : null);
  }
  return { actual, target, lastYear };
}

export const toMap = <T extends { date: string }>(rows: T[]) => new Map(rows.map((r) => [r.date, r]));
