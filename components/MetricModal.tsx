"use client";

import { useEffect, useMemo, useState } from "react";
import { DailyChart } from "./DailyChart";
import { theme } from "@/theme/theme";
import type { CompareModeName } from "@/lib/dates";
import { monthRows, type MonthRow } from "@/lib/monthly";
import { compareSource, tileNumbers, type DashData } from "@/lib/dashboard-data";
import { formatDiff, formatValue, type Format } from "@/lib/format";
import { cmParts, totalSpend, type MetricDef, type Totals } from "@/lib/metrics";
import { PLATFORMS, platformOf } from "@/lib/channels";
import { CHANNEL_KEYS, type ChannelKey } from "@/lib/types";

interface Props {
  def: MetricDef;
  title?: string;
  data: DashData;
  mode: CompareModeName;
  onClose: () => void;
}

interface Col {
  label: string;
  get: (r: MonthRow) => number | null;
  format: Format;
  bold?: boolean;
}

const TONE = { good: "text-good", bad: "text-bad", neutral: "text-text-muted" } as const;
const COMPARE_NAME: Record<CompareModeName, string> = { plan: "Target", yoy: "Last year", prev: "Previous", custom: "Comparison" };

const sumChannels = (t: Totals, keys: ChannelKey[]) => keys.reduce((s, k) => s + t.channels[k].spend, 0);

/** Columns of the monthly table, specific to the metric (like the reference tool's windows). */
function columnsFor(def: MetricDef, data: DashData, rows: MonthRow[], compareLabel: string): Col[] {
  const s = data.settings;
  const parts = (r: MonthRow) => cmParts(r.tot, s);
  const target: Col = { label: "Target", get: (r) => r.target, format: def.format };

  if (def.key === "cm") {
    return [
      { label: "Net Sales + Shipping", get: (r) => (r.hasActual ? r.tot.netSales + r.tot.shippingCollected : null), format: "currency0" },
      { label: "Refunds", get: (r) => (r.hasActual ? -r.tot.refunds : null), format: "currency0" },
      { label: "COGS", get: (r) => (r.hasActual ? parts(r).cogs : null), format: "currency0" },
      { label: "Spend", get: (r) => (r.hasActual ? parts(r).adSpend : null), format: "currency0" },
      { label: "Other", get: (r) => (r.hasActual ? parts(r).costOfDelivery : null), format: "currency0" },
      { label: "Contribution Margin", get: (r) => r.actual, format: "currency0", bold: true },
      target,
    ];
  }
  if (def.key === "orderRevenue") {
    return [
      { label: "New Revenue", get: (r) => (r.hasActual ? r.tot.newOrderRevenue : null), format: "currency0" },
      { label: "Returning Revenue", get: (r) => (r.hasActual ? r.tot.returningOrderRevenue : null), format: "currency0" },
      { label: "Revenue", get: (r) => r.actual, format: "currency0", bold: true },
      target,
    ];
  }
  if (def.key === "adSpend") {
    const used = PLATFORMS.filter((p) => rows.some((r) => sumChannels(r.tot, [p.acquisition, p.nonAcquisition]) > 0));
    const order = ["google", "meta", "pinterest"];
    used.sort((a, b) => (order.indexOf(a.id) + 1 || 99) - (order.indexOf(b.id) + 1 || 99));
    return [
      ...used.map((p) => ({ label: p.id === "meta" ? "Facebook" : p.label, get: (r: MonthRow) => (r.hasActual ? sumChannels(r.tot, [p.acquisition, p.nonAcquisition]) : null), format: "currency0" as Format })),
      { label: "Spend", get: (r) => (r.hasActual ? totalSpend(r.tot) : null), format: "currency0", bold: true },
      target,
    ];
  }
  if (def.key.endsWith(".spend")) {
    const id = def.key.slice(0, -".spend".length);
    const platform = CHANNEL_KEYS.includes(id as ChannelKey) ? platformOf(id as ChannelKey).platform : PLATFORMS.find((p) => p.id === id);
    if (platform) {
      return [
        { label: "Acquisition Spend", get: (r) => (r.hasActual ? sumChannels(r.tot, [platform.acquisition]) : null), format: "currency0" },
        { label: "Retention Spend", get: (r) => (r.hasActual ? sumChannels(r.tot, [platform.nonAcquisition]) : null), format: "currency0" },
        { label: "Total Spend", get: (r) => r.actual, format: "currency0", bold: true },
        target,
      ];
    }
  }
  return [
    { label: def.label, get: (r) => r.actual, format: def.format, bold: true },
    target,
    { label: compareLabel, get: (r) => r.compare, format: def.format },
  ];
}

