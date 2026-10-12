import { aggregate, type Totals } from "../metrics";
import type { DailyFact } from "../types";
import { groupDates, type GroupBy } from "./grouping";

/** Drops days after the last day with real data: Home stops there, so a report that includes later days (ad spend can sync ahead of the Shopify rollup) would not equal it. */
export function clipToLastData(facts: DailyFact[], lastData: string): DailyFact[] {
  return facts.filter((f) => f.date <= lastData);
}

export interface FactBucket {
  key: string;
  label: string;
  totals: Totals;
}

/** Groups daily facts into report rows (day, week, month...) with each bucket's totals and the grand total. Buckets come in date order. */
export function bucketFacts(facts: DailyFact[], by: GroupBy): { buckets: FactBucket[]; total: Totals } {
  const sorted = [...facts].sort((a, b) => a.date.localeCompare(b.date));
  const byDate = new Map(sorted.map((f) => [f.date, f]));
  const buckets = groupDates(sorted.map((f) => f.date), by).map((b) => ({
    key: b.key,
    label: b.label,
    totals: aggregate(b.dates.map((d) => byDate.get(d)!)),
  }));
  return { buckets, total: aggregate(sorted) };
}
