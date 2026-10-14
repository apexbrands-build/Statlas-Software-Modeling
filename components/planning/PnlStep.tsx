"use client";

import { useMemo, useState } from "react";
import { NUMBER_MODES, PnlTable, type NumberMode } from "@/components/reports/PnlTable";
import { mixOf, planMixShares } from "@/lib/planning/mix";
import { planRoasTargets, roasOf } from "@/lib/planning/roas";
import { pnlColumns } from "@/lib/reports/plan-pnl";
import { buildPnl, REVENUE_BY_LABELS, type RevenueBy } from "@/lib/reports/pnl";
import type { PlanCtx } from "./ctx";
import { inputClass } from "./ui";

/** The plan as a P&L (from the draft, before saving). Fixed costs only show up here, below CM. */
export function PnlStep({ ctx }: { ctx: PlanCtx }) {
  const { months, rows, settings, client, plan } = ctx;
  const [mode, setMode] = useState<NumberMode>("whole");
  const [by, setBy] = useState<RevenueBy>("simplified");

  const view = useMemo(() => {
    const planFixed = months.map((m) => (m.inputs ? (m.inputs.fixedCosts ?? settings.monthlyFixedCosts) : null));
    const src = { roasOf: roasOf(planRoasTargets(months, settings)), mixOf: mixOf(planMixShares(months)) };
    const cols = pnlColumns("P", plan.year, [], Object.values(rows).flat(), "", settings, planFixed, src);
    const sections = buildPnl(cols.columns, settings, by, cols.fixed);
    const opRev = sections.flatMap((s) => s.rows).find((r) => r.key === "opRev")!.values;
    return { sections, opRev, status: cols.status, any: cols.columns[12] !== null };
  }, [months, rows, settings, plan.year, by]);

  if (!view.any) return <div className="rounded-xl border border-border bg-surface p-6 text-sm text-text-muted">Start at least one month in the Overview tab (or with Create forecast in the Models) to see the plan P&amp;L.</div>;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <div className="flex overflow-hidden rounded-lg border border-border text-xs" role="group" aria-label="Numbers as">
          {NUMBER_MODES.map((m) => (
            <button key={m.id} type="button" aria-pressed={mode === m.id} onClick={() => setMode(m.id)} className={`px-3 py-1.5 ${mode === m.id ? "bg-accent font-semibold text-black" : "text-text-muted hover:text-text"}`}>
              {m.label}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-text-muted">
          Revenue by
          <select aria-label="Revenue by" className={inputClass} value={by} onChange={(e) => setBy(e.target.value as RevenueBy)}>
            {(["simplified", "newReturning"] as RevenueBy[]).map((k) => (
              <option key={k} value={k}>
                {REVENUE_BY_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
        <span className="text-xs text-text-faint">Shows your current draft, saved or not. The same table appears in Reporting → P&amp;L with Compare to “P” once saved. Platform revenue is the planned spend times the ROAS targets of the Details tab.</span>
      </div>
      <PnlTable title={`${plan.year} Plan P&L`} sections={view.sections} opRev={view.opRev} status={view.status} mode={mode} currency={client.currency} />
    </div>
  );
}
