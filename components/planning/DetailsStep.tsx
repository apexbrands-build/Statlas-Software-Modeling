"use client";

import { formatValue } from "@/lib/format";
import { aggregate } from "@/lib/metrics";
import { addYears, endOfMonth } from "@/lib/dates";
import type { PlanCtx } from "./ctx";
import { MONTHS, NumField } from "./ui";

/** Step 3: returning revenue per month, next to last year, so it can be overridden with one number. */
export function DetailsStep({ ctx }: { ctx: PlanCtx }) {
  const { months, rows, client, history, editInputs } = ctx;
  const money = (v: number | null) => formatValue(v, "currency0", client.currency);
  const pct = (v: number | null) => formatValue(v, "percent1", client.currency);

  const data = months.map((m) => {
    const ly = aggregate(history.facts.filter((f) => f.date >= addYears(m.month, -1) && f.date <= addYears(endOfMonth(m.month), -1)));
    const lyOrder = ly.newOrderRevenue + ly.returningOrderRevenue;
    const day = rows[m.month] ?? [];
    const order = day.reduce((a, r) => a + r.orderRevenue, 0);
    return { m, lyHas: ly.days > 0, lyRet: ly.returningOrderRevenue, lyOrder, order, ret: m.inputs?.returningRevenue ?? null };
  });
  const sum = (f: (d: (typeof data)[number]) => number) => data.reduce((a, d) => a + f(d), 0);
  const totOrder = sum((d) => d.order);
  const totRet = sum((d) => d.ret ?? 0);
  const totLyRet = sum((d) => d.lyRet);
  const totLyOrder = sum((d) => d.lyOrder);

  return (
    <div className="space-y-3">
      <p className="max-w-3xl text-sm text-text-muted">
        Returning order revenue per month. Type a number to set it. The cohort model that suggests it automatically comes later; until then this column is the one you control (like Statlas&apos;s Override). Last year is shown for reference.
      </p>
      <div className="overflow-x-auto rounded-xl border border-border bg-surface">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-xs text-text-muted">
              <th className="px-3 py-2 text-left">Month</th>
              <th className="px-2 py-2 text-right">Order revenue (plan)</th>
              <th className="px-2 py-2 text-right">Returning revenue (plan)</th>
              <th className="px-2 py-2 text-right">% of order revenue</th>
              <th className="px-2 py-2 text-right">Last year returning</th>
              <th className="px-2 py-2 text-right">Last year %</th>
              <th className="px-2 py-2 text-right">vs last year</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d, i) => (
              <tr key={d.m.month} className="border-b border-border/40">
                <td className="px-3 py-1">
                  {MONTHS[i]} {d.m.locked && "🔒"}
                </td>
                <td className="px-2 py-1 text-right tabular">{d.m.inputs ? money(d.order) : "–"}</td>
                <td className="px-2 py-1 text-right">
                  {d.m.inputs ? (
                    <NumField value={d.ret ?? 0} disabled={d.m.locked} className="w-28" onCommit={(v) => editInputs(d.m.month, (x) => ({ ...x, returningRevenue: Math.max(0, v) }))} />
                  ) : (
                    <span className="text-text-faint" title="Start this month in the Monthly plan first">
                      –
                    </span>
                  )}
                </td>
                <td className="px-2 py-1 text-right tabular">{d.m.inputs && d.order ? pct((d.ret ?? 0) / d.order) : "–"}</td>
                <td className="px-2 py-1 text-right tabular text-text-muted">{d.lyHas ? money(d.lyRet) : "–"}</td>
                <td className="px-2 py-1 text-right tabular text-text-muted">{d.lyHas && d.lyOrder ? pct(d.lyRet / d.lyOrder) : "–"}</td>
                <td className="px-2 py-1 text-right tabular text-text-muted">{d.lyHas && d.lyRet && d.ret !== null ? pct(d.ret / d.lyRet - 1) : "–"}</td>
              </tr>
            ))}
            <tr className="bg-surface-raised font-semibold">
              <td className="px-3 py-2">{ctx.plan.year}</td>
              <td className="px-2 py-2 text-right tabular">{money(totOrder)}</td>
              <td className="px-2 py-2 text-right tabular">{money(totRet)}</td>
              <td className="px-2 py-2 text-right tabular">{totOrder ? pct(totRet / totOrder) : "–"}</td>
              <td className="px-2 py-2 text-right tabular">{money(totLyRet)}</td>
              <td className="px-2 py-2 text-right tabular">{totLyOrder ? pct(totLyRet / totLyOrder) : "–"}</td>
              <td className="px-2 py-2 text-right tabular">{totLyRet && totRet ? pct(totRet / totLyRet - 1) : "–"}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
