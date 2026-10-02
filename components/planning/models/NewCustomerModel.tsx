"use client";

import { useMemo, useState } from "react";
import { addDays, addYears, endOfMonth, todayLocal } from "@/lib/dates";
import { formatValue } from "@/lib/format";
import { aggregate, amerSpend } from "@/lib/metrics";
import {
  acqShare,
  cohortMultipliers,
  recentCostPct,
  recentNewAov,
  SOURCE_DAYS,
  SOURCE_LABELS,
  type NewCustomerMonth,
  type NewCustomerResults,
  type Source,
} from "@/lib/planning/models";
import {
  buildSpendTable,
  curveAmer,
  evaluateSpend,
  fitNewCustomerModel,
  monthlyAmerIndex,
  niceStep,
  OPTIMIZE_LABELS,
  optimalSpend,
  CURVE_LABELS,
  type DayPoint,
  type ModelSettings,
  type OptimizeFor,
} from "@/lib/planning/new-customer";
import { btn, btnPrimary, inputClass, MONTHS, NumField } from "../ui";
import { Legend, ScatterCurve, type ScatterPoint } from "./charts";
import type { ModelCtx } from "./ModelsStep";

const daysIn = (month: string) => Number(endOfMonth(month).slice(8, 10));
const SOURCES: Source[] = ["last30", "last90", "last365", "manual"];
type ForecastRule = Exclude<OptimizeFor, "other"> | "lastYear";
const RULE_LABELS: Record<ForecastRule, string> = { cm: "Max CM (default)", cm60: "Max 60-day CM", cm365: "Max 1-year CM", revenue: "Max Revenue at break-even", lastYear: "Last year + growth %" };

