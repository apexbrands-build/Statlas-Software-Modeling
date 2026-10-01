"use client";

import { formatValue, type Format } from "@/lib/format";
import { div } from "@/lib/metrics";
import type { PnlSection } from "@/lib/reports/pnl";
import type { Currency } from "@/lib/types";

export type NumberMode = "whole" | "thousands" | "pct";
export const NUMBER_MODES: { id: NumberMode; label: string }[] = [
  { id: "whole", label: "Whole" },
  { id: "thousands", label: "Thousands" },
  { id: "pct", label: "% of revenue" },
];

export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Money amounts follow the "#s As" choice; counts, ratios, per-order values and percentages never change. */
function show(v: number | null, format: Format, mode: NumberMode, opRev: number | null, currency: Currency): string {
  if (v === null || format !== "currency0" || mode === "whole") return formatValue(v, format, currency);
  if (mode === "thousands") return `${new Intl.NumberFormat("en-GB", { style: "currency", currency, minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(v / 1000)}K`;
  return formatValue(div(v, opRev ?? 0), "percent1", currency);
}



/** The P&L grid (months + year total). Used by the P&L report and the plan editor. */
export function PnlTable({ title, sections, opRev, status, mode, currency }: { title: string; sections: PnlSection[]; opRev: (number | null)[]; status: string[]; mode: NumberMode; currency: Currency }) {
  return (
          <div className="overflow-x-auto rounded-xl border border-border bg-surface">
            <table className="tabular w-full border-collapse text-right text-xs">
              <thead className="bg-surface-raised text-text-muted">
                <tr>
                  <th className="sticky left-0 z-10 bg-surface-raised px-3 py-2 text-left font-medium">{title}</th>
                  {MONTHS.map((m, i) => (
                    <th key={m} className="px-3 py-2 font-medium">
                      {m}
                      <div className="text-[10px] font-normal text-text-faint">{status[i] || " "}</div>
                    </th>
                  ))}
                  <th className="px-3 py-2 font-semibold text-text">Total</th>
                </tr>
              </thead>
              <tbody>
                {sections.map((sec) => (
                  <Section key={sec.title} title={sec.title}>
                    {sec.rows.map((r) => (
                      <tr key={r.key} className={`border-t border-border ${r.bold ? "bg-surface-raised font-semibold" : ""}`}>
                        <th className={`sticky left-0 z-10 whitespace-nowrap px-3 py-1.5 text-left font-medium ${r.bold ? "bg-surface-raised" : "bg-surface"}`}>{r.label}</th>
                        {r.values.map((v, i) => (
                          <td key={i} className={`whitespace-nowrap px-3 py-1.5 ${i === 12 ? "font-semibold" : ""} ${v !== null && v < 0 && r.format !== "percent1" ? "text-text-muted" : ""}`}>
                            {show(v, r.format, mode, opRev[i], currency)}
                            {r.pctOfRevenue && mode === "whole" && v !== null && (
                              <div className={`text-[10px] font-normal ${v < 0 ? "text-bad" : "text-text-faint"}`}>{formatValue(div(v, opRev[i] ?? 0), "percent1", currency)}</div>
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
