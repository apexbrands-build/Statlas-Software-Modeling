"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useApp } from "@/lib/app-context";
import { todayLocal } from "@/lib/dates";
import { formatValue } from "@/lib/format";
import { aggregatePlan } from "@/lib/metrics";
import { FLAT_SEASONALITY, generateMonth } from "@/lib/planning/generate";
import { dowFromHistory, inputsFromFacts, sourceRange, type FillSource } from "@/lib/planning/history";
import { blankInputs, ZERO_RATES, type PlanMonth, type PlanMonthInputs } from "@/lib/planning/types";
import { getRepository } from "@/lib/repository";
import type { PlanSeasonality, PlanVersion } from "@/lib/types";
import type { PlanCtx } from "./ctx";
import { DetailsStep } from "./DetailsStep";
import { InputStep } from "./InputStep";
import { MonthlyStep } from "./MonthlyStep";
import { ModelsStep } from "./models/ModelsStep";
import { PnlStep } from "./PnlStep";
import { SpendStep } from "./SpendStep";
import { btn, btnPrimary, monthKey, MONTHS } from "./ui";
import { usePlanHistory } from "./useHistory";

const STEPS = [
  { id: "models", label: "Models" },
  { id: "monthly", label: "Monthly plan" },
  { id: "spend", label: "Spend & days" },
  { id: "details", label: "Returning revenue" },
  { id: "input", label: "Daily input" },
  { id: "pnl", label: "Plan P&L" },
] as const;
type StepId = (typeof STEPS)[number]["id"];

