"use client";

import { useMemo, useState } from "react";
import { addYears, endOfMonth } from "@/lib/dates";
import { formatValue } from "@/lib/format";
import { aggregate } from "@/lib/metrics";
import type { ReturningResults } from "@/lib/planning/models";
import { forecastReturning } from "@/lib/planning/returning";
import { btn, btnPrimary, inputClass, MONTHS } from "../ui";
import { LineChart, Legend } from "./charts";
import type { ModelCtx } from "./ModelsStep";

const YEAR_COLORS = ["#5eead4", "#e11d48", "#facc15", "#fb923c"];

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <h3 className="mb-3 text-sm font-semibold">{title}</h3>
      {children}
    </div>
  );
}

export function ReturningModel({ mc }: { mc: ModelCtx }) {
  const { ctx, facts, lastData, cohort, retSettings: S, setRetSettings } = mc;
  const { plan, client, months, rows, editInputs } = ctx;
  const money = (v: number | null) => formatValue(v, "currency0", client.currency);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const year = plan.year;

  /* ---- actual returning revenue per complete month ---- */
  const monthly = useMemo(() => {
    const m = new Map<string, { rev: number; orders: number }>();
    for (const f of facts) {
      const k = `${f.date.slice(0, 7)}-01`;
      const x = m.get(k) ?? { rev: 0, orders: 0 };
      x.rev += f.returningOrderRevenue;
      x.orders += f.returningOrders;
      m.set(k, x);
    }
    return m;
  }, [facts]);
  const lastComplete = endOfMonth(`${lastData.slice(0, 7)}-01`) === lastData ? `${lastData.slice(0, 7)}-01` : addMonthKey(`${lastData.slice(0, 7)}-01`, -1);
  const actualReturning = useMemo(() => {
    const out: Record<string, number> = {};
    for (const [k, v] of monthly) if (k <= lastComplete) out[k] = v.rev;
    return out;
  }, [monthly, lastComplete]);

  /* ---- future cohorts: the new revenue the plan expects (gap months use the recent average) ---- */
  const futureNew = useMemo(() => {
    const out: Record<string, number> = {};
    const planned = new Map(months.map((m) => [m.month, (rows[m.month] ?? []).reduce((a, r) => a + r.newRevenue, 0)]));
    const recent = facts.filter((f) => f.date > addMonthEnd(lastComplete, -3) && f.date <= endOfMonth(lastComplete));
    const avgNew = recent.length ? aggregate(recent).newOrderRevenue / 3 : 0;
    const last = months[months.length - 1]?.month ?? `${year}-12-01`;
    for (let k = addMonthKey(lastComplete, 1); k <= last; k = addMonthKey(k, 1)) {
      const p = planned.get(k);
      out[k] = p && p > 0 ? p : avgNew;
    }
    return out;
  }, [months, rows, facts, lastComplete, year]);
  const missingPlan = months.filter((m) => m.month > lastComplete && !(rows[m.month]?.length)).length;

  const result = useMemo(() => {
    if (!cohort.available) return null;
    return forecastReturning({
      cohorts: cohort.cohorts,
      actualReturning,
      lastData,
      futureNew,
      from: `${Math.min(year, Number(lastData.slice(0, 4)))}-01-01`,
      to: months[months.length - 1]?.month ?? `${year}-12-01`,
      window: S.window,
      calibrationMonths: S.calibrationMonths,
      seasonality: S.seasonality,
    });
  }, [cohort, actualReturning, lastData, futureNew, year, months, S.window, S.calibrationMonths, S.seasonality]);

  const build = async () => {
    setBusy(true);
    setNote(null);
    const err = await mc.rebuildCohorts();
    setBusy(false);
    setNote(err ? { tone: "bad", text: `${err}. If it says a table or function does not exist, migration 0007 has not been applied to the database yet.` } : { tone: "ok", text: "Cohorts rebuilt from all orders." });
  };

  const modelByMonth = new Map((result?.months ?? []).map((m) => [m.month, m]));
  const planMonths = months.map((m) => ({ m, r: modelByMonth.get(m.month) }));

  const saveAndApply = async () => {
    if (!result) return;
    setBusy(true);
    setNote(null);
    let applied = 0;
    let skipped = 0;
    for (const { m, r } of planMonths) {
      if (!r || r.kind === "actual") continue;
      if (m.locked) {
        skipped += 1;
        continue;
      }
      editInputs(
        m.month,
        (i) => {
          const model = Math.round(r.total);
          return { ...i, returningModel: model, returningRevenue: i.returningOverride != null ? i.returningOverride : model };
        },
        true,
      );
      applied += 1;
    }
    const results: ReturningResults = {
      fittedAt: new Date().toISOString(),
      calibration: result.calibration,
      r2: result.fit.r2,
      mape: result.fit.mape,
      months: result.months.filter((x) => x.kind === "forecast").map((x) => ({ month: x.month, total: x.total, preCohort: x.preCohort, knownCohorts: x.knownCohorts, futureCohorts: x.futureCohorts })),
    };
    mc.setRetResults(results);
    const err = await mc.saveModel("returning", S, results, S.calibrationMonths ? `Saved returning model (actualized on last ${S.calibrationMonths} months)` : "Saved returning model");
    setBusy(false);
    setNote(
      err
        ? { tone: "bad", text: err }
        : { tone: "ok", text: `Returning revenue was filled into Details for ${applied} month${applied === 1 ? "" : "s"}${skipped ? ` (${skipped} locked skipped)` : ""}. Overrides you typed there are kept. Press Save plan to update the daily targets.` },
    );
  };

  /* ---- chart and annual table data ---- */
  const years = useMemo(() => {
    const first = Number(facts[0]?.date.slice(0, 4) ?? year);
    return Array.from({ length: Math.min(4, year - Math.max(first, year - 3) + 1) }, (_, i) => Math.max(first, year - 3) + i);
  }, [facts, year]);
  const avgAov = useMemo(() => {
    const t = aggregate(facts.filter((f) => f.date > addYears(lastData, -1)));
    return t.returningOrders > 0 ? t.returningOrderRevenue / t.returningOrders : 0;
  }, [facts, lastData]);
  const cellFor = (y: number, mi: number) => {
    const k = `${y}-${String(mi + 1).padStart(2, "0")}-01`;
    if (y === year && result) {
      const r = modelByMonth.get(k);
      if (r && r.kind === "forecast") return { rev: r.total, orders: avgAov > 0 ? r.total / avgAov : 0, forecast: true };
    }
    const a = monthly.get(k);
    return a ? { rev: a.rev, orders: a.orders, forecast: false } : null;
  };

  const labels = MONTHS;
  const series = years.flatMap((y, i) => {
    const color = YEAR_COLORS[i % YEAR_COLORS.length];
    const vals = labels.map((_, mi) => cellFor(y, mi));
    if (y !== year) return [{ label: String(y), color, values: vals.map((v) => v?.rev ?? null) }];
    return [
      { label: `${y} actual`, color, values: vals.map((v) => (v && !v.forecast ? v.rev : null)) },
      { label: `${y} forecast`, color, dashed: true, values: vals.map((v, i2) => (v?.forecast || (vals[i2 + 1]?.forecast && v) ? v!.rev : null)) },
    ];
  });

  const lifts = result?.lifts.slice(0, 12) ?? [];
  const pct = (v: number | null) => (v == null ? "·" : `${(v * 100).toFixed(2)}%`);
  const calText =
    result && S.calibrationMonths > 0
      ? result.calibration >= 1.005
        ? `Recent cohorts are retaining ${((result.calibration - 1) * 100).toFixed(0)}% better than the model, so the forecast is scaled up ×${result.calibration.toFixed(2)}.`
        : result.calibration <= 0.995
          ? `Recent cohorts are retaining ${((1 - result.calibration) * 100).toFixed(0)}% worse than the model, so the forecast is scaled down ×${result.calibration.toFixed(2)}.`
          : "Recent cohorts match the model; nothing to adjust."
      : null;

  const th = "px-2 py-1.5 text-right font-medium";
  const td = "px-2 py-1 text-right tabular";

  if (!cohort.available)
    return (
      <div className="space-y-3 rounded-xl border border-border bg-surface p-6 text-sm">
        <h3 className="text-lg font-semibold" style={{ fontFamily: "var(--apex-font-heading)" }}>
          {year} Retention Model
        </h3>
        <p className="max-w-2xl text-text-muted">
          The model learns from cohorts: every month&apos;s new customers and how much they keep buying. They are built from all stored orders since the store began. Build them once, and again whenever you want to refresh them.
        </p>
        <button className={btnPrimary} onClick={build} disabled={busy}>
          {busy ? "Building…" : "Build cohorts from orders"}
        </button>
        {note && <p className={note.tone === "ok" ? "text-good" : "text-bad"}>{note.text}</p>}
      </div>
    );

  if (!result)
    return (
      <div className="space-y-2 rounded-xl border border-border bg-surface p-6 text-sm">
        <p className="font-medium">Not enough cohort history yet.</p>
        <p className="text-text-muted">The model needs at least 3 monthly cohorts with a few months of repeat purchases ({cohort.cohorts.length} found).</p>
        <button className={btn} onClick={build} disabled={busy}>
          Rebuild cohorts
        </button>
      </div>
    );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="mr-auto text-lg font-semibold" style={{ fontFamily: "var(--apex-font-heading)" }}>
          {year} Retention Model
        </h3>
        <button className={btn} onClick={build} disabled={busy}>
          Rebuild cohorts
        </button>
        <button className={btnPrimary} onClick={saveAndApply} disabled={busy}>
          {busy ? "Saving…" : "Save & fill Details"}
        </button>
      </div>
      {note && <p className={`rounded-lg border p-3 text-sm ${note.tone === "ok" ? "border-good/40 bg-good/10 text-good" : "border-bad/40 bg-bad/10 text-bad"}`}>{note.text}</p>}
      {missingPlan > 0 && <p className="rounded-lg border border-border bg-surface p-3 text-xs text-text-muted">{missingPlan} upcoming plan month(s) have no spend or aMER yet. Apply the New Customer Model first so their new customers are counted; until then the recent average new revenue is used for them.</p>}

      <Panel title="Model results">
        <div className="grid gap-4 text-sm md:grid-cols-2">
          <div className="space-y-1">
            <p>
              <span className="text-text-muted">Cohorts learned from:</span> {result.cohortsUsed} monthly cohorts (all history); lift curve from the latest {S.window}.
            </p>
            <p>
              <span className="text-text-muted">Fit over the last {result.fit.months} months:</span>{" "}
              {result.fit.r2 != null ? `R² ${result.fit.r2.toFixed(2)}` : "R² n/a"}
              {result.fit.mape != null ? ` · average miss ${result.fit.mape.toFixed(0)}%` : ""}
            </p>
            <p className="text-xs text-text-muted">
              Returning revenue = revenue still coming from existing cohorts + revenue from the cohorts the plan will acquire (new revenue × the same lifts) + the old pre-history customers, which fade out. Past years&apos; calendar pattern (e.g. November) is applied.
            </p>
          </div>
          <div className="space-y-2 text-sm">
            <label className="flex flex-wrap items-center gap-2">
              Cohorts in the lift curve
              <select className={inputClass} value={S.window} onChange={(e) => setRetSettings((s) => ({ ...s, window: Number(e.target.value) }))}>
                {[6, 12, 18, 24].map((n) => (
                  <option key={n} value={n}>
                    latest {n}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={S.seasonality} onChange={(e) => setRetSettings((s) => ({ ...s, seasonality: e.target.checked }))} />
              Apply calendar-month pattern from past years
            </label>
            <label className="flex flex-wrap items-center gap-2">
              Actualize on recent months
              <select className={inputClass} value={S.calibrationMonths} onChange={(e) => setRetSettings((s) => ({ ...s, calibrationMonths: Number(e.target.value) }))}>
                <option value={0}>Off</option>
                {[1, 2, 3, 4, 6].map((n) => (
                  <option key={n} value={n}>
                    last {n} month{n === 1 ? "" : "s"}
                  </option>
                ))}
              </select>
            </label>
            {calText && <p className="text-xs text-accent">{calText}</p>}
            <p className="text-xs text-text-faint">Use Actualize a couple of months after a change (e.g. a subscription launch) so the forecast follows how customers really behave now.</p>
          </div>
        </div>
      </Panel>

      <Panel title="Returning order revenue: actuals vs forecast">
        <LineChart series={series} labels={labels} yFmt={(v) => formatValue(v, "currency0", client.currency)} />
        <Legend items={series.map((s) => ({ label: s.label, color: s.color }))} />
      </Panel>

      <Panel title="Forecast by month">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] border-collapse text-xs">
            <thead>
              <tr className="border-b border-border text-text-muted">
                <th className="px-2 py-1.5 text-left font-medium">Month</th>
                <th className={th}>Existing cohorts</th>
                <th className={th}>Future cohorts</th>
                <th className={th}>Pre-history customers</th>
                <th className={th}>Model returning revenue</th>
                <th className={th}>Last year</th>
                <th className={th}>In plan now</th>
              </tr>
            </thead>
            <tbody>
              {planMonths.map(({ m, r }) => {
                const ly = monthly.get(addYears(m.month, -1))?.rev ?? null;
                return (
                  <tr key={m.month} className="border-b border-border/50">
                    <td className="px-2 py-1">{MONTHS[Number(m.month.slice(5, 7)) - 1]}</td>
                    <td className={td}>{r ? money(r.knownCohorts) : "–"}</td>
                    <td className={td}>{r && r.kind === "forecast" ? money(r.futureCohorts) : "–"}</td>
                    <td className={td}>{r ? money(r.preCohort) : "–"}</td>
                    <td className={`${td} font-medium`}>
                      {r ? money(r.total) : "–"}
                      {r?.kind === "actual" && <span className="ml-1 text-text-faint">actual</span>}
                    </td>
                    <td className={td}>{money(ly)}</td>
                    <td className={td}>
                      {m.inputs ? money(m.inputs.returningRevenue) : "–"}
                      {m.inputs?.returningOverride != null && <span className="ml-1 text-accent">override</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="Annual returning data">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs" style={{ minWidth: 200 + years.length * 280 }}>
            <thead>
              <tr className="border-b border-border text-text-muted">
                <th className="px-2 py-1.5 text-left font-medium">Month</th>
                {years.map((y) => (
                  <th key={y} colSpan={3} className="border-l border-border px-2 py-1.5 text-center font-medium">
                    {y}
                    {y === year ? " (actual + forecast)" : ""}
                  </th>
                ))}
              </tr>
              <tr className="border-b border-border text-text-faint">
                <th />
                {years.flatMap((y) => ["Orders", "Revenue", "AOV"].map((h) => <th key={`${y}${h}`} className={th}>{h}</th>))}
              </tr>
            </thead>
            <tbody>
              {labels.map((l, mi) => (
                <tr key={l} className="border-b border-border/40">
                  <td className="px-2 py-1">{l}</td>
                  {years.flatMap((y) => {
                    const c = cellFor(y, mi);
                    const tone = c?.forecast ? "bg-good/10" : "";
                    return [
                      <td key={`${y}o`} className={`${td} ${tone} border-l border-border/40`}>{c ? Math.round(c.orders).toLocaleString() : ""}</td>,
                      <td key={`${y}r`} className={`${td} ${tone}`}>{c ? money(c.rev) : ""}</td>,
                      <td key={`${y}a`} className={`${td} ${tone}`}>{c && c.orders > 0 ? (c.rev / c.orders).toFixed(2) : ""}</td>,
                    ];
                  })}
                </tr>
              ))}
              <tr className="bg-bg font-medium">
                <td className="px-2 py-1.5">Total</td>
                {years.flatMap((y) => {
                  const cs = labels.map((_, mi) => cellFor(y, mi));
                  const rev = cs.reduce((a, c) => a + (c?.rev ?? 0), 0);
                  const orders = cs.reduce((a, c) => a + (c?.orders ?? 0), 0);
                  return [
                    <td key={`${y}o`} className={`${td} border-l border-border/40`}>{Math.round(orders).toLocaleString()}</td>,
                    <td key={`${y}r`} className={td}>{money(rev)}</td>,
                    <td key={`${y}a`} className={td}>{orders > 0 ? (rev / orders).toFixed(2) : ""}</td>,
                  ];
                })}
              </tr>
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="Modeled lifts: repeat revenue as % of first-order revenue, by age">
        <LineChart
          labels={lifts.map((_, i) => `M${i + 1}`)}
          yFmt={(v) => `${(v * 100).toFixed(0)}%`}
          series={[
            { label: "Modeled", color: "#facc15", values: lifts },
            ...result.matrix.slice(-3).map((c, i) => ({ label: c.month.slice(0, 7), color: ["#5eead4", "#e11d48", "#a78bfa"][i], values: c.actual })),
          ]}
        />
        <Legend items={[{ label: "Modeled", color: "#facc15" }, ...result.matrix.slice(-3).map((c, i) => ({ label: `${c.month.slice(0, 7)} actual`, color: ["#5eead4", "#e11d48", "#a78bfa"][i] }))]} />
        <p className="mb-2 mt-4 text-sm font-medium">Actual (gray) vs modeled lifts</p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-xs">
            <thead>
              <tr className="border-b border-border text-text-muted">
                <th className="px-2 py-1.5 text-left font-medium">Cohort</th>
                {lifts.map((_, i) => (
                  <th key={i} className={th}>
                    M{i + 1}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-border bg-accent/10 font-medium">
                <td className="px-2 py-1">Modeled</td>
                {lifts.map((l, i) => (
                  <td key={i} className={td}>
                    {pct(l)}
                  </td>
                ))}
              </tr>
              {result.matrix.map((c) => (
                <tr key={c.month} className="border-b border-border/40">
                  <td className="px-2 py-1">{c.month.slice(0, 7)}</td>
                  {c.actual.map((a, i) => (
                    <td key={i} className={`${td} ${a != null ? "bg-border/40" : "text-text-faint italic"}`}>
                      {a != null ? pct(a) : pct(lifts[i] ?? null)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-text-faint">Italic = not observed yet; the modeled value is used there. M1 = days 0–30 after the first order, M2 = days 31–60, and so on.</p>
      </Panel>
    </div>
  );
}

/** First day of the month `n` months from `k` (YYYY-MM-01). */
function addMonthKey(k: string, n: number): string {
  const i = Number(k.slice(0, 4)) * 12 + Number(k.slice(5, 7)) - 1 + n;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}-01`;
}

/** Last day of the month `n` months from the month of `k`. */
function addMonthEnd(k: string, n: number): string {
  return endOfMonth(addMonthKey(k, n));
}
