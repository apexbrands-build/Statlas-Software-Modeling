"use client";

import { useState } from "react";
import type { Tone } from "@/lib/metrics";

export interface Cell {
  text: string;
  /** Colours the cell when the heat map is on. */
  tone?: Tone;
  /** Dim (projected / not actual). */
  faint?: boolean;
}
export interface Row {
  key: string;
  label: string;
  cells: Cell[];
}
export interface Column {
  label: string;
  /** Group heading shown above (consecutive columns with the same group are merged). */
  group?: string;
}

const HEAT: Record<Tone, string> = {
  good: "bg-good/20 text-good",
  bad: "bg-bad/20 text-bad",
  neutral: "",
};

export function toCsv(columns: Column[], rows: Row[], first: string): string {
  const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const head = [first, ...columns.map((c) => (c.group ? `${c.group} ${c.label}` : c.label))].map(esc).join(",");
  const body = rows.map((r) => [r.label, ...r.cells.map((c) => c.text)].map(esc).join(","));
  return [head, ...body].join("\n");
}

/** Wide, scrollable report table: sticky first column, optional heat map, CSV export. */
export function ReportTable({ columns, rows, total, firstLabel, filename }: { columns: Column[]; rows: Row[]; total?: Row; firstLabel: string; filename: string }) {
  const [heat, setHeat] = useState(true);
  const [copied, setCopied] = useState(false);
  const all = total ? [...rows, total] : rows;

  const download = () => {
    const url = URL.createObjectURL(new Blob([toCsv(columns, all, firstLabel)], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${filename}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(toCsv(columns, all, firstLabel).replace(/","/g, "\t").replace(/^"|"$/gm, ""));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  const btn = "rounded-lg border border-border px-3 py-1.5 text-xs text-text-muted hover:text-text";
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <button type="button" className={btn} onClick={() => setHeat((h) => !h)} aria-pressed={heat}>
          Heat map {heat ? "on" : "off"}
        </button>
        <button type="button" className={btn} onClick={copy}>
          {copied ? "Copied" : "Copy"}
        </button>
        <button type="button" className={btn} onClick={download}>
          Export CSV
        </button>
      </div>
      <div className="overflow-x-auto rounded-xl border border-border bg-surface">
        <table className="tabular w-full border-collapse text-right text-xs">
          <thead className="bg-surface-raised text-text-muted">
            {columns.some((c) => c.group) && (
              <tr>
                <th className="sticky left-0 z-10 bg-surface-raised" />
                {groupSpans(columns).map((g, i) => (
                  <th key={i} colSpan={g.span} className="border-l border-border px-2 py-1 text-center font-semibold text-text">
                    {g.name}
                  </th>
                ))}
              </tr>
            )}
            <tr>
              <th className="sticky left-0 z-10 bg-surface-raised px-3 py-2 text-left font-medium">{firstLabel}</th>
              {columns.map((c, i) => (
                <th key={i} className="whitespace-nowrap px-3 py-2 font-medium">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <TableRow key={r.key} row={r} heat={heat} />
            ))}
            {total && <TableRow row={total} heat={heat} bold />}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function groupSpans(columns: Column[]) {
  const out: { name: string; span: number }[] = [];
  for (const c of columns) {
    const last = out[out.length - 1];
    if (last && last.name === (c.group ?? "")) last.span += 1;
    else out.push({ name: c.group ?? "", span: 1 });
  }
  return out;
}

function TableRow({ row, heat, bold }: { row: Row; heat: boolean; bold?: boolean }) {
  return (
    <tr className={`border-t border-border ${bold ? "bg-surface-raised font-semibold" : ""}`}>
      <th className={`sticky left-0 z-10 whitespace-nowrap px-3 py-1.5 text-left font-medium ${bold ? "bg-surface-raised" : "bg-surface"}`}>{row.label}</th>
      {row.cells.map((c, i) => (
        <td key={i} className={`whitespace-nowrap px-3 py-1.5 ${c.faint ? "text-text-faint" : ""} ${heat && c.tone ? HEAT[c.tone] : ""}`}>
          {c.text}
        </td>
      ))}
    </tr>
  );
}
