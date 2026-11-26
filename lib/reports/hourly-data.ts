"use client";

import { useEffect, useState } from "react";
import type { MarketingEvent } from "../planning/events";
import { planMixShares, type MonthMixShares } from "../planning/mix";
import { planRoasTargets, type MonthRoasTargets } from "../planning/roas";
import { pickPlan, stretchOf } from "../planning/scenarios";
import { getRepository } from "../repository";
import type { MetaLaunchHour } from "../repository/meta-launches";
import type { OrderHour } from "../repository/order-hours";
import type { Client, ClientSettings, PlanScenario, PlanTargetDay } from "../types";
import { daysToLoad } from "./hourly";

/** Everything the Hourly Report reads for one day. */
export interface HourlyData {
  /** False when the database cannot give orders by hour yet (migration 0023 not applied). */
  ready: boolean;
  /** Orders by hour, by day: the day itself and its reference days. A day with no orders has no entry. */
  hours: Map<string, OrderHour[]>;
  /** The day's target in the plan chosen on Home; null when the day has none. */
  plan: PlanTargetDay | null;
  planName: string | null;
  hasStretch: boolean;
  planScenario: PlanScenario;
  /** The plan's ROAS targets per month and type (returning types included, like the trackers) and its email / SMS shares; null when they could not be read. */
  roas: MonthRoasTargets | null;
  mix: MonthMixShares | null;
  events: MarketingEvent[];
  launches: MetaLaunchHour[];
}

async function load(client: Client, settings: ClientSettings, day: string, scenario: PlanScenario): Promise<HourlyData> {
  const repo = getRepository();
  const [plans, events] = await Promise.all([repo.listPlans(client.id), repo.listEvents(client.id).catch(() => [] as MarketingEvent[])]);
  const year = Number(day.slice(0, 4));
  const hasStretch = Boolean(stretchOf(plans, year));
  const planScenario: PlanScenario = hasStretch ? scenario : "baseline";
  const version = pickPlan(plans, year, planScenario);
  const need = daysToLoad(day, events);
  const [recent, further, planRows, derived, launches] = await Promise.all([
    repo.getOrderHours(client.id, need.from, need.to),
    Promise.all(need.extra.map((d) => repo.getOrderHours(client.id, d, d))),
    version ? repo.getPlanTargets(client.id, version.id, day, day) : Promise.resolve([] as PlanTargetDay[]),
    version
      ? repo
          .getPlanMonths(version.id)
          .then((months) => ({ roas: planRoasTargets(months, settings, { returning: true }), mix: planMixShares(months) }))
          .catch(() => null)
      : Promise.resolve(null),
    repo.getMetaLaunchHours(client.id, { from: day, to: day }).catch(() => undefined),
  ]);
  const hours = new Map<string, OrderHour[]>();
  const ready = recent !== null && further.every((x) => x !== null);
  for (const h of [...(recent ?? []), ...further.flatMap((x) => x ?? [])]) hours.set(h.date, [...(hours.get(h.date) ?? []), h]);
  const plan = planRows.find((r) => r.date === day) ?? null;
  return { ready, hours, plan, planName: plan ? (version?.name ?? null) : null, hasStretch, planScenario, roas: derived?.roas ?? null, mix: derived?.mix ?? null, events, launches: launches ?? [] };
}

/**
 * Loads a day for the Hourly Report. `refresh` re-reads the same day (the store's today, every few minutes) without blanking the page:
 * the numbers on screen stay until the new ones arrive.
 */
export function useHourlyData(client: Client | null, settings: ClientSettings | null, day: string | null, scenario: PlanScenario, refresh: number): { data: HourlyData | null; error: string | null } | null {
  const [state, setState] = useState<{ key: string; data: HourlyData | null; error: string | null } | null>(null);
  const key = client && settings && day ? `${client.id}|${day}|${scenario}` : null;

  useEffect(() => {
    if (!client || !settings || !day || !key) return;
    let cancel = false;
    load(client, settings, day, scenario)
      .then((data) => {
        if (!cancel) setState({ key, data, error: null });
      })
      .catch((e: unknown) => {
        // A failed refresh keeps the numbers already on screen.
        if (!cancel) setState((cur) => (cur && cur.key === key && cur.data ? cur : { key, data: null, error: e instanceof Error ? e.message : "The numbers could not be loaded." }));
      });
    return () => {
      cancel = true;
    };
  }, [client, settings, day, scenario, key, refresh]);

  return state && state.key === key ? state : null;
}
