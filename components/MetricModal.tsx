"use client";

import { useEffect } from "react";
import { DailyChart } from "./DailyChart";
import { theme } from "@/theme/theme";
import { addYears, type CompareModeName } from "@/lib/dates";
import { COMPARE_LABEL, tileNumbers, type DashData } from "@/lib/dashboard-data";
import { formatDiff, formatValue } from "@/lib/format";
import { aggregate, cmParts, type MetricDef } from "@/lib/metrics";
import { metricSeries } from "@/lib/series";

interface Props {
  def: MetricDef;
  title?: string;
  data: DashData;
  mode: CompareModeName;
  onClose: () => void;
}

const TONE = { good: "text-good", bad: "text-bad", neutral: "text-text-muted" } as const;

export function MetricModal({ def, title, data, mode, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const cur = data.client.currency;
  const f = (v: number | null, fmt = def.format) => formatValue(v, fmt, cur);
  const nums = tileNumbers(def, data, mode);

  const allFacts = new Map(data.lyFacts);
  data.facts.forEach((v, k) => allFacts.set(k, v));
  const s = metricSeries(def, { dates: data.dates, facts: data.facts, allFacts, plan: data.plan, settings: data.settings });

  const hasTarget = s.target.some((v) => v !== null);
  const hasLy = s.lastYear.some((v) => v !== null);
  const series = [
    { id: "actual", label: title ?? def.label, kind: "line" as const, color: theme.colors.chartPrimary, values: s.actual },
    ...(hasTarget ? [{ id: "target", label: "Plan target", kind: "line" as const, color: theme.colors.chartTarget, values: s.target }] : []),
    ...(hasLy ? [{ id: "ly", label: "Last year", kind: "line" as const, color: theme.colors.chartCompare, values: s.lastYear, dashed: true }] : []),
  ];

  const isCm = def.key === "cm";
  const dates = data.dates;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 md:p-10" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${title ?? def.label} trend`}
        className="w-full max-w-4xl rounded-2xl border border-border bg-surface p-5 md:p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold" style={{ fontFamily: "var(--apex-font-heading)" }}>
              {title ?? def.label}
            </h2>
            <p className="mt-1 text-xs text-text-muted">{def.formula}</p>
            <span className="mt-2 inline-block rounded-full border border-border px-2 py-0.5 text-[11px] text-text-muted">
              Source: {def.source}
            </span>
          </div>
          <button onClick={onClose} className="rounded-lg border border-border px-3 py-1 text-sm text-text-muted hover:text-text" aria-label="Close">
            Close
          </button>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Total" value={f(nums.actual)} />
          <Stat label={`${COMPARE_LABEL[mode].replace("vs ", "")}`} value={f(nums.ref)} />
          <Stat label="Diff" value={nums.ref !== null && nums.actual !== null ? f(nums.actual - nums.ref) : "–"} tone={nums.tone} />
          <Stat label="Diff %" value={formatDiff(nums.diff) || "–"} tone={nums.tone} />
        </div>

        <div className="mt-5">
          <DailyChart
            dates={dates}
            series={series}
            height={280}
            formatValue={(v) => f(v)}
            formatAxis={(v) => (def.format === "currency0" || def.format === "currency2" ? formatValue(v, "currency0", cur) : f(v))}
          />
        </div>

        <div className="mt-5 max-h-80 overflow-auto rounded-lg border border-border">
          <table className="tabular w-full text-right text-xs">
            <thead className="sticky top-0 bg-surface-raised text-text-muted">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Date</th>
                {isCm ? (
                  ["Net Sales", "Refunds", "Shipping", "COGS", "Other", "Ad Spend", "CM", "Target"].map((h) => (
                    <th key={h} className="px-3 py-2 font-medium">
                      {h}
                    </th>
                  ))
                ) : (
                  <>
                    <th className="px-3 py-2 font-medium">Actual</th>
                    <th className="px-3 py-2 font-medium">Plan target</th>
                    <th className="px-3 py-2 font-medium">Last year</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {dates.map((d, i) => {
                const fact = data.facts.get(d);
                const c = fact ? cmParts(aggregate([fact]), data.settings) : null;
                const c0 = (v: number | null | undefined) => (v === null || v === undefined ? "" : formatValue(v, "currency0", cur));
                return (
                  <tr key={d} className="border-t border-border">
                    <td className="px-3 py-1.5 text-left text-text-muted">{d}</td>
                    {isCm ? (
                      <>
                        <td className="px-3 py-1.5">{c0(c?.netSales)}</td>
                        <td className="px-3 py-1.5">{c ? `-${c0(c.refunds)}` : ""}</td>
                        <td className="px-3 py-1.5">{c ? `-${c0(c.shippingCost)}` : ""}</td>
                        <td className="px-3 py-1.5">{c ? `-${c0(c.cogs)}` : ""}</td>
                        <td className="px-3 py-1.5">{c ? `-${c0(c.otherVariable)}` : ""}</td>
                        <td className="px-3 py-1.5">{c ? `-${c0(c.adSpend)}` : ""}</td>
                        <td className={`px-3 py-1.5 font-medium ${c ? (c.cm >= (s.target[i] ?? -Infinity) ? "text-good" : "text-bad") : ""}`}>{c0(c?.cm)}</td>
                        <td className="px-3 py-1.5 text-text-muted">{c0(s.target[i])}</td>
                      </>
                    ) : (
                      <>
                        <td className="px-3 py-1.5">{s.actual[i] === null ? "" : f(s.actual[i])}</td>
                        <td className="px-3 py-1.5 text-text-muted">{s.target[i] === null ? "" : f(s.target[i])}</td>
                        <td className="px-3 py-1.5 text-text-muted">{s.lastYear[i] === null ? "" : f(s.lastYear[i])}</td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11px] text-text-faint">
          Last year compares against {addYears(dates[0], -1)} → {addYears(dates[dates.length - 1], -1)}. Seed data only.
        </p>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: keyof typeof TONE }) {
  return (
    <div className="rounded-lg border border-border bg-surface-raised p-3">
      <div className="text-[11px] uppercase tracking-wide text-text-muted">{label}</div>
      <div className={`tabular mt-1 text-lg font-semibold ${tone ? TONE[tone] : "text-text"}`}>{value}</div>
    </div>
  );
}
