"use client";

import Link from "next/link";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { endOfMonth } from "@/lib/dates";
import { formatValue, type Format } from "@/lib/format";
import { DEFAULT_NEW_CUSTOMER, type NewCustomerSettings } from "@/lib/planning/models";
import { aboveModelPct, fitPlanModel, isStretchMonth, seasonIndex } from "@/lib/planning/plan-fit";
import { pickPlan, stretchOf } from "@/lib/planning/scenarios";
import type { StretchFlag } from "@/lib/planning/stretch";
import { checkStretch, createStretch, regenerateStretch, type StretchCtx, type StretchOutcome } from "@/lib/planning/stretch-actions";
import { actualFigures, buildSummaryGrid, forecastFigures, formatChange, goalCheck, monthFlags, planFigures, type MonthFigures, type SummaryKey } from "@/lib/planning/summary";
import type { PlanMonth } from "@/lib/planning/types";
import { getRepository } from "@/lib/repository";
import type { PlanTargetDay, PlanVersion, StretchGoal } from "@/lib/types";
import type { PlanCtx } from "./ctx";
import { btn, btnPrimary, inputClass, MONTHS } from "./ui";

type View = "baseline" | "stretch" | "compare";
type Basis = "plan" | "forecast";
type Extra = "lastYear" | "yoy" | "mom" | "share";

const EXTRAS: { id: Extra; label: string }[] = [
  { id: "lastYear", label: "Last year" },
  { id: "yoy", label: "vs last year" },
  { id: "mom", label: "vs previous month" },
  { id: "share", label: "% of year" },
];

const GOALS: { id: StretchGoal["metric"]; label: string; suffix: string }[] = [
  { id: "newRevenueGrowth", label: "New revenue growth vs last year", suffix: "%" },
  { id: "totalRevenueGrowth", label: "Total revenue growth vs last year", suffix: "%" },
  { id: "totalRevenue", label: "Total revenue for the year", suffix: "" },
];

const FLAG_TEXT: Record<StretchFlag, string> = {
  beyond_history: "beyond history",
  cm_negative: "CM below 0",
  cm_below_floor: "CM under floor",
  amer_below_floor: "aMER under floor",
  unreachable: "model can't reach",
};

interface Saved {
  months: PlanMonth[];
  rows: PlanTargetDay[];
}

const daysIn = (key: string) => Number(endOfMonth(key).slice(8, 10));
/** Same rule as the rest of the app: within 10% is neutral, beyond it green when better and red when worse. */
const tone = (v: number | null, higherIsBetter: boolean) => (v === null || Math.abs(v) <= 0.1 ? "text-text-muted" : (v > 0) === higherIsBetter ? "text-good" : "text-bad");

