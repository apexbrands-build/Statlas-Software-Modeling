"use client";

import { formatValue } from "@/lib/format";
import type { YearRow } from "@/lib/creative/plan";
import type { Currency } from "@/lib/types";
import { MONTHS } from "../ui";

/** The year at a glance: the ads each month needs next to last year's launches, Meta spend, aMER and ROAS, and this year's spend and aMER. Click a row to open its month. */
export function CreativeYearTable({ rows, total, selected, onSelect, currency }: { rows: YearRow[]; total: YearRow; selected: string; onSelect: (month: string) => void; currency: Currency }) {
  const money = (v: number | null) => (v === null ? "–" : formatValue(v, "currency0", currency));
  const ratio = (v: number | null) => (v === null ? "–" : formatValue(v, "ratio2", currency));
  const count = (v: number | null) => (v === null ? "–" : String(v));
  const th = "px-2 py-2 text-right font-medium";
  const cells = (r: YearRow, bold = false) => (
    <>
      <td className={`px-2 py-1 text-right tabular ${bold ? "font-semibold" : "font-medium"}`}>{count(r.target)}</td>
      <td className="px-2 py-1 text-right tabular">{r.launchedThisYear}</td>
      <td className="px-2 py-1 text-right tabular text-text-muted">{r.launchedLastYear}</td>
      <td className="px-2 py-1 text-right tabular text-text-muted">{money(r.metaSpendLastYear || null)}</td>
      <td className="px-2 py-1 text-right tabular text-text-muted">{ratio(r.amerLastYear)}</td>
      <td className="px-2 py-1 text-right tabular text-text-muted">{ratio(r.roasLastYear)}</td>
      <td className="px-2 py-1 text-right tabular" title={r.spendIsActual ? "What Meta spent" : "The plan's Meta spend"}>
        {money(r.spendThisYear || null)} {!bold && r.spendThisYear > 0 && <span className="text-[10px] text-text-faint">{r.spendIsActual ? "actual" : "plan"}</span>}
      </td>
      <td className="px-2 py-1 text-right tabular">{ratio(r.amerThisYear)}</td>
    </>
  );
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-surface">
      <table className="w-full min-w-[860px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-border text-xs text-text-muted">
            <th className="px-3 py-2 text-left">Month</th>
            <th className={th}>New ads needed</th>
            <th className={th}>Launched this year</th>
            <th className={th}>Launched last year</th>
            <th className={th}>Meta spend last year</th>
            <th className={th}>aMER last year</th>
            <th className={th}>Meta ROAS last year</th>
            <th className={th}>Meta spend this year</th>
            <th className={th}>aMER this year</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.month} onClick={() => onSelect(r.month)} className={`cursor-pointer border-b border-border/40 hover:bg-bg ${r.month === selected ? "bg-accent/10" : ""}`} aria-selected={r.month === selected}>
              <td className="px-3 py-1">
                <button className="text-left" onClick={() => onSelect(r.month)}>
                  {MONTHS[i]}
                </button>
              </td>
              {cells(r)}
            </tr>
          ))}
          <tr className="bg-surface-raised font-semibold">
            <td className="px-3 py-2">{total.month}</td>
            {cells(total, true)}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
