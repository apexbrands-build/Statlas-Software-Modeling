import { aggregate, aggregatePlan, type MetricDef } from "./metrics";
import type { ClientSettings, DailyFact, PlanTargetDay } from "./types";

export interface SeriesContext {
  dates: string[];
  facts: Map<string, DailyFact>;
  /** Comparison period facts (last year, previous or custom period) and how a current date maps onto them. */
  cmpFacts: Map<string, DailyFact>;
  cmpDate: (date: string) => string;
  plan: Map<string, PlanTargetDay>;
  settings: ClientSettings;
}

export interface MetricSeries {
  actual: (number | null)[];
  target: (number | null)[];
  compare: (number | null)[];
}

export function metricSeries(def: MetricDef, ctx: SeriesContext): MetricSeries {
  const actual: (number | null)[] = [];
  const target: (number | null)[] = [];
  const compare: (number | null)[] = [];
  for (const d of ctx.dates) {
    const f = ctx.facts.get(d);
    actual.push(f ? def.value(aggregate([f]), ctx.settings) : null);
    const p = ctx.plan.get(d);
    target.push(p && def.target ? def.target(aggregatePlan([p])) : null);
    const c = ctx.cmpFacts.get(ctx.cmpDate(d));
    compare.push(c ? def.value(aggregate([c]), ctx.settings) : null);
  }
  return { actual, target, compare };
}

export const toMap = <T extends { date: string }>(rows: T[]) => new Map(rows.map((r) => [r.date, r]));