/** Step 2: the plan month by month against last year, with the stretch scenario and a comparison of the two. */
export function SummaryStep({ ctx }: { ctx: PlanCtx }) {
  const { plan, client, settings, history, seasonality } = ctx;
  const year = plan.year;
  const money = (v: number | null, f: Format = "currency0") => formatValue(v, f, client.currency);

  const [plans, setPlans] = useState<PlanVersion[] | null>(null);
  const [rev, setRev] = useState(0);
  const [other, setOther] = useState<Saved | null>(null);
  const [nc, setNc] = useState<NewCustomerSettings | null>(null);
  const [view, setView] = useState<View>(plan.scenario === "target" ? "stretch" : "baseline");
  const [basis, setBasis] = useState<Basis>("plan");
  const [extras, setExtras] = useState<Set<Extra>>(new Set(["lastYear", "yoy"]));
  const [note, setNote] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [preflight, setPreflight] = useState<{ ok: true } | { ok: false; reason: string } | null>(null);
  const [metric, setMetric] = useState<StretchGoal["metric"]>("newRevenueGrowth");
  const [goalText, setGoalText] = useState("20");
  const [floors, setFloors] = useState({ cm: "", amer: "" });
  const sctx: StretchCtx = { clientId: client.id, settings, history, openPlanId: plan.id, seasonality, eventMults: ctx.eventMults };

  useEffect(() => {
    let cancel = false;
    getRepository()
      .listPlans(client.id)
      .then((p) => !cancel && setPlans(p));
    return () => {
      cancel = true;
    };
  }, [client.id, rev]);

  const baselinePlan = useMemo(() => (plans ? (plan.scenario === "baseline" ? plan : (plans.find((p) => p.id === plan.baseId) ?? pickPlan(plans, year, "baseline"))) : undefined), [plans, plan, year]);
  const stretchPlan = useMemo(() => (plans ? (plan.scenario === "target" ? plan : stretchOf(plans, year)) : undefined), [plans, plan, year]);
  const otherPlan = plan.scenario === "baseline" ? stretchPlan : baselinePlan;

  // The plan that is open comes from the editor (including unsaved edits); the other scenario is read from what is saved.
  useEffect(() => {
    let cancel = false;
    (async () => {
      if (!otherPlan) return setOther(null);
      const repo = getRepository();
      const [months, rows] = await Promise.all([repo.getPlanMonths(otherPlan.id), repo.getPlanTargets(client.id, otherPlan.id, `${year}-01-01`, `${year}-12-31`)]);
      if (!cancel) setOther({ months, rows });
    })();
    return () => {
      cancel = true;
    };
  }, [otherPlan, client.id, year, rev]);

  useEffect(() => {
    let cancel = false;
    (async () => {
      if (!baselinePlan) return;
      const saved = await getRepository().getPlanModel(baselinePlan.id, "new_customer");
      if (!cancel) setNc(saved ? ({ ...DEFAULT_NEW_CUSTOMER, months: {}, ...(saved.settings as Partial<NewCustomerSettings>) } as NewCustomerSettings) : null);
    })();
    return () => {
      cancel = true;
    };
  }, [baselinePlan, rev]);

  useEffect(() => {
    if (!baselinePlan || stretchPlan || history.loading) return;
    let cancel = false;
    checkStretch(getRepository(), sctx, baselinePlan)
      .then((c) => !cancel && setPreflight(c))
      .catch(() => !cancel && setPreflight({ ok: false, reason: "Could not check the models. Try again." }));
    return () => {
      cancel = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baselinePlan, stretchPlan, history.loading, rev]);

  const lastData = history.lastData;
  const own: Saved = useMemo(() => ({ months: ctx.months, rows: Object.values(ctx.rows).flat() }), [ctx.months, ctx.rows]);
  const dataOf = (p: PlanVersion | undefined): Saved | null => (!p ? null : p.id === plan.id ? own : other?.months && otherPlan?.id === p.id ? other : null);

  const ended = (m: MonthFigures) => Boolean(lastData) && endOfMonth(m.month) <= lastData;
  const lastYear = useMemo(() => actualFigures(history.facts, year - 1, settings), [history.facts, year, settings]);
  const actual = useMemo(() => actualFigures(history.facts, year, settings), [history.facts, year, settings]);
  const figuresOf = useCallback(
    (p: PlanVersion | undefined): MonthFigures[] | null => {
      const d = dataOf(p);
      if (!d) return null;
      const f = planFigures(d.rows, d.months, year, settings);
      return basis === "forecast" ? forecastFigures(f, actual, f.map(ended)) : f;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [own, other, otherPlan, year, settings, basis, actual, lastData, plan.id],
  );
  const baseFig = useMemo(() => figuresOf(baselinePlan), [figuresOf, baselinePlan]);
  const stretchFig = useMemo(() => figuresOf(stretchPlan), [figuresOf, stretchPlan]);
  // The goal is about the year as it will turn out: actuals for months that have ended, the stretch after.
  const stretchData = dataOf(stretchPlan);
  const stretchYear = useMemo(() => {
    if (!stretchData) return null;
    const f = planFigures(stretchData.rows, stretchData.months, year, settings);
    return forecastFigures(f, actual, f.map(ended));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stretchData, year, settings, actual, lastData]);
  const check = stretchPlan?.goal && stretchYear ? goalCheck(stretchPlan.goal, stretchYear, lastYear) : null;

  const fit = useMemo(() => (nc && history.facts.length ? fitPlanModel(history.facts, settings, seasonality.dow, nc) : null), [nc, history.facts, settings, seasonality.dow]);
  const above = (f: MonthFigures[] | null) =>
    f?.map((m) => {
      if (!fit || !m.hasData) return null;
      const v = aboveModelPct(m.amer, m.acqSpend, daysIn(m.month), fit.curve, seasonIndex(fit, m.month));
      const over = nc?.months[m.month]?.overModelPct ?? fit.recommendedOverPct;
      return v === null ? null : { v, stretch: isStretchMonth(v, over) };
    }) ?? null;

  /** The goal typed in the form, or a sentence saying what is wrong with it. */
  const readGoal = (): StretchGoal | string => {
    const value = Number(goalText.replace(/[,\s%£$€]/g, ""));
    if (!goalText.trim() || !Number.isFinite(value) || value <= 0) return "Type a goal greater than 0.";
    const g: StretchGoal = { metric, value };
    for (const [key, text, name] of [["cmFloor", floors.cm, "minimum CM"], ["amerFloor", floors.amer, "minimum aMER"]] as const) {
      if (!text.trim()) continue;
      const n = Number(text.replace(/[,\s£$€]/g, ""));
      if (!Number.isFinite(n)) return `The ${name} is not a number.`;
      g[key] = n;
    }
    return g;
  };

  const run = async (fn: (g: StretchGoal) => Promise<StretchOutcome>, after?: () => void) => {
    const g = readGoal();
    if (typeof g === "string") return setNote({ tone: "bad", text: g });
    setBusy(true);
    setNote(null);
    try {
      const out = await fn(g);
      setNote(out.ok ? { tone: "ok", text: out.message } : { tone: "bad", text: out.reason });
      if (out.ok) {
        setRev((r) => r + 1);
        after?.();
      }
    } catch (e) {
      setNote({ tone: "bad", text: e instanceof Error ? e.message : "Something went wrong." });
    } finally {
      setBusy(false);
    }
  };

  const openCreate = () => baselinePlan && run((g) => createStretch(getRepository(), sctx, baselinePlan, g), () => setView("stretch"));

  const regenerate = () => {
    if (!stretchPlan || !baselinePlan) return;
    // The open plan is loaded once; regenerating it from under unsaved edits would lose them or be overwritten by the next Save.
    if (plan.id === stretchPlan.id && ctx.unsaved) return setNote({ tone: "bad", text: "Save the plan first, then regenerate." });
    return run((g) => regenerateStretch(getRepository(), sctx, stretchPlan, baselinePlan, g), () => {
      if (plan.id === stretchPlan.id) ctx.reload();
    });
  };

  // Start the goal fields from the saved goal the first time a stretch is shown.
  const [goalFor, setGoalFor] = useState<string | null>(null);
  if (stretchPlan?.goal && goalFor !== stretchPlan.id) {
    setGoalFor(stretchPlan.id);
    setMetric(stretchPlan.goal.metric);
    setGoalText(String(stretchPlan.goal.value));
    setFloors({ cm: stretchPlan.goal.cmFloor?.toString() ?? "", amer: stretchPlan.goal.amerFloor?.toString() ?? "" });
  }

  if (history.loading || !plans) return <div className="h-64 animate-pulse rounded-xl bg-surface" />;

  const shown = view === "stretch" ? stretchFig : baseFig;
  const shownPlan = view === "stretch" ? stretchPlan : baselinePlan;
  const hasStretch = Boolean(stretchPlan);
  const goalMeta = GOALS.find((g) => g.id === metric)!;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div role="tablist" aria-label="Scenario" className="flex overflow-hidden rounded-lg border border-border text-sm">
          {(
            [
              ["baseline", "Baseline", "Most likely"],
              ["stretch", "Stretch", "Would like"],
              ["compare", "Compare", ""],
            ] as const
          ).map(([id, label, sub]) => (
            <button key={id} role="tab" aria-selected={view === id} disabled={id !== "baseline" && !hasStretch} title={id !== "baseline" && !hasStretch ? "Create a stretch scenario first" : sub} onClick={() => setView(id)} className={`px-3 py-1.5 disabled:opacity-40 ${view === id ? "bg-accent font-medium text-black" : "text-text-muted hover:text-text"}`}>
              {label}
              {sub && <span className="ml-1 text-[10px] opacity-70">{sub}</span>}
            </button>
          ))}
        </div>
        <div role="group" aria-label="Basis" className="flex overflow-hidden rounded-lg border border-border text-sm">
          {(
            [
              ["plan", "Plan"],
              ["forecast", "Forecast"],
            ] as const
          ).map(([id, label]) => (
            <button key={id} aria-pressed={basis === id} onClick={() => setBasis(id)} title={id === "forecast" ? "Actuals for months that have ended, plan after" : "The plan as saved"} className={`px-3 py-1.5 ${basis === id ? "bg-surface-raised font-medium text-text" : "text-text-muted hover:text-text"}`}>
              {label}
            </button>
          ))}
        </div>
        {view !== "compare" && (
          <div className="ml-auto flex flex-wrap items-center gap-3 text-xs text-text-muted">
            {EXTRAS.map((e) => (
              <label key={e.id} className="flex items-center gap-1">
                <input type="checkbox" checked={extras.has(e.id)} onChange={(ev) => setExtras((s) => { const n = new Set(s); if (ev.target.checked) n.add(e.id); else n.delete(e.id); return n; })} />
                {e.label}
              </label>
            ))}
          </div>
        )}
      </div>

      {note && <p className={`rounded-lg border p-3 text-sm ${note.tone === "ok" ? "border-good/40 bg-good/10 text-good" : "border-bad/40 bg-bad/10 text-bad"}`}>{note.text}</p>}

      {view === "baseline" && !hasStretch && (
        <div className="rounded-xl border border-border bg-surface p-4 text-sm">
          <h3 className="mb-1 font-semibold">Create a stretch scenario</h3>
          {preflight && !preflight.ok ? (
            <p className="text-text-muted">{preflight.reason}</p>
          ) : !preflight ? (
            <p className="text-text-muted">Checking the models…</p>
          ) : (
            <>
              <p className="mb-3 text-xs text-text-muted">One number is enough: the stretch keeps the baseline&apos;s month shape, finds the spend the New Customer Model needs for it and the returning revenue the Returning Model gives, and copies the rest. It uses the saved baseline (press Save plan first if you changed it). Months that have ended and months you locked stay as they are.</p>
              <GoalFields metric={metric} setMetric={setMetric} goalText={goalText} setGoalText={setGoalText} floors={floors} setFloors={setFloors} suffix={goalMeta.suffix} />
              <button className={`${btnPrimary} mt-3`} disabled={busy} onClick={openCreate}>
                {busy ? "Creating…" : "Create stretch"}
              </button>
            </>
          )}
        </div>
      )}

      {view === "stretch" && stretchPlan && (
        <div className="rounded-xl border border-border bg-surface p-4 text-sm">
          <h3 className="mb-1 font-semibold">{stretchPlan.name}</h3>
          <p className="mb-3 text-xs text-text-muted">Regenerate recomputes the months that are not locked from the baseline&apos;s saved plan and this goal. Locked months keep their numbers.</p>
          <GoalFields metric={metric} setMetric={setMetric} goalText={goalText} setGoalText={setGoalText} floors={floors} setFloors={setFloors} suffix={goalMeta.suffix} />
          {check && (
            <p className="mt-3 text-xs text-text-muted">
              The year as it will turn out (actuals for months that have ended, the stretch after): {check.label.toLowerCase()} <b className="text-text">{money(check.actual)}</b> against the goal&apos;s <b className="text-text">{money(check.target)}</b>. Use Forecast above to see the grid on that basis; Plan shows ended months as the baseline planned them.
            </p>
          )}
          <button className={`${btn} mt-3`} disabled={busy} onClick={regenerate}>
            {busy ? "Regenerating…" : "Regenerate"}
          </button>
          {plan.id !== stretchPlan.id && (
            <Link href={`/planning/${stretchPlan.id}`} className="ml-3 text-xs text-accent hover:underline">
              Open the stretch plan →
            </Link>
          )}
        </div>
      )}

      {view !== "compare" && shown && shownPlan && <Grid figures={shown} lastYear={lastYear} extras={extras} money={money} above={above(shown)} hasModel={Boolean(fit)} flags={shown.map((m) => monthFlags(m, view === "stretch" ? shownPlan.goal : null, fit?.curve ?? null, daysIn(m.month)))} showFlags={view === "stretch"} />}
      {view !== "compare" && !shown && <p className="text-sm text-text-muted">No plan to show yet.</p>}
      {view === "compare" && baseFig && stretchFig && <Compare base={baseFig} stretch={stretchFig} actual={actual} lastData={lastData} money={money} aboveBase={above(baseFig)} aboveStretch={above(stretchFig)} />}
      <p className="text-xs text-text-faint">aMER here is new revenue over acquisition spend (brand search and retention spend are left out per Store Settings), not over all spend. Operating expenses are the plan month&apos;s SG&amp;A, else the client&apos;s monthly setting.</p>
    </div>
  );
}

function GoalFields({ metric, setMetric, goalText, setGoalText, floors, setFloors, suffix }: { metric: StretchGoal["metric"]; setMetric: (m: StretchGoal["metric"]) => void; goalText: string; setGoalText: (t: string) => void; floors: { cm: string; amer: string }; setFloors: (f: { cm: string; amer: string }) => void; suffix: string }) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="text-xs text-text-muted">
        Goal
        <select className={`${inputClass} mt-1 block`} value={metric} onChange={(e) => setMetric(e.target.value as StretchGoal["metric"])}>
          {GOALS.map((g) => (
            <option key={g.id} value={g.id}>
              {g.label}
            </option>
          ))}
        </select>
      </label>
      <label className="text-xs text-text-muted">
        Target {suffix && `(${suffix})`}
        <input className={`${inputClass} mt-1 block w-28 text-right`} inputMode="decimal" value={goalText} onChange={(e) => setGoalText(e.target.value)} />
      </label>
      <label className="text-xs text-text-muted">
        Min CM per month (optional)
        <input className={`${inputClass} mt-1 block w-28 text-right`} inputMode="decimal" value={floors.cm} onChange={(e) => setFloors({ ...floors, cm: e.target.value })} />
      </label>
      <label className="text-xs text-text-muted">
        Min aMER (optional)
        <input className={`${inputClass} mt-1 block w-24 text-right`} inputMode="decimal" value={floors.amer} onChange={(e) => setFloors({ ...floors, amer: e.target.value })} />
      </label>
    </div>
  );
}

