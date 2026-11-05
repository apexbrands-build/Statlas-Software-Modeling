"use client";

import { useState } from "react";
import { formatValue } from "@/lib/format";
import type { CalendarRow } from "@/lib/reports/calendar";
import { groupByType } from "@/lib/reports/calendar-actions";
import type { CalendarViewState } from "@/lib/reports/calendar-view";
import type { MetricSpec } from "@/lib/reports/metric-spec";
import type { Currency } from "@/lib/types";
import { ACTION_META, ActionIcon } from "./calendar-icons";

/** Green or pink shading that grows with the gap to goal; nothing inside the neutral band. */
function heatStyle(tone: "good" | "bad" | "neutral", diff: number | null): React.CSSProperties | undefined {
  if (tone === "neutral" || diff === null) return undefined;
  const alpha = 0.12 + Math.min(1, (Math.abs(diff) - 0.1) / 0.5) * 0.5;
  return { backgroundColor: tone === "good" ? `rgba(52,211,153,${alpha.toFixed(2)})` : `rgba(248,113,113,${alpha.toFixed(2)})` };
}

interface Hover {
  x: number;
  y: number;
  title: string;
  names: string[];
}

/** Day-by-day table: sticky Daily and Marketing Actions columns, Actual and Goal per metric, heat shading, deltas, grey projected days, TOTAL row. */
export function CalendarTable({ rows, total, specs, state, currency }: { rows: CalendarRow[]; total: CalendarRow; specs: MetricSpec[]; state: CalendarViewState; currency: Currency }) {
  const [hover, setHover] = useState<Hover | null>(null);
  const showActual = state.goals !== "only";
  const showGoal = state.goals !== "hide";
  const fmt = (spec: MetricSpec, v: number | null) => (v === null ? "–" : formatValue(v, spec.format, currency));
  const sticky = "sticky z-10 bg-surface";

  const show = (el: HTMLElement, row: CalendarRow, g: { type: keyof typeof ACTION_META; names: string[] }) => {
    const b = el.getBoundingClientRect();
    setHover({ x: b.right + 8, y: b.top, title: `${ACTION_META[g.type].label}${g.names.length > 1 ? "s" : ""} · ${row.label}`, names: g.names });
  };

  const actionsCell = (row: CalendarRow) => (
    <div className="flex items-center gap-2">
      {groupByType(row.actions).map((g) => (
        <button
          type="button"
          key={g.type}
          aria-label={`${ACTION_META[g.type].label}${g.names.length > 1 ? "s" : ""}, ${row.label}: ${g.names.join("; ")}`}
          className="inline-flex cursor-default flex-col items-center rounded leading-none outline-none focus-visible:ring-2 focus-visible:ring-accent"
          onMouseEnter={(e) => show(e.currentTarget, row, g)}
          onFocus={(e) => show(e.currentTarget, row, g)}
          onMouseLeave={() => setHover(null)}
          onBlur={() => setHover(null)}
        >
          <ActionIcon type={g.type} />
          <em className="mt-0.5 text-[9px] not-italic text-text-faint">{g.names.length}</em>
        </button>
      ))}
    </div>
  );

  return (
    <>
      <div className="max-h-[640px] overflow-auto rounded-xl border border-border bg-surface">
        <table className="tabular w-max min-w-full border-separate border-spacing-0 text-xs">
          <thead>
            <tr>
              <th className={`${sticky} left-0 top-0 z-20 min-w-[96px] border-b border-border bg-surface-raised px-3 py-2 text-left font-medium text-text-muted`}>Daily</th>
              <th className={`${sticky} left-[96px] top-0 z-20 min-w-[110px] border-b border-r border-border bg-surface-raised px-3 py-2 text-left font-medium text-text-muted`}>Marketing Actions</th>
              {specs.map((s) => (
                <FragmentHeads key={s.key} spec={s} showActual={showActual} showGoal={showGoal} />
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.date} className={`group ${r.projected ? "text-text-faint" : ""}`}>
                <td className={`${sticky} left-0 border-b border-border/40 px-3 py-2 text-left text-text-muted`}>{r.label}</td>
                <td className={`${sticky} left-[96px] border-b border-r border-border/40 px-3 py-1 text-left`}>{actionsCell(r)}</td>
                {specs.map((s) => {
                  const c = r.cells[s.key];
                  const goalOnly = !showActual;
                  return (
                    <Cells key={s.key}>
                      {showActual && (
                        <td className="relative border-b border-border/40 px-3 py-2 text-right" style={state.heat && !r.projected ? heatStyle(c.tone, c.diff) : undefined}>
                          {state.deltas && !r.projected && c.diff !== null && <span className={`absolute right-1 top-0.5 text-[8.5px] leading-none ${c.tone === "good" ? "text-good" : c.tone === "bad" ? "text-bad" : "text-text-faint"}`}>{`${c.diff >= 0 ? "+" : ""}${Math.round(c.diff * 100)}%`}</span>}
                          {r.projected && !goalOnly ? <span className="text-text-faint">{fmt(s, c.actual)}</span> : fmt(s, c.actual)}
                        </td>
                      )}
                      {showGoal && s.goal && <td className="border-b border-border/40 bg-accent/5 px-3 py-2 text-right text-text-muted">{fmt(s, c.goal)}</td>}
                    </Cells>
                  );
                })}
              </tr>
            ))}
            <tr className="font-semibold">
              <td className={`${sticky} bottom-0 left-0 z-20 border-t border-border bg-surface-raised px-3 py-2 text-left`}>{total.label}</td>
              <td className={`${sticky} bottom-0 left-[96px] z-20 border-r border-t border-border bg-surface-raised px-3 py-2`} />
              {specs.map((s) => (
                <Cells key={s.key}>
                  {showActual && <td className="sticky bottom-0 border-t border-border bg-surface-raised px-3 py-2 text-right">{fmt(s, total.cells[s.key].actual)}</td>}
                  {showGoal && s.goal && <td className="sticky bottom-0 border-t border-border bg-surface-raised px-3 py-2 text-right text-text-muted">{fmt(s, total.cells[s.key].goal)}</td>}
                </Cells>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      {hover && (
        <div className="pointer-events-none fixed z-50 max-w-xs rounded-lg border border-border bg-surface-raised px-3 py-2 text-xs shadow-lg" style={{ left: Math.min(hover.x, typeof window === "undefined" ? hover.x : window.innerWidth - 320), top: Math.max(8, hover.y - 8) }}>
          <div className="text-[10px] uppercase tracking-wide text-text-faint">{hover.title}</div>
          {hover.names.map((n) => (
            <div key={n} className="mt-1 text-text">
              {n}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function Cells({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

function FragmentHeads({ spec, showActual, showGoal }: { spec: MetricSpec; showActual: boolean; showGoal: boolean }) {
  const th = "sticky top-0 z-10 whitespace-nowrap border-b border-border bg-surface-raised px-3 py-2 text-right font-medium text-text-muted";
  return (
    <>
      {showActual && (
        <th className={th}>
          {spec.label}
          <span className="block text-[9.5px] font-normal text-text-faint">/Proj.</span>
        </th>
      )}
      {showGoal && spec.goal && <th className={`${th} bg-accent/10`}>{spec.label.replace("Marketing Efficiency Rating", "MER")} Goal</th>}
    </>
  );
}
