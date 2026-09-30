"use client";

import { useEffect, useMemo, useState } from "react";
import { addDays, addYears, comparisonRange, diffDays, eachDay, min, type CompareModeName, type Range } from "./dates";
import { aggregate, aggregatePlan, compare, type Comparison, type MetricDef, type PlanTotals, type Totals } from "./metrics";
import { getRepository } from "./repository";
import { toMap } from "./series";
import type { Client, ClientSettings, DailyFact, PlanTargetDay } from "./types";

interface Raw {
  key: string;
  effTo: string;
  lastData: string;
  facts: DailyFact[];
  lyFacts: DailyFact[];
  prevFacts: DailyFact[];
  customFacts: DailyFact[];
  plan: PlanTargetDay[];
  planName: string | null;
}

export interface DashData {
  client: Client;
  settings: ClientSettings;
  range: Range;
  effTo: string;
  lastData: string;
  dates: string[];
  facts: Map<string, DailyFact>;
  lyFacts: Map<string, DailyFact>;
  prevFacts: Map<string, DailyFact>;
  customFacts: Map<string, DailyFact>;
  customRange: Range | null;
  /** Days in the elapsed (data-clamped) current range. */
  elapsedLen: number;
  plan: Map<string, PlanTargetDay>;
  planName: string | null;
  /** False when the client has no plan: no targets, no plan comparison. */
  hasPlan: boolean;
  cur: Totals;
  ly: Totals;
  prev: Totals;
  custom: Totals;
  planTotals: PlanTotals;
}

export function useDashboardData(
  client: Client | null,
  settings: ClientSettings | null,
  range: Range | null,
  customCompare: Range | null,
) {
  const [raw, setRaw] = useState<Raw | null>(null);

  const key = client && range ? `${client.id}|${range.from}|${range.to}|${customCompare?.from ?? ""}|${customCompare?.to ?? ""}` : null;

  useEffect(() => {
    if (!client || !range || !key) return;
    let cancel = false;
    (async () => {
      const repo = getRepository();
      const lastData = await repo.getLastDataDate(client.id);
      const effTo = min(range.to, lastData);
      const elapsed: Range = { from: range.from, to: effTo < range.from ? range.from : effTo };
      const prevRange = comparisonRange("prev", elapsed);
      const plans = await repo.listPlans(client.id);
      const plan = plans.find((p) => p.isDefault) ?? plans[0];
      const [facts, lyFacts, prevFacts, customFacts, planRows] = await Promise.all([
        repo.getFacts(client.id, range.from, effTo),
        repo.getFacts(client.id, addYears(range.from, -1), addYears(range.to, -1)),
        repo.getFacts(client.id, prevRange.from, prevRange.to),
        customCompare ? repo.getFacts(client.id, customCompare.from, customCompare.to) : Promise.resolve([]),
        plan ? repo.getPlanTargets(client.id, plan.id, range.from, range.to) : Promise.resolve([]),
      ]);
      if (!cancel) setRaw({ key, effTo, lastData, facts, lyFacts, prevFacts, customFacts, plan: planRows, planName: plan?.name ?? null });
    })();
    return () => {
      cancel = true;
    };
  }, [client, range, key, customCompare]);

  return useMemo<DashData | null>(() => {
    if (!raw || !client || !settings || !range || raw.key !== key) return null;
    const lyLimit = addYears(raw.effTo, -1);
    return {
      client,
      settings,
      range,
      effTo: raw.effTo,
      lastData: raw.lastData,
      dates: eachDay(range.from, range.to),
      facts: toMap(raw.facts),
      lyFacts: toMap(raw.lyFacts),
      prevFacts: toMap(raw.prevFacts),
      customFacts: toMap(raw.customFacts),
      customRange: customCompare,
      elapsedLen: Math.max(1, diffDays(range.from, raw.effTo) + 1),
      plan: toMap(raw.plan),
      planName: raw.planName,
      hasPlan: raw.planName !== null,
      cur: aggregate(raw.facts),
      ly: aggregate(raw.lyFacts.filter((f) => f.date <= lyLimit)),
      prev: aggregate(raw.prevFacts),
      custom: aggregate(raw.customFacts),
      planTotals: aggregatePlan(raw.plan.filter((p) => p.date <= raw.effTo)),
    };
  }, [raw, client, settings, range, key, customCompare]);
}

export interface TileNumbers extends Comparison {
  actual: number | null;
  ref: number | null;
}

export function tileNumbers(def: MetricDef, d: DashData, mode: CompareModeName): TileNumbers {
  const actual = d.cur.days > 0 ? def.value(d.cur, d.settings) : null;
  let ref: number | null = null;
  if (mode === "plan") ref = def.target && d.planTotals.days > 0 ? def.target(d.planTotals) : null;
  else if (mode === "yoy") ref = d.ly.days > 0 ? def.value(d.ly, d.settings) : null;
  else if (mode === "custom") ref = d.custom.days > 0 ? def.value(d.custom, d.settings) : null;
  else ref = d.prev.days > 0 ? def.value(d.prev, d.settings) : null;
  return { actual, ref, ...compare(actual, ref, def.direction) };
}

export const COMPARE_LABEL: Record<CompareModeName, string> = {
  plan: "vs plan",
  yoy: "vs last year",
  prev: "vs previous period",
  custom: "vs comparison period",
};

export interface CompareSource {
  facts: Map<string, DailyFact>;
  /** Maps a date in the current range to the matching date in the comparison period. */
  date: (d: string) => string;
  label: string;
}

/** Comparison line used by charts (plan mode falls back to last year). */
export function compareSource(d: DashData, mode: CompareModeName): CompareSource {
  if (mode === "prev") {
    return { facts: d.prevFacts, date: (x) => addDays(x, -d.elapsedLen), label: "Previous period" };
  }
  if (mode === "custom" && d.customRange) {
    const from = d.customRange.from;
    return { facts: d.customFacts, date: (x) => addDays(from, diffDays(d.range.from, x)), label: "Comparison period" };
  }
  return { facts: d.lyFacts, date: (x) => addYears(x, -1), label: "Last year" };
}
