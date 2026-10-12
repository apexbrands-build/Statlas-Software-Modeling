"use client";

import { ReportTable, type Column, type Row } from "./ReportTable";
import { formatValue } from "@/lib/format";
import { columnTones, type NumTable } from "@/lib/reports/table-model";
import type { Currency } from "@/lib/types";

/** Formats a numeric report table (lib/reports builders) and colours each column against its own average. */
export function MetricsTable({ table, currency, firstLabel, filename }: { table: NumTable; currency: Currency; firstLabel: string; filename: string }) {
  const columns: Column[] = table.columns.map((c) => ({ label: c.label, group: c.group }));
  const tones = table.columns.map((c) =>
    columnTones(
      table.rows.map((r) => r.v[c.key] ?? null),
      c.direction,
    ),
  );
  const rows: Row[] = table.rows.map((r, i) => ({
    key: r.key,
    label: r.label,
    cells: table.columns.map((c, j) => ({ text: formatValue(r.v[c.key], c.format, currency), tone: tones[j][i] })),
  }));
  const total: Row = {
    key: table.total.key,
    label: table.total.label,
    cells: table.columns.map((c) => ({ text: formatValue(table.total.v[c.key], c.format, currency) })),
  };
  return <ReportTable columns={columns} rows={rows} total={total} firstLabel={firstLabel} filename={filename} />;
}