export function MetricModal({ def, title, data, mode, onClose }: Props) {
  const [asc, setAsc] = useState(true);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const cur = data.client.currency;
  const nums = tileNumbers(def, data, mode);
  const cmp = compareSource(data, mode);
  const compareName = COMPARE_NAME[mode];

  // Grouped by month (YYYYMM), like the reference tool.
  const rows: MonthRow[] = useMemo(() => monthRows(def, data, cmp), [def, data, cmp]);

  const hasTarget = rows.some((r) => r.target !== null);
  const hasCompare = rows.some((r) => r.compare !== null);
  // With no plan, the "Target" column shows the comparison (last year / previous / custom period) instead.
  const cols = columnsFor(def, data, rows, compareName).map((c) => (c.label === "Target" && !hasTarget ? { ...c, label: compareName, get: (r: MonthRow) => r.compare } : c));

  const refValue = nums.ref;
  const refLabel = hasTarget && mode === "plan" ? "Target" : compareName;
  const f = (v: number | null, fmt: Format = def.format) => formatValue(v, fmt, cur);

  const series = [
    { id: "actual", label: title ?? def.label, kind: "line" as const, color: theme.colors.chartPrimary, values: rows.map((r) => r.actual) },
    ...(hasTarget ? [{ id: "target", label: "Target", kind: "line" as const, color: theme.colors.chartTarget, values: rows.map((r) => r.target) }] : []),
    ...(hasCompare && (mode !== "plan" || !hasTarget) ? [{ id: "cmp", label: compareName, kind: "line" as const, color: theme.colors.chartTarget, values: rows.map((r) => r.compare), dashed: !hasTarget ? false : true }] : []),
  ];

  const shown = asc ? rows : [...rows].reverse();

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 md:p-10" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={`${title ?? def.label} trend`} className="w-full max-w-4xl rounded-2xl border border-border bg-surface p-5 md:p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4">
          <h2 className="text-sm font-semibold" style={{ fontFamily: "var(--apex-font-heading)" }}>
            {title ?? def.label}
          </h2>
          <div className="flex items-start gap-4">
            <p className="max-w-md text-right text-xs text-text-muted">{def.formula}</p>
            <button onClick={onClose} className="rounded-lg border border-border px-3 py-1 text-sm text-text-muted hover:text-text" aria-label="Close">
              Close
            </button>
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-border bg-bg p-4">
          <div className="mx-auto w-fit space-y-0.5 text-lg font-bold" style={{ fontFamily: "var(--apex-font-heading)" }}>
            <Line label="Total :" value={f(nums.actual)} />
            <Line label={`${refLabel}:`} value={f(refValue)} />
            <Line label="Diff :" value={refValue !== null && nums.actual !== null ? f(nums.actual - refValue) : "–"} tone={nums.tone} />
            <Line label="Diff %:" value={formatDiff(nums.diff) || "–"} tone={nums.tone} />
          </div>

          <div className="mt-4 rounded-xl border border-border bg-surface p-3">
            <DailyChart
              dates={rows.map((r) => r.key)}
              labels={rows.map((r) => r.key)}
              series={series}
              height={280}
              smooth
              legendTop
              formatValue={(v) => f(v)}
              formatAxis={(v) => (def.format === "currency0" || def.format === "currency2" ? new Intl.NumberFormat("en-GB", { notation: "compact", maximumFractionDigits: 1 }).format(v) : f(v))}
            />
          </div>

          <div className="mt-5 overflow-auto">
            <table className="tabular w-full text-right text-xs">
              <thead className="text-text-muted">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">
                    <button type="button" onClick={() => setAsc(!asc)} className="border-b border-text-faint pb-1 hover:text-text" aria-label="Sort by date">
                      Date {asc ? "↑" : "↓"}
                    </button>
                  </th>
                  {cols.map((c) => (
                    <th key={c.label} className="px-3 py-2 font-medium">
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.key} className="border-t border-border">
                    <td className="px-3 py-3 text-left text-text-muted">{r.key}</td>
                    {cols.map((c) => {
                      const v = c.get(r);
                      return (
                        <td key={c.label} className={`px-3 py-3 ${c.bold ? "font-semibold text-text" : "text-text-muted"}`}>
                          {v === null ? "" : f(v, c.format)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <p className="mt-2 text-[11px] text-text-faint">Grouped by month ({data.range.from} → {data.range.to}); {cmp.label.toLowerCase()} compares like for like. {data.client.name}.</p>
      </div>
    </div>
  );
}

function Line({ label, value, tone }: { label: string; value: string; tone?: keyof typeof TONE }) {
  return (
    <div className="flex justify-between gap-8">
      <span className={tone ? TONE[tone] : "text-text"}>{label}</span>
      <span className={`tabular ${tone ? TONE[tone] : "text-text"}`}>{value}</span>
    </div>
  );
}
