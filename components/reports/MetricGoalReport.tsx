"use client";

import { useMemo, useState } from "react";
import { Empty, Loading, ReportFrame, selectClass, useReportRange } from "./ReportFrame";
import { ReportTable, type Cell, type Column, type Row } from "./ReportTable";
import { useApp } from "@/lib/app-context";
import { useDashboardData } from "@/lib/dashboard-data";
import { formatDiff, formatValue } from "@/lib/format";
import { aggregate, aggregatePlan, compare } from "@/lib/metrics";
import type { MetricSpec } from "@/lib/reports/metric-spec";
import { GROUP_LABELS, groupDates, type GroupBy } from "@/lib/reports/grouping";

const GROUPS = Object.keys(GROUP_LABELS) as GroupBy[];

/**
 * Period rows x metrics, each with Actual / Goal / Goal % columns, heat-coloured against the plan.
 * Goals cover only the elapsed days that have data (same rule as the dashboard).
 */
export function MetricGoalReport({ slug, specs, defaultGroup = "daily" }: { slug: string; specs: MetricSpec[]; defaultGroup?: GroupBy }) {
  const { client, settings } = useApp();
  const { range, setRange } = useReportRange();
  const [by, setBy] = useState<GroupBy>(defaultGroup);
  const [hidden, setHidden] = useState<string[]>([]);
  const data = useDashboardData(client, settings, range, null);

  const visible = specs.filter((s) => !hidden.includes(s.key));
  const showGoals = Boolean(data?.hasPlan);

  const built = useMemo(() => {
    if (!data || !client) return null;
    const cur = client.currency;
    const dates = data.dates.filter((d) => d <= data.effTo && data.facts.has(d));
    const columns: Column[] = visible.flatMap((s) => (showGoals && s.goal ? [{ group: s.label, label: "Actual" }, { group: s.label, label: "Goal" }, { group: s.label, label: "Goal %" }] : [{ group: s.label, label: "Actual" }]));

    const makeRow = (key: string, label: string, ds: string[]): Row => {
      const tot = aggregate(ds.map((d) => data.facts.get(d)!).filter(Boolean));
      const plan = aggregatePlan(ds.map((d) => data.plan.get(d)).filter((p): p is NonNullable<typeof p> => Boolean(p)));
      const cells: Cell[] = visible.flatMap((s) => {
        const actual = s.value(tot, data.settings);
        if (!(showGoals && s.goal)) return [{ text: formatValue(actual, s.format, cur) }];
        const goal = plan.days > 0 ? s.goal(plan, data.settings) : null;
        const c = compare(actual, goal, s.direction);
        return [
          { text: formatValue(actual, s.format, cur), tone: c.tone },
          { text: formatValue(goal, s.format, cur), faint: true },
          { text: c.diff === null ? "–" : formatDiff(c.diff), tone: c.tone },
        ];
      });
      return { key, label, cells };
    };

    const rows = groupDates(dates, by).map((b) => makeRow(b.key, b.label, b.dates));
    return { columns, rows, total: makeRow("total", "TOTAL", dates), count: dates.length };
  }, [data, client, visible, showGoals, by]);

  return (
    <ReportFrame
      slug={slug}
      range={range}
      setRange={setRange}
      controls={
        <>
          <label className="flex items-center gap-2 text-sm text-text-muted">
            Group by
            <select aria-label="Group by" className={selectClass} value={by} onChange={(e) => setBy(e.target.value as GroupBy)}>
              {GROUPS.map((g) => (
                <option key={g} value={g}>
                  {GROUP_LABELS[g]}
                </option>
              ))}
            </select>
          </label>
          <details className="relative">
            <summary className={`${selectClass} cursor-pointer list-none`}>Columns: {hidden.length ? `${visible.length}/${specs.length}` : "All"}</summary>
            <div className="absolute right-0 z-20 mt-1 max-h-72 w-64 overflow-auto rounded-lg border border-border bg-surface-raised p-2 text-sm">
              {specs.map((s) => (
                <label key={s.key} className="flex items-center gap-2 px-2 py-1">
                  <input type="checkbox" checked={!hidden.includes(s.key)} onChange={() => setHidden((h) => (h.includes(s.key) ? h.filter((k) => k !== s.key) : [...h, s.key]))} />
                  {s.label}
                </label>
              ))}
            </div>
          </details>
        </>
      }
    >
      {!built ? (
        <Loading />
      ) : built.count === 0 ? (
        <Empty>No actual data in this range{data ? ` (data runs through ${data.lastData})` : ""}. Pick an earlier period.</Empty>
      ) : (
        <>
          <p className="text-xs text-text-muted">
            {showGoals ? `Goals from plan “${data?.planName}”, counted for the days with data only.` : "No plan for this client: showing actuals only."}
          </p>
          <ReportTable columns={built.columns} rows={built.rows} total={built.total} firstLabel={GROUP_LABELS[by]} filename={`${slug}-${range?.from}-${range?.to}`} />
        </>
      )}
    </ReportFrame>
  );
}