export function PlanEditor({ planId }: { planId: string }) {
  const { client, settings } = useApp();
  const [plan, setPlan] = useState<PlanVersion | null | undefined>(undefined);
  const [saved, setSaved] = useState<PlanMonth[] | null>(null);
  const [months, setMonths] = useState<PlanMonth[] | null>(null);
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [seasonDraft, setSeasonDraft] = useState<PlanSeasonality | null>(null);
  const [seasonDirty, setSeasonDirty] = useState(false);
  const [step, setStep] = useState<StepId>("models");
  const [note, setNote] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const history = usePlanHistory(client?.id, plan?.year ?? Number(todayLocal().slice(0, 4)));

  // Load the plan and its saved months.
  useEffect(() => {
    if (!client) return;
    let cancel = false;
    (async () => {
      const repo = getRepository();
      const found = (await repo.listPlans(client.id)).find((p) => p.id === planId) ?? null;
      if (cancel) return;
      setPlan(found);
      if (!found) return;
      const m = await repo.getPlanMonths(planId);
      if (cancel) return;
      const byMonth = new Map(m.map((x) => [x.month, x]));
      const all = Array.from({ length: 12 }, (_, i) => byMonth.get(monthKey(found.year, i)) ?? { month: monthKey(found.year, i), inputs: null, status: "in_progress" as const, locked: false });
      setSaved(all);
      setMonths(all);
      setSeasonDraft(found.seasonality);
      setDirty(new Set());
      setSeasonDirty(false);
    })();
    return () => {
      cancel = true;
    };
  }, [client, planId]);

  const historySeasonality = useMemo(() => (history.lastData ? dowFromHistory(history.facts, history.lastData) : null), [history]);
  const seasonality: PlanSeasonality = seasonDraft ?? historySeasonality ?? FLAT_SEASONALITY;

  const rows = useMemo(() => {
    const out: PlanCtx["rows"] = {};
    if (!plan || !months || !settings) return out;
    for (const m of months) {
      if (!m.inputs) continue;
      out[m.month] = generateMonth({
        planId: plan.id,
        clientId: plan.clientId,
        month: m.month,
        inputs: m.inputs,
        seasonality,
        deliveryCostPerOrder: settings.deliveryCostPerOrder,
        excludeBrandFromAmer: settings.excludeBrandFromAmer,
        excludeMetaReturningFromAmer: settings.excludeMetaReturningFromAmer,
      });
    }
    return out;
  }, [plan, months, settings, seasonality]);

  const markDirty = useCallback((month: string) => setDirty((d) => new Set(d).add(month)), []);

  const editInputs = useCallback(
    (month: string, fn: (i: PlanMonthInputs) => PlanMonthInputs, create = false) => {
      if (!settings) return;
      setMonths(
        (ms) =>
          ms &&
          ms.map((m) => {
            if (m.month !== month || m.locked) return m;
            if (m.inputs) return { ...m, inputs: fn(m.inputs) };
            if (!create) return m;
            // A month with no plan yet starts from the recent actuals (platform split, rates), else blank.
            const r = sourceRange("recent", month, todayLocal());
            const base =
              inputsFromFacts(
                history.facts.filter((f) => f.date >= r.from && f.date <= r.to),
                r.months,
                settings,
                "recent",
              ) ?? { ...blankInputs(), fixedCosts: settings.monthlyFixedCosts, rates: { ...ZERO_RATES, otherVarPct: settings.otherVariablePct } };
            return { ...m, inputs: fn(base) };
          }),
      );
      markDirty(month);
    },
    [markDirty, settings, history.facts],
  );

  const setLocked = useCallback(
    (month: string, locked: boolean) => {
      setMonths((ms) => ms && ms.map((m) => (m.month === month ? { ...m, locked } : m)));
      markDirty(month);
    },
    [markDirty],
  );

  const fill = useCallback(
    (month: string, source: FillSource | "clear" | "blank", growthPct = 0): string | null => {
      const target = months?.find((m) => m.month === month);
      if (!target || !settings) return null;
      if (target.locked) return `${MONTHS[Number(month.slice(5, 7)) - 1]} is locked.`;
      let inputs: PlanMonthInputs | null = null;
      if (source === "blank") inputs = { ...blankInputs(), fixedCosts: settings.monthlyFixedCosts, rates: { ...ZERO_RATES, otherVarPct: settings.otherVariablePct } };
      else if (source !== "clear") {
        const r = sourceRange(source, month, todayLocal());
        if (source === "actuals" && month > history.lastData) return "That month has no actuals yet.";
        inputs = inputsFromFacts(
          history.facts.filter((f) => f.date >= r.from && f.date <= r.to),
          r.months,
          settings,
          source,
          source === "last_year" ? growthPct : 0,
        );
        if (!inputs) return `No ${source === "last_year" ? "last year" : source === "actuals" ? "actual" : "recent"} data to fill ${MONTHS[Number(month.slice(5, 7)) - 1]}.`;
      }
      setMonths((ms) => ms && ms.map((m) => (m.month === month ? { ...m, inputs } : m)));
      markDirty(month);
      return null;
    },
    [months, settings, history, markDirty],
  );

  const setSeasonality = useCallback((s: PlanSeasonality) => {
    setSeasonDraft(s);
    setSeasonDirty(true);
  }, []);

  const needsSave = dirty.size > 0 || seasonDirty || (plan != null && plan.seasonality === null && history.lastData !== "" && months?.some((m) => m.inputs));

  const save = async () => {
    if (!plan || !months || !settings) return;
    setSaving(true);
    setNote(null);
    try {
      const repo = getRepository();
      const persistSeason = seasonDirty || plan.seasonality === null;
      // A new weekday pattern changes every month that has inputs.
      const keys = seasonDirty ? new Set([...dirty, ...months.filter((m) => m.inputs).map((m) => m.month)]) : dirty;
      const items = months
        .filter((m) => keys.has(m.month))
        .map((month) => ({ month, rows: rows[month.month] ?? [] }));
      let updated = plan;
      if (persistSeason) {
        updated = { ...plan, seasonality };
        await repo.updatePlan(updated, seasonDirty ? "Updated day-of-week pattern" : undefined);
      }
      if (items.length) {
        const names = [...dirty].sort().map((k) => MONTHS[Number(k.slice(5, 7)) - 1]);
        await repo.savePlanMonths(updated, items, names.length ? `Updated plan months (${names.join(", ")})` : "Recalculated daily targets");
      }
      setPlan(updated);
      setSaved(months);
      setSeasonDraft(seasonality);
      setDirty(new Set());
      setSeasonDirty(false);
      setNote({ tone: "ok", text: "Saved. Home and the reports now use these targets." });
    } catch (e) {
      setNote({ tone: "bad", text: e instanceof Error ? e.message : "Could not save" });
    } finally {
      setSaving(false);
    }
  };

  if (!client || plan === undefined || !settings) return <div className="h-64 animate-pulse rounded-xl bg-surface" />;
  if (plan === null || plan.clientId !== client.id)
    return (
      <div className="mx-auto max-w-xl space-y-3 rounded-xl border border-border bg-surface p-8 text-center">
        <p className="text-text-muted">This plan was not found for {client.name}.</p>
        <Link href="/planning" className={btn}>
          ← All plans
        </Link>
      </div>
    );
  if (!months || !saved) return <div className="h-64 animate-pulse rounded-xl bg-surface" />;

  const totals = aggregatePlan(Object.values(rows).flat());
  const money = (v: number) => formatValue(v, "currency0", client.currency);
  const ctx: PlanCtx = { plan, client, settings, months, rows, seasonality, setSeasonality, editInputs, setLocked, fill, history, historySeasonality };

  return (
    <div className="mx-auto max-w-[1400px] space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/planning" className={btn}>
          ← Plans
        </Link>
        <div className="mr-auto min-w-0">
          <h1 className="text-xl font-semibold" style={{ fontFamily: "var(--apex-font-heading)" }}>
            {plan.name}
            {plan.isDefault && <span className="ml-2 rounded-full bg-accent px-2 py-0.5 align-middle text-[11px] font-medium text-black">Default</span>}
          </h1>
          <p className="text-xs text-text-muted">
            {plan.year} · {client.name} · {client.currency}
          </p>
        </div>
        <dl className="flex gap-4 text-sm">
          {(
            [
              ["Revenue", totals.orderRevenue],
              ["Spend", totals.spend],
              ["CM", totals.cm],
            ] as const
          ).map(([l, v]) => (
            <div key={l} className="border-l-2 border-accent pl-2">
              <dt className="text-[11px] text-text-muted">{l}</dt>
              <dd className="tabular font-medium">{totals.days ? money(v) : "–"}</dd>
            </div>
          ))}
        </dl>
        <button className={btnPrimary} disabled={saving || !needsSave} onClick={save}>
          {saving ? "Saving…" : needsSave ? "Save plan" : "Saved"}
        </button>
      </div>

      {note && <p className={`rounded-lg border p-3 text-sm ${note.tone === "ok" ? "border-good/40 bg-good/10 text-good" : "border-bad/40 bg-bad/10 text-bad"}`}>{note.text}</p>}
      {needsSave && <p className="text-xs text-text-muted">You have unsaved changes. Targets only change after you save.</p>}

      <div className="flex gap-1 overflow-x-auto border-b border-border" role="tablist">
        {STEPS.map((s, i) => (
          <button key={s.id} role="tab" aria-selected={step === s.id} onClick={() => setStep(s.id)} className={`whitespace-nowrap px-4 py-2 text-sm font-medium ${step === s.id ? "border-b-2 border-accent text-text" : "text-text-muted hover:text-text"}`}>
            {i + 1}. {s.label}
          </button>
        ))}
      </div>

      {/* Always mounted so model edits survive switching tabs. */}
      <div hidden={step !== "models"}>
        <ModelsStep ctx={ctx} />
      </div>
      {step === "monthly" && <MonthlyStep ctx={ctx} />}
      {step === "spend" && <SpendStep ctx={ctx} />}
      {step === "details" && <DetailsStep ctx={ctx} />}
      {step === "input" && <InputStep ctx={ctx} />}
      {step === "pnl" && <PnlStep ctx={ctx} />}
    </div>
  );
}
