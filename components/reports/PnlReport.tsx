"use client";

import { useEffect, useMemo, useState } from "react";
import { Empty, Loading, ReportFrame, selectClass } from "./ReportFrame";
import { useApp } from "@/lib/app-context";
import { endOfMonth, min, todayLocal } from "@/lib/dates";
import { formatValue, type Format } from "@/lib/format";
import { div } from "@/lib/metrics";
import { buildPnl, pnlTotals, REVENUE_BY_LABELS, type RevenueBy } from "@/lib/reports/pnl";
import { getRepository } from "@/lib/repository";
import type { DailyFact } from "@/lib/types";

type NumberMode = "whole" | "thousands" | "pct";
const NUMBER_MODES: { id: NumberMode; label: string }[] = [
  { id: "whole", label: "Whole" },
  { id: "thousands", label: "Thousands" },
  { id: "pct", label: "% of revenue" },
];

/** Money amounts follow the "#s As" choice; counts, ratios, per-order values and percentages never change. */
function show(v: number | null, format: Format, mode: NumberMode, opRev: number | null, currency: Parameters<typeof formatValue>[2]): string {
  if (v === null || format !== "currency0" || mode === "whole") return formatValue(v, format, currency);
  if (mode === "thousands") return `${new Intl.NumberFormat("en-GB", { style: "currency", currency, minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(v / 1000)}K`;
  return formatValue(div(v, opRev ?? 0), "percent1", currency);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function PnlReport() {
  const { client, settings } = useApp();
  const [year, setYear] = useState<number | null>(null);
  const [mode, setMode] = useState<NumberMode>("whole");
  const [revenueBy, setRevenueBy] = useState<RevenueBy>("simplified");
  const [loaded, setLoaded] = useState<{ key: string; facts: DailyFact[]; lastData: string } | null>(null);

  useEffect(() => {
    setYear((y) => y ?? Number(todayLocal().slice(0, 4)));
  }, []);

  useEffect(() => {
    if (!client || year === null) return;
    let cancel = false;
    (async () => {
      const repo = getRepository();
      const lastData = await repo.getLastDataDate(client.id);
      const facts = await repo.getFacts(client.id, `${year}-01-01`, min(`${year}-12-31`, lastData));
      if (!cancel) setLoaded({ key: `${client.id}|${year}`, facts, lastData });
    })();
    return () => {
      cancel = true;
    };
  }, [client, year]);

  const view = useMemo(() => {
    if (!client || !settings || year === null || !loaded || loaded.key !== `${client.id}|${year}`) return null;
    const totals = pnlTotals(loaded.facts, year);
    const sections = buildPnl(totals, settings, revenueBy);
    // Revenue base for the "% of operating revenue" line under CM and Profit.
    const opRev = sections.flatMap((s) => s.rows).find((r) => r.key === "opRev")!.values;
    const status = totals.slice(0, 12).map((t, i) => {
      if (!t || t.days === 0) return "";
      return loaded.lastData < endOfMonth(`${year}-${String(i + 1).padStart(2, "0")}-01`) ? "Partial" : "Actual";
    });
    return { sections, opRev, status, any: totals[12]!.days > 0 };
  }, [client, settings, year, loaded, revenueBy]);

  const thisYear = Number(todayLocal().slice(0, 4));
  return (
    <ReportFrame
      slug="pnl"
      range={null}
      controls={
        <>
        <div className="flex items-center gap-1 text-sm text-text-muted" role="group" aria-label="Compare to">
          Compare to
          {[
            { id: "A", label: "Actual", on: true },
            { id: "P", label: "Plan", on: false },
            { id: "F", label: "Forecast", on: false },
          ].map((c) => (
            <button key={c.id} type="button" disabled={!c.on} title={c.on ? c.label : `${c.label} columns arrive with the plan and forecast layer`} className={`h-8 w-8 rounded-lg border text-xs font-semibold ${c.on ? "border-accent text-accent" : "border-border text-text-faint opacity-50"}`}>
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
            {Array.from({ length: 6 }, (_, i) => thisYear - i).map((y) => (
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
        <Empty>No data for {year} (data runs through {loaded?.lastData}).</Empty>
      ) : (
        <>
          <p className="text-xs text-text-muted">
            Operating revenue = gross sales − discounts + shipping − refunds (= net sales + shipping). Every Revenue by view ends at the same figure. Fixed costs (SG&A) come from Store Settings. Plan and Forecast columns arrive with the planning layer.
          </p>
          <div className="overflow-x-auto rounded-xl border border-border bg-surface">
            <table className="tabular w-full border-collapse text-right text-xs">
              <thead className="bg-surface-raised text-text-muted">
                <tr>
                  <th className="sticky left-0 z-10 bg-surface-raised px-3 py-2 text-left font-medium">{year} Profit &amp; Loss</th>
                  {MONTHS.map((m, i) => (
                    <th key={m} className="px-3 py-2 font-medium">
                      {m}
                      <div className="text-[10px] font-normal text-text-faint">{view.status[i] || " "}</div>
                    </th>
                  ))}
                  <th className="px-3 py-2 font-semibold text-text">{year} Total</th>
                </tr>
              </thead>
              <tbody>
                {view.sections.map((sec) => (
                  <Section key={sec.title} title={sec.title}>
                    {sec.rows.map((r) => (
                      <tr key={r.key} className={`border-t border-border ${r.bold ? "bg-surface-raised font-semibold" : ""}`}>
                        <th className={`sticky left-0 z-10 whitespace-nowrap px-3 py-1.5 text-left font-medium ${r.bold ? "bg-surface-raised" : "bg-surface"}`}>{r.label}</th>
                        {r.values.map((v, i) => (
                          <td key={i} className={`whitespace-nowrap px-3 py-1.5 ${i === 12 ? "font-semibold" : ""} ${v !== null && v < 0 && r.format !== "percent1" ? "text-text-muted" : ""}`}>
                            {show(v, r.format, mode, view.opRev[i], client.currency)}
                            {r.pctOfRevenue && mode === "whole" && v !== null && (
                              <div className={`text-[10px] font-normal ${v < 0 ? "text-bad" : "text-text-faint"}`}>{formatValue(div(v, view.opRev[i] ?? 0), "percent1", client.currency)}</div>
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </Section>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </ReportFrame>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <>
      <tr className="border-t border-border bg-bg">
        <th colSpan={14} className="sticky left-0 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-accent">
          {title}
        </th>
      </tr>
      {children}
    </>
  );
}
