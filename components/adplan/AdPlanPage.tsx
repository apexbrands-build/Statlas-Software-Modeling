"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePlanHistory } from "@/components/planning/useHistory";
import { inputClass, monthKey } from "@/components/planning/ui";
import { useApp } from "@/lib/app-context";
import { todayLocal } from "@/lib/dates";
import type { MarketingEvent } from "@/lib/planning/events";
import type { SavedModel } from "@/lib/planning/models";
import { pickPlan } from "@/lib/planning/scenarios";
import type { PlanMonth } from "@/lib/planning/types";
import { getRepository } from "@/lib/repository";
import type { PlanVersion } from "@/lib/types";
import { AdPlanBoard } from "./AdPlanBoard";

interface Loaded {
  key: string;
  plan: PlanVersion | null;
  months: PlanMonth[];
  events: MarketingEvent[];
  savedModel: SavedModel<unknown, unknown> | null;
  years: number[];
  error?: string;
}

/** The Ad plan section: the creative strategist's view of how many new ads each month needs, without opening the plan editor. */
export function AdPlanPage() {
  const { client, settings } = useApp();
  const [year, setYear] = useState(() => Number(todayLocal().slice(0, 4)));
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const history = usePlanHistory(client?.id, year);
  const key = client ? `${client.id}|${year}` : null;

  useEffect(() => {
    if (!client || !key) return;
    let cancel = false;
    (async () => {
      const done = (l: Omit<Loaded, "key">) => !cancel && setLoaded({ key, ...l });
      try {
        const repo = getRepository();
        const plans = await repo.listPlans(client.id);
        const years = [...new Set(plans.map((p) => p.year))];
        const picked = pickPlan(plans, year, "baseline");
        if (!picked || picked.year !== year) return done({ plan: null, months: [], events: [], savedModel: null, years });
        const [saved, events, model] = await Promise.all([repo.getPlanMonths(picked.id), repo.listEvents(client.id).catch(() => []), repo.getPlanModel(picked.id, "creative").catch(() => null)]);
        const byMonth = new Map(saved.map((m) => [m.month, m]));
        const months = Array.from({ length: 12 }, (_, i) => byMonth.get(monthKey(year, i)) ?? { month: monthKey(year, i), inputs: null, status: "in_progress" as const, locked: false });
        done({ plan: picked, months, events, savedModel: model, years });
      } catch (e) {
        done({ plan: null, months: [], events: [], savedModel: null, years: [], error: e instanceof Error ? e.message : "Could not load the plan" });
      }
    })();
    return () => {
      cancel = true;
    };
  }, [client, key, year]);

  const data = loaded && loaded.key === key ? loaded : null;
  const thisYear = Number(todayLocal().slice(0, 4));
  const years = [...new Set([thisYear - 1, thisYear, thisYear + 1, ...(data?.years ?? [])])].sort();

  let body;
  if (!client || !settings || !data || history.loading) body = <div className="h-64 animate-pulse rounded-xl bg-surface" />;
  else if (data.error) body = <div className="rounded-xl border border-border bg-surface p-8 text-center text-text-muted">Could not load the plan: {data.error}</div>;
  else if (!data.plan)
    body = (
      <div className="space-y-2 rounded-xl border border-border bg-surface p-8 text-center text-text-muted">
        <p>There is no {year} plan for {client.name} yet. The ad plan follows the plan&apos;s Meta spend, so the plan comes first.</p>
        <Link href="/planning" className="text-accent underline">
          Open Planning
        </Link>
      </div>
    );
  else body = <AdPlanBoard key={data.plan.id} client={client} settings={settings} plan={data.plan} months={data.months} events={data.events} facts={history.facts} lastData={history.lastData} savedModel={data.savedModel} />;

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <h1 className="text-xl font-semibold" style={{ fontFamily: "var(--apex-font-heading)" }}>
            Ad plan
          </h1>
          <p className="text-xs text-text-muted">New Meta ads needed per month and the account&apos;s Creative Score.</p>
        </div>
        <label className="text-xs text-text-muted" htmlFor="adplan-year">
          Year
        </label>
        <select id="adplan-year" value={year} onChange={(e) => setYear(Number(e.target.value))} className={inputClass}>
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </div>
      {body}
    </div>
  );
}