function Panel({ title, children, className = "" }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-border bg-surface p-4 ${className}`}>
      <h3 className="mb-3 text-sm font-semibold">{title}</h3>
      {children}
    </div>
  );
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="mb-3">
      <div className="mb-1 text-xs text-text-muted">
        {label}
        {hint && <span className="ml-2 text-text-faint">{hint}</span>}
      </div>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

function SourceSelect({ value, onChange, options = SOURCES }: { value: Source; onChange: (s: Source) => void; options?: Source[] }) {
  return (
    <select className={inputClass} value={value} onChange={(e) => onChange(e.target.value as Source)} aria-label="Source">
      {options.map((s) => (
        <option key={s} value={s}>
          {SOURCE_LABELS[s]}
        </option>
      ))}
    </select>
  );
}

export function NewCustomerModel({ mc }: { mc: ModelCtx }) {
  const { ctx, facts, lastData, cohort, newSettings: S, setNewSettings } = mc;
  const { plan, client, settings, months, seasonality, editInputs } = ctx;
  const money = (v: number | null) => formatValue(v, "currency0", client.currency);
  const monthKeys = months.map((m) => m.month);

  const today = todayLocal();
  const [sel, setSel] = useState(() => (today.slice(0, 4) === String(plan.year) ? `${today.slice(0, 7)}-01` : monthKeys[0]));
  const [showParams, setShowParams] = useState(false);
  const [showActualize, setShowActualize] = useState(false);
  const [note, setNote] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [draftFrom, setDraftFrom] = useState<string>(S.actualizeFrom ?? addDays(lastData, -59));
  const [draftWeight, setDraftWeight] = useState(S.recentWeight);
  const [rule, setRule] = useState<ForecastRule>("cm");
  const [growth, setGrowth] = useState(10);
  const [view, setView] = useState<"amer" | "revenue">("revenue");

  /* ---- the fit ---- */
  const points = useMemo<DayPoint[]>(() => facts.map((f) => ({ date: f.date, spend: amerSpend(aggregate([f]), settings), newRevenue: f.newOrderRevenue })), [facts, settings]);
  const fitWith = (recent: { from: string; weight: number } | null) => fitNewCustomerModel(points, seasonality.dow, { kind: S.fitKind, recent });
  const recent = S.actualizeFrom ? { from: S.actualizeFrom, weight: S.recentWeight } : null;
  const fit = useMemo(() => fitWith(recent), [points, seasonality, S.fitKind, S.actualizeFrom, S.recentWeight]); // eslint-disable-line react-hooks/exhaustive-deps
  const baseFit = useMemo(() => (S.actualizeFrom ? fitWith(null) : fit), [points, seasonality, S.fitKind, S.actualizeFrom, fit]); // eslint-disable-line react-hooks/exhaustive-deps
  const draftFit = useMemo(() => (showActualize ? fitWith({ from: draftFrom, weight: draftWeight }) : null), [showActualize, draftFrom, draftWeight, points, seasonality, S.fitKind]); // eslint-disable-line react-hooks/exhaustive-deps
  const altR2 = (k: "revenue" | "linear" | "power") => fit?.alternatives[k]?.r2 ?? null;
  const seasonal = useMemo(() => (fit ? monthlyAmerIndex(fit.used, fit.curve) : null), [fit]);
  const seasonIdx = (key: string) => seasonal?.index[Number(key.slice(5, 7)) - 1] ?? 1;

  const cohortMult = useMemo(() => cohortMultipliers(cohort.stats, lastData), [cohort.stats, lastData]);

  /* ---- month defaults and resolving "Last 30 days / Recommended / Manual" ---- */
  const defaultMonth = (key: string): NewCustomerMonth => {
    const inputs = months.find((m) => m.month === key)?.inputs ?? null;
    const aov = recentNewAov(facts, lastData, 30) ?? inputs?.rates.newAov ?? 0;
    const cost = recentCostPct(facts, lastData, 30, settings) ?? 30;
    const recentSpend = (() => {
      const from = addDays(lastData, -89);
      const t = aggregate(facts.filter((f) => f.date >= from && f.date <= lastData));
      return t.days ? (amerSpend(t, settings) / t.days) * daysIn(key) : 0;
    })();
    return {
      optimizeFor: "cm",
      spend: inputs ? Math.round(inputs.spend * acqShare(inputs, settings)) : Math.round(recentSpend),
      aov: Math.round(aov * 100) / 100,
      aovSource: "last30",
      newCostPct: cost,
      newCostSource: "last30",
      returningCostPct: cost,
      returningCostSource: "last30",
      ltv60Multiplier: cohortMult.ltv60 ?? 1,
      ltv365Multiplier: cohortMult.ltv365 ?? 1,
      ltvSource: cohortMult.ltv365 != null ? "recommended" : "manual",
      overModelPct: fit?.recommendedOverPct ?? 0,
      minCm: 0,
      minCm60: 0,
      minCm365: 0,
    };
  };
  const getMonth = (key: string): NewCustomerMonth => S.months[key] ?? defaultMonth(key);
  const setMonth = (key: string, patch: Partial<NewCustomerMonth>) => setNewSettings((s) => ({ ...s, months: { ...s.months, [key]: { ...(s.months[key] ?? defaultMonth(key)), ...patch } } }));

  const resolve = (m: NewCustomerMonth) => {
    const win = (src: Source) => SOURCE_DAYS[src];
    const aov = m.aovSource === "manual" ? m.aov : (recentNewAov(facts, lastData, win(m.aovSource) ?? 30) ?? m.aov);
    const nc = m.newCostSource === "manual" ? m.newCostPct : (recentCostPct(facts, lastData, win(m.newCostSource) ?? 30, settings) ?? m.newCostPct);
    const rc = m.returningCostSource === "manual" ? m.returningCostPct : (recentCostPct(facts, lastData, win(m.returningCostSource) ?? 30, settings) ?? m.returningCostPct);
    const m60 = m.ltvSource === "manual" ? m.ltv60Multiplier : (cohortMult.ltv60 ?? m.ltv60Multiplier);
    const m365 = m.ltvSource === "manual" ? m.ltv365Multiplier : (cohortMult.ltv365 ?? m.ltv365Multiplier);
    return { aov, nc, rc, m60, m365 };
  };

  /* ---- the plan table ---- */
  const markerRows: { label: string; key: Exclude<OptimizeFor, "other"> }[] = [
    { label: "Max CM", key: "cm" },
    { label: "Max 60-day CM", key: "cm60" },
    { label: "Max 1-year CM", key: "cm365" },
    { label: "Max Revenue at break-even", key: "revenue" },
  ];
  const buildRow = (key: string, m: NewCustomerMonth = getMonth(key)) => {
    const e = resolve(m);
    const days = daysIn(key);
    const idx = seasonIdx(key);
    const ms: ModelSettings = { newCostPct: e.nc, returningCostPct: e.rc, aov: e.aov, ltv60Multiplier: e.m60, ltv365Multiplier: e.m365, overModelPct: m.overModelPct, minCm: m.minCm, minCm60: m.minCm60, minCm365: m.minCm365 };
    const closed = lastData !== "" && endOfMonth(key) <= lastData;
    let table = null as ReturnType<typeof buildSpendTable> | null;
    let spend = m.spend;
    let point = null as ReturnType<typeof evaluateSpend> | null;
    let cap = 0;
    if (fit) {
      // The table only covers spend the history has seen: the 95th-percentile day, sustained for the whole month (Jack's table
      // stops at the highest observed spend too). Beyond it the straight line is a guess, so no Max point is ever placed there.
      const daily = fit.used.map((p) => p.spend).sort((a, b) => a - b);
      cap = (daily[Math.min(daily.length - 1, Math.floor(daily.length * 0.95))] ?? 0) * days;
      const top = Math.max(cap, m.optimizeFor === "other" && !closed ? m.spend : 0, 1000);
      const step = niceStep(top / 30);
      table = buildSpendTable(fit.curve, ms, days, Math.ceil(top / step) * step, step, idx, cap);
      if (m.optimizeFor !== "other" && !closed) {
        const t = optimalSpend(table, m.optimizeFor);
        if (t != null) spend = t;
      }
      point = evaluateSpend(fit.curve, ms, spend, days, idx);
    }
    if (closed) {
      // Closed month: the numbers are what happened, not what the model says.
      const t = aggregate(facts.filter((f) => f.date >= key && f.date <= endOfMonth(key)));
      const sp = amerSpend(t, settings);
      if (t.days > 0 && sp > 0) {
        const rev = t.newOrderRevenue;
        const base = point ?? evaluateSpend({ kind: "revenue", a: 0, b: 0, r2: 0 }, ms, sp, days);
        const ltvCm = (mult: number) => rev * (1 - e.nc / 100) + Math.max(0, rev * mult - rev) * (1 - e.rc / 100) - sp;
        spend = sp;
        point = { ...base, spend: sp, amer: rev / sp, newRevenue: rev, orders: t.newOrders, cac: t.newOrders > 0 ? sp / t.newOrders : 0, cm: rev * (1 - e.nc / 100) - sp, ltv60Revenue: rev * e.m60, ltv60Cm: ltvCm(e.m60), ltv365Revenue: rev * e.m365, ltv365Cm: ltvCm(e.m365) };
      }
    }
    return { key, m, e, days, ms, table, spend, point, idx, cap, closed };
  };
  const rows = monthKeys.map((key) => buildRow(key));
  const cur = rows.find((r) => r.key === sel) ?? rows[0];
  const totals = rows.reduce(
    (a, r) => ({ spend: a.spend + (r.point ? r.spend : 0), rev: a.rev + (r.point?.newRevenue ?? 0), orders: a.orders + (r.point?.orders ?? 0), cm: a.cm + (r.point?.cm ?? 0) }),
    { spend: 0, rev: 0, orders: 0, cm: 0 },
  );

  /* ---- last year's aMER for the selected month ---- */
  const lyAmer = (() => {
    const from = addYears(cur.key, -1);
    const t = aggregate(facts.filter((f) => f.date >= from && f.date <= endOfMonth(from)));
    const sp = amerSpend(t, settings);
    return t.days && sp > 0 ? t.newOrderRevenue / sp : null;
  })();

  /** Spend that counted toward aMER in the same month last year (null when that month has no data). */
  const lastYearSpend = (key: string) => {
    const from = addYears(key, -1);
    const t = aggregate(facts.filter((f) => f.date >= from && f.date <= endOfMonth(from)));
    const sp = amerSpend(t, settings);
    return t.days > 0 && sp > 0 ? sp : null;
  };

  const monthLabel = (key: string) => `${plan.year} ${MONTHS[Number(key.slice(5, 7)) - 1]}`;
  const shortMonth = MONTHS[Number(cur.key.slice(5, 7)) - 1];

  // Chart: every historical day is scaled to a month at that day's pace (daily spend × days), so the distance between the days
  // we have seen and the spend the model recommends is visible. "revenue" plots new revenue, "amer" plots efficiency.
  const yOf = (spendM: number, amer: number) => (view === "revenue" ? spendM * amer : amer);
  const scatter = ((): ScatterPoint[] => {
    if (!fit) return [];
    const lyMonth = addYears(cur.key, -1).slice(0, 7);
    const thisMonth = cur.key.slice(0, 7);
    const out: ScatterPoint[] = fit.used.map((p) => ({ x: p.spend * cur.days, y: yOf(p.spend * cur.days, p.adjAmer), tone: p.date.slice(0, 7) === lyMonth ? "lastYear" : p.date.slice(0, 7) === thisMonth ? "current" : "history" }));
    if (cur.table && !cur.closed)
      for (const mr of markerRows) {
        const i = cur.table.best[mr.key];
        if (i != null) out.push({ x: cur.table.points[i].spend, y: yOf(cur.table.points[i].spend, cur.table.points[i].amer), tone: "marker", label: mr.label.replace("Max ", "").replace(" at break-even", " B/E") });
      }
    if (cur.point) out.push({ x: cur.spend, y: yOf(cur.spend, cur.point.amer), tone: "selected" });
    return out;
  })();
  const curve = (() => {
    if (!fit || !cur.table) return [];
    const maxX = Math.max(cur.cap, cur.spend, cur.table.points[cur.table.points.length - 1]?.spend ?? 0);
    return Array.from({ length: 60 }, (_, i) => {
      const x = (maxX * (i + 1)) / 60;
      return { x, y: yOf(x, curveAmer(fit.curve, x / cur.days) * (1 + cur.m.overModelPct / 100) * cur.idx) };
    });
  })();
  const maxAtEdge = !!cur.table && !cur.closed && cur.table.best.cm != null && cur.table.best.cm === cur.table.points.filter((p) => p.spend <= cur.cap + 1e-9).length - 1;

  /* ---- save ---- */
  const saveAndApply = async (useRows: typeof rows = rows, settingsToSave = S, prefix = "") => {
    if (!fit) return;
    setSaving(true);
    setNote(null);
    let applied = 0;
    let skipped = 0;
    for (const r of useRows) {
      if (!r.point || r.closed) continue; // closed months keep their actuals
      const locked = months.find((m) => m.month === r.key)?.locked;
      if (locked) {
        skipped += 1;
        continue;
      }
      editInputs(
        r.key,
        (i) => ({ ...i, spend: Math.round(r.spend / acqShare(i, settings)), amer: Math.round(r.point!.amer * 1000) / 1000, rates: { ...i.rates, newAov: Math.round(r.e.aov * 100) / 100 } }),
        true,
      );
      applied += 1;
    }
    const results: NewCustomerResults = { fittedAt: new Date().toISOString(), kind: fit.curve.kind, a: fit.curve.a, b: fit.curve.b, r2: fit.curve.r2, daysUsed: fit.used.length, actualizedFrom: S.actualizeFrom };
    mc.setNewResults(results);
    const err = await mc.saveModel("new_customer", settingsToSave, results, S.actualizeFrom ? `Saved new customer model (actualized from ${S.actualizeFrom})` : "Saved new customer model");
    setSaving(false);
    setNote(
      err
        ? { tone: "bad", text: err }
        : { tone: "ok", text: `${prefix}Model saved. Spend and aMER were applied to ${applied} month${applied === 1 ? "" : "s"}${skipped ? ` (${skipped} locked month${skipped === 1 ? "" : "s"} skipped)` : ""}. Press Save plan (top right) to update the daily targets.` },
    );
  };

  /** Create forecast: every unlocked month gets spend and aMER from the chosen rule, then the model is saved. */
  const createForecast = async () => {
    if (!fit) return;
    const nextMonths = { ...S.months };
    const built = monthKeys.map((key) => {
      let m: NewCustomerMonth = { ...getMonth(key), optimizeFor: rule === "lastYear" ? "cm" : rule };
      if (rule === "lastYear") {
        const ly = lastYearSpend(key);
        if (ly != null) m = { ...m, optimizeFor: "other", spend: Math.round(ly * (1 + growth / 100)) };
      }
      nextMonths[key] = m;
      return buildRow(key, m);
    });
    setNewSettings((s) => ({ ...s, months: nextMonths }));
    await saveAndApply(built, { ...S, months: nextMonths }, `Forecast created (${RULE_LABELS[rule]}${rule === "lastYear" ? ` ${growth}%` : ""}). `);
  };

  const th = "px-2 py-1.5 text-right font-medium";
  const td = "px-2 py-1 text-right tabular";

  if (!fit)
    return (
      <div className="space-y-2 rounded-xl border border-border bg-surface p-6 text-sm">
        <p className="font-medium">Not enough history to fit the new customer model yet.</p>
        <p className="text-text-muted">It needs about 60 days with ad spend and new-customer revenue, and works best with 2 years. {client.name} has {points.filter((p) => p.spend > 0 && p.newRevenue > 0).length} such days.</p>
      </div>
    );

  const confidence = fit.curve.r2 >= 0.5 ? "Good" : fit.curve.r2 >= 0.25 ? "Fair" : "Low";
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          Month
          <select className={inputClass} value={cur.key} onChange={(e) => setSel(e.target.value)}>
            {monthKeys.map((k) => (
              <option key={k} value={k}>
                {monthLabel(k)}
              </option>
            ))}
          </select>
        </label>
        <button className={btn} onClick={() => setShowActualize((v) => !v)}>
          Actualize with recent data
        </button>
        <button className={btnPrimary} onClick={() => saveAndApply()} disabled={saving}>
          {saving ? "Saving…" : "Save Model"}
        </button>
        <span className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-2 py-1">
          <select className={inputClass} value={rule} onChange={(e) => setRule(e.target.value as ForecastRule)} aria-label="Forecast rule">
            {(Object.keys(RULE_LABELS) as ForecastRule[]).map((k) => (
              <option key={k} value={k}>
                {RULE_LABELS[k]}
              </option>
            ))}
          </select>
          {rule === "lastYear" && <NumField value={growth} decimals={1} className="w-16" suffix="%" onCommit={setGrowth} />}
          <button className={btnPrimary} onClick={createForecast} disabled={saving}>
            Create forecast
          </button>
        </span>
        <button className="text-xs text-accent underline" onClick={() => setShowParams((v) => !v)}>
          {showParams ? "Hide" : "Display"} model parameters
        </button>
        <div className="ml-auto text-right">
          <div className="text-sm font-semibold">Official {plan.year} aMER Model</div>
          <div className="text-[11px] text-text-muted">
            {S.actualizeFrom ? `Actualized from ${S.actualizeFrom} (×${S.recentWeight} weight)` : "Fitted on full history"}
            {mc.savedAt.new_customer ? ` · saved ${mc.savedAt.new_customer.slice(0, 10)}` : ""}
          </div>
        </div>
      </div>

      {note && <p className={`rounded-lg border p-3 text-sm ${note.tone === "ok" ? "border-good/40 bg-good/10 text-good" : "border-bad/40 bg-bad/10 text-bad"}`}>{note.text}</p>}

      {showParams && (
        <Panel title="Model parameters">
          <div className="grid gap-4 text-sm md:grid-cols-2">
            <div className="space-y-1">
              <p>
                <span className="text-text-muted">Method:</span> {fit.curve.kind === "revenue" ? "straight-line regression of weekday-adjusted revenue (spend × aMER) on daily spend, as in aMER_ModelV2" : fit.curve.kind === "linear" ? "straight-line regression of weekday-adjusted aMER on daily spend" : "flattening-curve regression (log-log) of weekday-adjusted aMER on daily spend"}
              </p>
              <p className="tabular">
                <span className="text-text-muted">Curve:</span> {fit.curve.kind === "revenue" ? `daily revenue = ${fit.curve.a.toFixed(0)} + ${fit.curve.b.toFixed(3)} × daily spend  (aMER = ${fit.curve.b.toFixed(3)} + ${fit.curve.a.toFixed(0)} / daily spend)` : fit.curve.kind === "linear" ? `aMER = ${fit.curve.a.toFixed(3)} ${fit.curve.b < 0 ? "−" : "+"} ${Math.abs(fit.curve.b).toFixed(6)} × daily spend` : `aMER = ${fit.curve.a.toFixed(3)} × daily spend ^ ${fit.curve.b.toFixed(3)}`}
              </p>
              <p>
                <span className="text-text-muted">R²:</span> {fit.curve.r2.toFixed(2)} ({confidence} confidence)
                <span className="ml-2 text-xs text-text-faint">
                  {(["revenue", "linear", "power"] as const).filter((k) => altR2(k) != null).map((k) => `${CURVE_LABELS[k]} ${altR2(k)!.toFixed(2)}`).join(" · ")}
                </span>
              </p>
              {fit.curve.kind === "revenue" && (
                <p>
                  <span className="text-text-muted">Revenue at $0 spend:</span> {money(fit.curve.a)} a day (what the line implies the business sells with no ad spend) ·{" "}
                  <span className="text-text-muted">each extra $1 brings:</span> {fit.curve.b.toFixed(2)}
                </p>
              )}
              <p>
                <span className="text-text-muted">Days used:</span> {fit.used.length} ·{" "}
                <span className="text-text-muted">removed:</span> {fit.dropped.filter((d) => d.reason === "bfcm").length} Black Friday week, {fit.dropped.filter((d) => d.reason === "outlier").length} outliers (spend-bucket ±1σ filter)
              </p>
              <p>
                <span className="text-text-muted">Recommended % over model:</span> {fit.recommendedOverPct}% (the 90th-percentile day sits this far above the line)
              </p>
            </div>
            <div className="space-y-2 text-xs text-text-muted">
              <p>
                <span className="text-text-muted">Seasonality of spending power:</span>{" "}
                {seasonal && seasonal.years >= 2 ? `${shortMonth} runs ×${cur.idx.toFixed(2)} versus the average month (${seasonal.days[Number(cur.key.slice(5, 7)) - 1]} days over ${seasonal.years} years). Every month's table uses its own index.` : "needs two years of history, so every month uses ×1.00 for now."}
              </p>
              <p>R² says how much of the day-to-day change in aMER the spend explains. The rest is creative, offers and noise, so treat the line as a baseline to bet against, not a promise.</p>
              <label className="flex items-center gap-2">
                Curve shape
                <select className={inputClass} value={S.fitKind} onChange={(e) => setNewSettings((s) => ({ ...s, fitKind: e.target.value as typeof s.fitKind }))}>
                  <option value="revenue">{CURVE_LABELS.revenue} (recommended)</option>
                  <option value="linear">{CURVE_LABELS.linear}</option>
                  <option value="power">{CURVE_LABELS.power}</option>
                  <option value="auto">Best fit (automatic)</option>
                </select>
              </label>
            </div>
          </div>
        </Panel>
      )}

      {showActualize && (
        <Panel title="Actualize the model with recent data">
          <p className="mb-3 max-w-3xl text-xs text-text-muted">
            If a month of work unlocked more spending (more spend without the same drop in efficiency), recent days should count more than old ones. Pick where &quot;recent&quot; starts and how much extra weight it gets. History is kept, so the curve moves without being thrown away.
          </p>
          <div className="flex flex-wrap items-end gap-4">
            <Field label="Recent data starts">
              <div className="flex gap-1">
                {[30, 60, 90].map((d) => (
                  <button key={d} className={btn} onClick={() => setDraftFrom(addDays(lastData, -(d - 1)))}>
                    Last {d} days
                  </button>
                ))}
              </div>
              <input type="date" className={inputClass} value={draftFrom} max={lastData} onChange={(e) => e.target.value && setDraftFrom(e.target.value)} />
            </Field>
            <Field label="Weight of recent days">
              <select className={inputClass} value={draftWeight} onChange={(e) => setDraftWeight(Number(e.target.value))}>
                {[2, 3, 5, 8, 12].map((w) => (
                  <option key={w} value={w}>
                    ×{w}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="">
              <button
                className={btnPrimary}
                disabled={!draftFit}
                onClick={() => {
                  setNewSettings((s) => ({ ...s, actualizeFrom: draftFrom, recentWeight: draftWeight }));
                  setShowActualize(false);
                  setNote({ tone: "ok", text: "Model actualized. Check the curve and the table, then press Save Model." });
                }}
              >
                Actualize
              </button>
              <button
                className={btn}
                disabled={!S.actualizeFrom}
                onClick={() => {
                  setNewSettings((s) => ({ ...s, actualizeFrom: null }));
                  setShowActualize(false);
                }}
              >
                Back to full history
              </button>
            </Field>
          </div>
          {draftFit ? (
            <p className="text-sm tabular">
              At {money(cur.spend)} / month ({shortMonth}): aMER{" "}
              <b>{(curveAmer(baseFit?.curve ?? fit.curve, cur.spend / cur.days) * (1 + cur.m.overModelPct / 100)).toFixed(2)}</b> on full history → <b>{(curveAmer(draftFit.curve, cur.spend / cur.days) * (1 + cur.m.overModelPct / 100)).toFixed(2)}</b> actualized. R² {(baseFit?.curve.r2 ?? fit.curve.r2).toFixed(2)} → {draftFit.curve.r2.toFixed(2)}.
            </p>
          ) : (
            <p className="text-sm text-bad">Not enough data in that window to fit.</p>
          )}
        </Panel>
      )}

      <Panel title={`${plan.year} Plan`}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] border-collapse text-xs">
            <thead>
              <tr className="border-b border-border text-text-muted">
                <th className="px-2 py-1.5 text-left font-medium">Month</th>
                <th className="px-2 py-1.5 text-left font-medium">Optimize for</th>
                <th className={th}>Spend</th>
                <th className={th}>aMER</th>
                <th className={th}>New order revenue</th>
                <th className={th}>AOV</th>
                <th className={th}>CM</th>
                <th className={th}>60-day LTV</th>
                <th className={th}>1-year LTV</th>
                <th className={th}>New cost %</th>
                <th className={th}>Returning cost %</th>
                <th className={th}>% over model</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className={`border-b border-border/50 ${r.key === cur.key ? "bg-accent/10" : ""}`}>
                  <td className="px-2 py-1">
                    <button className="underline decoration-dotted" onClick={() => setSel(r.key)}>
                      {monthLabel(r.key)}
                    </button>
                  </td>
                  <td className="px-2 py-1">{r.closed ? "Actual" : OPTIMIZE_LABELS[r.m.optimizeFor]}</td>
                  <td className={td}>{money(r.spend)}</td>
                  <td className={td}>{r.point ? r.point.amer.toFixed(2) : "–"}</td>
                  <td className={td}>{money(r.point?.newRevenue ?? 0)}</td>
                  <td className={td}>{r.e.aov.toFixed(2)}</td>
                  <td className={td}>{money(r.point?.cm ?? 0)}</td>
                  <td className={td}>{(r.e.aov * r.e.m60).toFixed(2)}</td>
                  <td className={td}>{(r.e.aov * r.e.m365).toFixed(2)}</td>
                  <td className={td}>{r.e.nc.toFixed(1)}%</td>
                  <td className={td}>{r.e.rc.toFixed(1)}%</td>
                  <td className={td}>{r.m.overModelPct}%</td>
                </tr>
              ))}
              <tr className="bg-bg font-medium">
                <td className="px-2 py-1.5" colSpan={2}>
                  {plan.year} totals
                </td>
                <td className={td}>{money(totals.spend)}</td>
                <td className={td}>{totals.spend > 0 ? (totals.rev / totals.spend).toFixed(2) : "–"}</td>
                <td className={td}>{money(totals.rev)}</td>
                <td className={td}>{totals.orders > 0 ? (totals.rev / totals.orders).toFixed(2) : "–"}</td>
                <td className={td}>{money(totals.cm)}</td>
                <td colSpan={5} />
              </tr>
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-bad/80">* aMER is calculated in this model as new order revenue / spend that counts toward aMER (brand and Meta returning spend excluded per store settings).</p>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title={`${shortMonth} cost settings`}>
          <Field label="New customer cost %" hint="tax, returns, COGS, delivery">
            <NumField value={cur.e.nc} decimals={1} className="w-20" suffix="%" disabled={cur.m.newCostSource !== "manual"} onCommit={(v) => setMonth(cur.key, { newCostPct: v })} />
            <SourceSelect
              value={cur.m.newCostSource}
              onChange={(s) => setMonth(cur.key, s === "manual" ? { newCostSource: s, newCostPct: cur.e.nc } : { newCostSource: s })}
            />
          </Field>
          <Field label="Returning cost %">
            <NumField value={cur.e.rc} decimals={1} className="w-20" suffix="%" disabled={cur.m.returningCostSource !== "manual"} onCommit={(v) => setMonth(cur.key, { returningCostPct: v })} />
            <SourceSelect
              value={cur.m.returningCostSource}
              onChange={(s) => setMonth(cur.key, s === "manual" ? { returningCostSource: s, returningCostPct: cur.e.rc } : { returningCostSource: s })}
            />
          </Field>
        </Panel>
        <Panel title="LTV settings">
          <Field label="AOV (new customers)" hint="recent data: AOV rarely changes, so it is not forecast">
            <NumField value={cur.e.aov} decimals={2} className="w-24" disabled={cur.m.aovSource !== "manual"} onCommit={(v) => setMonth(cur.key, { aov: v })} />
            <SourceSelect value={cur.m.aovSource} onChange={(s) => setMonth(cur.key, s === "manual" ? { aovSource: s, aov: cur.e.aov } : { aovSource: s })} />
          </Field>
          <Field label="LTV multiplier" hint="repeat revenue as a multiple of the first order">
            <span className="text-xs text-text-muted">60-day</span>
            <NumField value={cur.e.m60} decimals={4} className="w-20" disabled={cur.m.ltvSource !== "manual"} onCommit={(v) => setMonth(cur.key, { ltv60Multiplier: v })} />
            <span className="text-xs text-text-muted">1-year</span>
            <NumField value={cur.e.m365} decimals={4} className="w-20" disabled={cur.m.ltvSource !== "manual"} onCommit={(v) => setMonth(cur.key, { ltv365Multiplier: v })} />
            <SourceSelect
              value={cur.m.ltvSource}
              options={["recommended", "manual"]}
              onChange={(s) => setMonth(cur.key, s === "manual" ? { ltvSource: s, ltv60Multiplier: cur.e.m60, ltv365Multiplier: cur.e.m365 } : { ltvSource: s })}
            />
          </Field>
          {!cohortMult.ltv365 && <p className="text-xs text-text-faint">No cohort history yet, so the multiplier is typed by hand. Build the cohorts in the Returning Customer Model.</p>}
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-lg bg-good/10 p-2 tabular">60-day LTV: {(cur.e.aov * cur.e.m60).toFixed(2)}</div>
            <div className="rounded-lg bg-good/10 p-2 tabular">1-year LTV: {(cur.e.aov * cur.e.m365).toFixed(2)}</div>
          </div>
        </Panel>
        <Panel title="Model tweaks">
          <Field label="Min contribution margin">
            <NumField value={cur.m.minCm} className="w-28" onCommit={(v) => setMonth(cur.key, { minCm: v })} />
          </Field>
          <Field label="Min 60-day CM">
            <NumField value={cur.m.minCm60} className="w-28" onCommit={(v) => setMonth(cur.key, { minCm60: v })} />
          </Field>
          <Field label="Min 1-year CM">
            <NumField value={cur.m.minCm365} className="w-28" onCommit={(v) => setMonth(cur.key, { minCm365: v })} />
          </Field>
          <Field label="% over model" hint={`recommended ${fit.recommendedOverPct}%`}>
            <NumField value={cur.m.overModelPct} decimals={1} className="w-20" suffix="%" onCommit={(v) => setMonth(cur.key, { overModelPct: v })} />
            <button className="text-xs text-accent underline" onClick={() => setMonth(cur.key, { overModelPct: fit.recommendedOverPct })}>
              use recommended
            </button>
          </Field>
        </Panel>
      </div>

      <Panel title={`${shortMonth} ${plan.year} recommended spend`}>
        <div className="mb-3 flex flex-wrap items-end gap-4">
          <Field label="Optimize for">
            <select className={inputClass} disabled={cur.closed} value={cur.closed ? "other" : cur.m.optimizeFor} onChange={(e) => setMonth(cur.key, { optimizeFor: e.target.value as OptimizeFor, ...(e.target.value === "other" ? { spend: Math.round(cur.spend) } : {}) })}>
              {(Object.keys(OPTIMIZE_LABELS) as OptimizeFor[]).map((k) => (
                <option key={k} value={k}>
                  {OPTIMIZE_LABELS[k]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Spend (counts toward aMER)">
            <NumField value={cur.spend} className="w-28" disabled={cur.closed || cur.m.optimizeFor !== "other"} onCommit={(v) => setMonth(cur.key, { spend: v })} />
          </Field>
          <div className="mb-3 text-center">
            <div className="text-[11px] text-text-muted">aMER</div>
            <div className="text-2xl font-semibold text-accent tabular">{cur.point ? cur.point.amer.toFixed(2) : "–"}</div>
            {lyAmer != null && <div className="text-[11px] text-text-faint">vs LY {lyAmer.toFixed(2)}</div>}
          </div>
        </div>
        <div className="mb-2 flex items-center gap-2 text-xs">
          <span className="text-text-muted">Chart</span>
          {(["revenue", "amer"] as const).map((v) => (
            <button key={v} className={v === view ? btnPrimary : btn} onClick={() => setView(v)}>
              {v === "revenue" ? "Revenue vs spend" : "aMER vs spend"}
            </button>
          ))}
          <span className="text-text-faint">each dot is one past day at a monthly pace ({cur.days} days); the dotted line is the model</span>
        </div>
        <ScatterCurve points={scatter} curve={curve} xFmt={(v) => formatValue(v, "currency0", client.currency)} yFmt={view === "revenue" ? (v) => formatValue(v, "currency0", client.currency) : undefined} />
        {cur.closed && <p className="mt-1 rounded-lg bg-accent/10 p-2 text-xs">{shortMonth} is closed: the table above shows what actually happened ({money(cur.spend)} spend). The model only forecasts open months.</p>}
        {maxAtEdge && (
          <p className="mt-1 rounded-lg bg-bad/10 p-2 text-xs text-bad">
            Max CM sits at the top of the spend this client has actually run ({money(cur.cap)} a month at the 95th-percentile day). In this range each extra dollar returns more than it costs, so the straight line never says when it stops paying back. Treat it as &quot;the history supports spending up to here&quot;, not as the optimum. The aMER line and flattening curve (Model parameters, curve shape) show diminishing returns if you want to compare.
          </p>
        )}
        <Legend
          items={[
            { label: "Historical days", color: "#888" },
            { label: "Selected", color: "#ef4444" },
            { label: "Modeled", color: "#facc15" },
            { label: `${shortMonth} last year`, color: "#f97316" },
            { label: `${shortMonth} this year`, color: "#38bdf8" },
            { label: "Max points", color: "#22c55e" },
          ]}
        />

        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[1000px] border-collapse text-xs">
            <thead>
              <tr className="border-b border-border text-text-muted">
                <th className="w-28 px-2 py-1.5" />
                <th className={th}>Spend</th>
                <th className={th}>aMER</th>
                <th className={th}>CAC</th>
                <th className={th}>Inc. aMER</th>
                <th className={th}>Inc. CAC</th>
                <th className={th}>Orders</th>
                <th className={th}>New order revenue</th>
                <th className={th}>CM</th>
                <th className={th}>60-day revenue</th>
                <th className={th}>60-day CM</th>
                <th className={th}>1-year revenue</th>
                <th className={th}>1-year CM</th>
              </tr>
            </thead>
            <tbody>
              {cur.table?.points.map((p, i) => {
                const marks = markerRows.filter((mr) => cur.table!.best[mr.key] === i);
                const isSel = Math.abs(p.spend - cur.spend) < (cur.table!.points[1]?.spend - cur.table!.points[0]?.spend || 1) / 2;
                const hl = (key: Exclude<OptimizeFor, "other">) => (cur.table!.best[key] === i ? "bg-good/30 font-semibold" : "");
                return (
                  <tr key={p.spend} className={`cursor-pointer border-b border-border/40 hover:bg-accent/10 ${isSel ? "bg-accent/15" : ""} ${p.spend > cur.cap + 1e-9 ? "italic text-text-faint" : ""}`} onClick={() => !cur.closed && setMonth(cur.key, { optimizeFor: "other", spend: p.spend })}>
                    <td className="px-2 py-1 text-left font-medium text-accent">{marks.map((m) => m.label).join(", ")}</td>
                    <td className={td}>{money(p.spend)}</td>
                    <td className={td}>{p.amer.toFixed(2)}</td>
                    <td className={td}>{money(p.cac)}</td>
                    <td className={td}>{p.incAmer.toFixed(2)}</td>
                    <td className={td}>{p.incCac ? money(p.incCac) : "–"}</td>
                    <td className={td}>{Math.round(p.orders).toLocaleString()}</td>
                    <td className={`${td} ${hl("revenue")}`}>{money(p.newRevenue)}</td>
                    <td className={`${td} ${hl("cm")}`}>{money(p.cm)}</td>
                    <td className={td}>{money(p.ltv60Revenue)}</td>
                    <td className={`${td} ${hl("cm60")}`}>{money(p.ltv60Cm)}</td>
                    <td className={td}>{money(p.ltv365Revenue)}</td>
                    <td className={`${td} ${hl("cm365")}`}>{money(p.ltv365Cm)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-text-faint">Click a row to use that spend. Max CM pays back on the first order; Max 60-day CM is the spend that still pays back within 60 days; Max 1-year CM within a year; Max Revenue at break-even is the most new revenue you can buy while the first order still covers its costs. Greyed italic rows are above the spend the history has seen (the 95th-percentile day, sustained all month): the line is extrapolated there.</p>
      </Panel>

      <Panel title="How to read this">
        <p className="max-w-4xl text-sm text-text-muted">
          <b className="text-text">Spending power</b> is how much spend the business can absorb before aMER falls. A curve that sits low (poor aMER even at low spend) can point to creative fatigue, or to an audience that is nearly used up: test new creative or aim at a broader audience (a bigger addressable market). A curve that stays high as spend rises means more of the acquisition machine has been unlocked, so the business can spend more at the same efficiency. When a month of work moves the curve, use <i>Actualize with recent data</i> so next month&apos;s plan starts from the new curve.
        </p>
      </Panel>
    </div>
  );
}
