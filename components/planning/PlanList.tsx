"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useApp } from "@/lib/app-context";
import { todayLocal } from "@/lib/dates";
import { formatValue } from "@/lib/format";
import { aggregatePlan, type PlanTotals } from "@/lib/metrics";
import { getRepository } from "@/lib/repository";
import type { PlanVersion } from "@/lib/types";
import { PlanSettingsDialog } from "./PlanSettingsDialog";
import { btn, btnPrimary, inputClass, Modal } from "./ui";

interface Card {
  plan: PlanVersion;
  totals: PlanTotals;
}

export function PlanList() {
  const { client } = useApp();
  const router = useRouter();
  const [year, setYear] = useState(() => Number(todayLocal().slice(0, 4)));
  const [cards, setCards] = useState<Card[] | null>(null);
  const [yearsWithPlans, setYears] = useState<number[]>([]);
  const [adding, setAdding] = useState(false);
  const [settings, setSettings] = useState<PlanVersion | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!client) return;
    const repo = getRepository();
    try {
      const plans = await repo.listPlans(client.id);
      setYears([...new Set(plans.map((p) => p.year))]);
      const mine = plans.filter((p) => p.year === year);
      const withTotals = await Promise.all(
        mine.map(async (plan) => ({ plan, totals: aggregatePlan(await repo.getPlanTargets(client.id, plan.id, `${year}-01-01`, `${year}-12-31`)) })),
      );
      setCards(withTotals);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load plans");
    }
  }, [client, year]);

  useEffect(() => {
    // Reset and fetch when the client or year changes.
    Promise.resolve().then(() => {
      setCards(null);
      load();
    });
  }, [load]);

  const thisYear = Number(todayLocal().slice(0, 4));
  const years = [...new Set([thisYear - 1, thisYear, thisYear + 1, ...yearsWithPlans])].sort();
  const money = (v: number) => formatValue(v, "currency0", client?.currency ?? "GBP");

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <h1 className="text-xl font-semibold" style={{ fontFamily: "var(--apex-font-heading)" }}>
            Planning
          </h1>
          <p className="text-xs text-text-muted">One plan per year is the default. Home and the reports compare against it.</p>
        </div>
        <label className="text-xs text-text-muted" htmlFor="plan-year">
          Year
        </label>
        <select id="plan-year" value={year} onChange={(e) => setYear(Number(e.target.value))} className={inputClass}>
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </div>

      {error && <p className="rounded-lg border border-bad/40 bg-bad/10 p-3 text-sm text-bad">{error}</p>}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards === null && !error && <div className="h-56 animate-pulse rounded-xl bg-surface" />}
        {cards?.map(({ plan, totals }) => (
          <div key={plan.id} className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
            <div className="flex items-center gap-2 text-[11px] font-medium">
              <span className="rounded-full bg-surface-raised px-2 py-0.5">{plan.year}</span>
              {plan.isDefault && <span className="rounded-full bg-accent px-2 py-0.5 text-black">Default</span>}
              <button className="ml-auto text-text-muted hover:text-text" onClick={() => setSettings(plan)} aria-label={`Settings for ${plan.name}`}>
                ⚙ Settings
              </button>
            </div>
            <h2 className="text-base font-semibold">{plan.name}</h2>
            {plan.description && <p className="text-xs text-text-muted">{plan.description}</p>}
            <dl className="grid grid-cols-2 gap-3 text-sm">
              {(
                [
                  ["New revenue", totals.newRevenue],
                  ["Revenue", totals.orderRevenue],
                  ["Spend", totals.spend],
                  ["CM", totals.cm],
                ] as const
              ).map(([label, v]) => (
                <div key={label} className="border-l-2 border-accent pl-2">
                  <dt className="text-[11px] text-text-muted">{label}</dt>
                  <dd className="tabular font-medium">{totals.days ? money(v) : "–"}</dd>
                </div>
              ))}
            </dl>
            <Link href={`/planning/${plan.id}`} className={`${btnPrimary} text-center`}>
              Open plan
            </Link>
            {plan.updatedAt && (
              <p className="text-[11px] text-text-faint">
                Updated {new Date(plan.updatedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                {plan.updatedBy ? ` by ${plan.updatedBy}` : ""}
              </p>
            )}
          </div>
        ))}
        {cards && (
          <button onClick={() => setAdding(true)} className="flex min-h-56 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border text-text-muted hover:border-accent hover:text-text">
            <span className="text-3xl">+</span>
            <span className="text-sm font-medium">Add a {year} plan</span>
          </button>
        )}
      </div>

      {cards?.length === 0 && <p className="text-sm text-text-muted">No plan for {year} yet. The first plan you add becomes the default, and from then on Home and the reports show Goal columns.</p>}

      {adding && client && (
        <AddPlan
          year={year}
          onClose={() => setAdding(false)}
          onCreate={async (name, description) => {
            const plan = await getRepository().createPlan(client.id, { name, year, description });
            router.push(`/planning/${plan.id}`);
          }}
        />
      )}
      {settings && (
        <PlanSettingsDialog
          plan={settings}
          onClose={() => setSettings(null)}
          onChanged={() => {
            setSettings(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function AddPlan({ year, onClose, onCreate }: { year: number; onClose: () => void; onCreate: (name: string, description: string) => Promise<void> }) {
  const [name, setName] = useState(`${year} Plan`);
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <Modal title={`New ${year} plan`} onClose={onClose}>
      <div className="space-y-3 text-sm">
        <label className="block">
          <span className="text-xs text-text-muted">Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} className={`${inputClass} mt-1 w-full`} />
        </label>
        <label className="block">
          <span className="text-xs text-text-muted">Description (optional)</span>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className={`${inputClass} mt-1 w-full`} />
        </label>
        {err && <p className="text-bad">{err}</p>}
        <div className="flex justify-end gap-2">
          <button className={btn} onClick={onClose}>
            Cancel
          </button>
          <button
            className={btnPrimary}
            disabled={!name.trim() || busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onCreate(name.trim(), description.trim());
              } catch (e) {
                setErr(e instanceof Error ? e.message : "Could not create the plan");
                setBusy(false);
              }
            }}
          >
            {busy ? "Creating…" : "Create plan"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