const higherIsBetter = (k: SummaryKey) => k !== "opex";

function Grid({ figures, lastYear, extras, money, above, hasModel, flags, showFlags }: { figures: MonthFigures[]; lastYear: MonthFigures[]; extras: Set<Extra>; money: (v: number | null, f?: Format) => string; above: ({ v: number; stretch: boolean } | null)[] | null; hasModel: boolean; flags: StretchFlag[][]; showFlags: boolean }) {
  const grid = buildSummaryGrid(figures, lastYear);
  const cell = "px-2 py-1 text-right tabular whitespace-nowrap";
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-surface">
      <table className="w-full min-w-[1100px] text-sm">
        <thead>
          <tr className="border-b border-border text-xs text-text-muted">
            <th className="sticky left-0 bg-surface px-3 py-2 text-left font-medium">Metric</th>
            {MONTHS.map((m) => (
              <th key={m} className={`${cell} font-medium`}>
                {m}
              </th>
            ))}
            <th className={`${cell} font-medium`}>Year</th>
          </tr>
          {showFlags && flags.some((f) => f.length) && (
            <tr className="text-[10px] text-bad">
              <th className="sticky left-0 bg-surface px-3 py-1 text-left font-normal">Warnings</th>
              {flags.map((f, i) => (
                <th key={i} className={`${cell} font-normal`}>
                  {f.map((x) => FLAG_TEXT[x]).join(", ")}
                </th>
              ))}
              <th />
            </tr>
          )}
        </thead>
        <tbody>
          {grid.map((r) => (
            <Fragment key={r.key}>
              <tr className="border-t border-border/60">
                <th className="sticky left-0 bg-surface px-3 py-1 text-left font-medium">{r.label}</th>
                {r.months.map((m, i) => (
                  <td key={i} className={cell}>
                    {money(m.value, r.format)}
                  </td>
                ))}
                <td className={`${cell} font-medium`}>{money(r.total.value, r.format)}</td>
              </tr>
              {extras.has("lastYear") && (
                <SubRow label="Last year" cells={r.months.map((m) => money(m.lastYear, r.format))} total={money(r.total.lastYear, r.format)} />
              )}
              {extras.has("yoy") && <SubRow label="vs last year" cells={r.months.map((m) => formatChange(m.yoy))} total={formatChange(r.total.yoy)} tones={[...r.months.map((m) => tone(m.yoy, higherIsBetter(r.key))), tone(r.total.yoy, higherIsBetter(r.key))]} />}
              {extras.has("mom") && <SubRow label="vs previous month" cells={r.months.map((m) => formatChange(m.mom))} total="" tones={r.months.map((m) => tone(m.mom, higherIsBetter(r.key)))} />}
              {extras.has("share") && r.months.some((m) => m.share !== null) && <SubRow label="% of year" cells={r.months.map((m) => (m.share === null ? "–" : `${(m.share * 100).toFixed(1)}%`))} total="100%" />}
            </Fragment>
          ))}
          {hasModel && above && (
            <tr className="border-t-2 border-border">
              <th className="sticky left-0 bg-surface px-3 py-1 text-left font-medium" title="Plan aMER against what the New Customer Model gives at that acquisition spend and season, without the over-model % you set">
                Above model
              </th>
              {above.map((a, i) => (
                <td key={i} className={`${cell} ${a?.stretch ? "font-medium text-accent" : "text-text-muted"}`}>
                  {a ? `${a.v > 0 ? "+" : ""}${a.v.toFixed(0)}%` : "–"}
                  {a?.stretch && <span className="ml-1 rounded bg-accent/20 px-1 text-[10px]">stretch</span>}
                </td>
              ))}
              <td />
            </tr>
          )}
        </tbody>
      </table>
      {!hasModel && <p className="border-t border-border px-3 py-2 text-xs text-text-faint">Save the New Customer Model (Models tab) to see how far above the model each month sits.</p>}
    </div>
  );
}

