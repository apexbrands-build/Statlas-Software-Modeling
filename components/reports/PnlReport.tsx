"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Empty, Loading, ReportFrame, selectClass } from "./ReportFrame";
import { NUMBER_MODES, PnlTable, type NumberMode } from "./PnlTable";
import { useApp } from "@/lib/app-context";
import { min, todayLocal } from "@/lib/dates";
import { buildPnl, REVENUE_BY_LABELS, type RevenueBy } from "@/lib/reports/pnl";
import { pnlColumns, type PnlMode } from "@/lib/reports/plan-pnl";
import { mixOf, planMixShares } from "@/lib/planning/mix";
import { planRoasTargets, roasOf } from "@/lib/planning/roas";
import type { PlanMonth } from "@/lib/planning/types";
import { getRepository } from "@/lib/repository";
import type { DailyFact, PlanTargetDay, PlanVersion } from "@/lib/types";

interface Loaded {
  key: string;
  facts: DailyFact[];
  lastData: string;
  plan: PlanVersion | null;
  planRows: PlanTargetDay[];
  /** SG&A per month from the plan (null = month has no plan inputs). */
  planFixed: (number | null)[];
  /** The plan's months: their ROAS targets and email / SMS / organic shares feed the plan and forecast columns. */
  planMonths: PlanMonth[];
}

const MODES: { id: PnlMode; label: string; hint: string }[] = [
  { id: "A", label: "Actual", hint: "What happened (Shopify and ad platforms)" },
  { id: "P", label: "Plan", hint: "The default plan for the year, all months" },
  { id: "F", label: "Forecast", hint: "Actuals so far, plan for the rest of the year" },
];

export function PnlReport() {
  const { client, settings } = useApp();
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const [pickedYear, setYear] = useState<number | null>(null);
  const year = pickedYear ?? (mounted ? Number(todayLocal().slice(0, 4)) : null);
  const [mode, setMode] = useState<NumberMode>("whole");
  const [compare, setCompare] = useState<PnlMode>("A");
  const [revenueBy, setRevenueBy] = useState<RevenueBy>("simplified");
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    if (!client || year === null) return;
    let cancel = false;
    (async () => {
      const repo = getRepository();
      const lastData = await repo.getLastDataDate(client.id);
      const facts = await repo.getFacts(client.id, `${year}-01-01`, min(`${year}-12-31`, lastData));
      const plans = await repo.listPlans(client.id);
      const plan = plans.find((p) => p.isDefault && p.year === year) ?? null;
      const planRows = plan ? await repo.getPlanTargets(client.id, plan.id, `${year}-01-01`, `${year}-12-31`) : [];
      const months = plan ? await repo.getPlanMonths(plan.id) : [];
      const planFixed = Array.from({ length: 12 }, (_, i) => {
        const m = months.find((x) => x.month === `${year}-${String(i + 1).padStart(2, "0")}-01`);
        return m?.inputs ? (m.inputs.fixedCosts ?? null) : null;
      });
      if (!cancel) setLoaded({ key: `${client.id}|${year}`, facts, lastData, plan, planRows, planFixed, planMonths: months });
    })();
    return () => {
      cancel = true;
    };
  }, [client, year]);

  const view = useMemo(() => {
    if (!client || !settings || year === null || !loaded || loaded.key !== `${client.id}|${year}`) return null;
    // Plan and forecast columns have no incremental / organic split, so Paid vs Organic falls back to New vs Returning.
    const by: RevenueBy = compare !== "A" && revenueBy === "paidOrganic" ? "newReturning" : revenueBy;
    const planFixed = loaded.planFixed.map((v) => v ?? settings.monthlyFixedCosts);
    const cols = pnlColumns(compare, year, loaded.facts, loaded.planRows, loaded.lastData, settings, planFixed, { roasOf: roasOf(planRoasTargets(loaded.planMonths, settings)), mixOf: mixOf(planMixShares(loaded.planMonths)) });
    const sections = buildPnl(cols.columns, settings, by, cols.fixed);
    const opRev = sections.flatMap((s) => s.rows).find((r) => r.key === "opRev")!.values;
    return { sections, opRev, status: cols.status, any: cols.columns[12] !== null && cols.columns[12]!.days > 0, swapped: by !== revenueBy };
  }, [client, settings, year, loaded, revenueBy, compare]);

  const thisYear = Number(todayLocal().slice(0, 4));
  return (
    <ReportFrame
      slug="pnl"
      range={null}
      controls={
        <>
          <div className="flex items-center gap-1 text-sm text-text-muted" role="group" aria-label="Compare to">
            Compare to
            {MODES.map((c) => (
              <button
                key={c.id}
                type="button"
                aria-pressed={compare === c.id}
                title={c.id !== "A" && !loaded?.plan ? `No default plan for ${year} yet (create one in Planning)` : c.hint}
                disabled={c.id !== "A" && !loaded?.plan}
                onClick={() => setCompare(c.id)}
                className={`h-8 w-8 rounded-lg border text-xs font-semibold ${compare === c.id ? "border-accent bg-accent text-black" : "border-border text-text-muted hover:text-text"} disabled:opacity-40`}
              >
                {c.id}
              </button>
            ))}
          </div>
          <div className="flex overflow-hidden rounded-lg border border-border text-xs" role="group" aria-label="Numbers as">
            {NUMBER_MODES.map((m) => (
              <button key={m.id} type="button" aria-pressed={mode === m.id} onClick={() => setMode(m.id)} className={`px-3 py-1.5 ${mode === m.id ? "bg-accent font-semibold text-black" : "text-text-muted hover:text-text"}`}>
                {m.label}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-sm text-text-muted">
            Revenue by
            <select aria-label="Revenue by" className={selectClass} value={revenueBy} onChange={(e) => setRevenueBy(e.target.value as RevenueBy)}>
              {(Object.keys(REVENUE_BY_LABELS) as RevenueBy[]).map((k) => (
                <option key={k} value={k}>
                  {REVENUE_BY_LABELS[k]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm text-text-muted">
            Year
            <select aria-label="Year" className={selectClass} value={year ?? ""} onChange={(e) => setYear(Number(e.target.value))}>
              {Array.from({ length: 6 }, (_, i) => thisYear + 1 - i).map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </label>
        </>
      }
    >
      {!view || !client ? (
        <Loading />
      ) : !view.any ? (
        <Empty>{compare === "A" ? `No data for ${year} (data runs through ${loaded?.lastData}).` : `The ${year} plan has no months with inputs yet.`}</Empty>
      ) : (
        <>
          <p className="text-xs text-text-muted">
            Operating revenue = gross sales − discounts + shipping − refunds (= net sales + shipping). Every Revenue by view ends at the same figure.
            {compare === "A" && " Fixed costs (SG&A) come from Store Settings."}
            {compare === "P" && ` Showing the plan "${loaded?.plan?.name}": every month from its inputs. SG&A comes from the plan.`}
            {compare === "F" && ` Forecast = actuals up to ${loaded?.lastData}, then the plan "${loaded?.plan?.name}" for the remaining days.`}
            {view.swapped && " Paid vs Organic is not planned, so New vs Returning is shown."}
          </p>
          <PnlTable title={`${year} Profit & Loss${compare === "P" ? " (Plan)" : compare === "F" ? " (Forecast)" : ""}`} sections={view.sections} opRev={view.opRev} status={view.status} mode={mode} currency={client.currency} />
        </>
      )}
    </ReportFrame>
  );
}