function SubRow({ label, cells, total, tones }: { label: string; cells: string[]; total: string; tones?: string[] }) {
  return (
    <tr className="text-xs text-text-muted">
      <th className="sticky left-0 bg-surface px-3 pb-1 pl-6 text-left font-normal">{label}</th>
      {cells.map((c, i) => (
        <td key={i} className={`px-2 pb-1 text-right tabular whitespace-nowrap ${tones?.[i] ?? ""}`}>
          {c}
        </td>
      ))}
      <td className={`px-2 pb-1 text-right tabular whitespace-nowrap ${tones?.[12] ?? ""}`}>{total}</td>
    </tr>
  );
}

const COMPARE_ROWS: { key: SummaryKey; label: string; format: Format }[] = [
  { key: "spend", label: "Spend", format: "currency0" },
  { key: "newRevenue", label: "New revenue", format: "currency0" },
  { key: "returningRevenue", label: "Returning revenue", format: "currency0" },
  { key: "totalRevenue", label: "Total order revenue", format: "currency0" },
  { key: "cm", label: "Contribution margin", format: "currency0" },
  { key: "ebitda", label: "EBITDA", format: "currency0" },
  { key: "amer", label: "aMER", format: "ratio2" },
];

function Compare({ base, stretch, actual, lastData, money, aboveBase, aboveStretch }: { base: MonthFigures[]; stretch: MonthFigures[]; actual: MonthFigures[]; lastData: string; money: (v: number | null, f?: Format) => string; aboveBase: ({ v: number } | null)[] | null; aboveStretch: ({ v: number } | null)[] | null }) {
  const cell = "px-2 py-0.5 text-right tabular whitespace-nowrap";
  const val = (f: MonthFigures, k: SummaryKey) => (f.hasData ? f[k] : null);
  const total = (fs: MonthFigures[], k: SummaryKey): number | null => {
    const used = fs.filter((f) => f.hasData);
    if (!used.length) return null;
    if (k === "amer") {
      const acq = used.reduce((a, f) => a + f.acqSpend, 0);
      return acq > 0 ? used.reduce((a, f) => a + f.newRevenue, 0) / acq : null;
    }
    return used.reduce((a, f) => a + f[k], 0);
  };
  const ended = (i: number) => Boolean(lastData) && endOfMonth(base[i].month) <= lastData && actual[i].hasData;
  const anyEnded = base.some((_, i) => ended(i));
  const gap = (a: number | null, b: number | null, f: Format) => {
    if (a === null || b === null) return "–";
    const d = a - b;
    if (Math.abs(d) < (f === "ratio2" ? 0.005 : 0.5)) return money(0, f);
    return `${d > 0 ? "+" : ""}${money(d, f)}`;
  };
  const label = "sticky left-0 bg-surface px-3 py-0.5 pl-6 text-left text-xs font-normal text-text-muted";
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-surface">
      <table className="w-full min-w-[1100px] text-sm">
        <thead>
          <tr className="border-b border-border text-xs text-text-muted">
            <th className="sticky left-0 bg-surface px-3 py-2 text-left font-medium">Metric</th>
            {MONTHS.map((m) => (
              <th key={m} className={`${cell} font-medium`}>
                {m}
              </th>
            ))}
            <th className={`${cell} font-medium`}>Year</th>
          </tr>
        </thead>
        <tbody>
          {COMPARE_ROWS.map((r) => (
            <Fragment key={r.key}>
              <tr className="border-t border-border/60">
                <th colSpan={14} className="sticky left-0 bg-surface px-3 pt-2 pb-0.5 text-left text-sm font-medium">
                  {r.label}
                </th>
              </tr>
              <tr>
                <th className={label}>Baseline</th>
                {base.map((f, i) => (
                  <td key={i} className={cell}>
                    {money(val(f, r.key), r.format)}
                  </td>
                ))}
                <td className={`${cell} font-medium`}>{money(total(base, r.key), r.format)}</td>
              </tr>
              <tr className="text-accent">
                <th className={`${label} text-accent`}>Stretch</th>
                {stretch.map((f, i) => (
                  <td key={i} className={cell}>
                    {money(val(f, r.key), r.format)}
                  </td>
                ))}
                <td className={`${cell} font-medium`}>{money(total(stretch, r.key), r.format)}</td>
              </tr>
              <tr className="text-xs text-text-muted">
                <th className={label}>Gap</th>
                {stretch.map((f, i) => (
                  <td key={i} className={cell}>
                    {gap(val(f, r.key), val(base[i], r.key), r.format)}
                  </td>
                ))}
                <td className={cell}>{gap(total(stretch, r.key), total(base, r.key), r.format)}</td>
              </tr>
              {anyEnded && (
                <tr className="text-xs">
                  <th className={label}>Actual</th>
                  {actual.map((f, i) => (
                    <td key={i} className={cell}>
                      {ended(i) ? money(val(f, r.key), r.format) : "–"}
                    </td>
                  ))}
                  <td />
                </tr>
              )}
            </Fragment>
          ))}
          {aboveBase && aboveStretch && (
            <tr className="border-t-2 border-border">
              <th className="sticky left-0 bg-surface px-3 py-1 text-left font-medium" title="Plan aMER against what the New Customer Model gives at that spend and season">
                Above model: baseline / stretch
              </th>
              {aboveBase.map((a, i) => (
                <td key={i} className={`${cell} text-xs`}>
                  {a ? `${a.v.toFixed(0)}%` : "–"} / {aboveStretch[i] ? `${aboveStretch[i]!.v.toFixed(0)}%` : "–"}
                </td>
              ))}
              <td />
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
