"use client";

import { useRef, useState } from "react";
import { formatValue } from "@/lib/format";
import type { CalendarRow } from "@/lib/reports/calendar";
import { groupByType } from "@/lib/reports/calendar-actions";
import type { ChartSeries } from "@/lib/reports/calendar-chart";
import type { Currency } from "@/lib/types";
import { ACTION_META, ActionIcon } from "./calendar-icons";

export const SERIES_COLORS = ["#3ad823", "#fbbf24", "#60a5fa", "#c084fc", "#fb923c", "#22d3ee", "#f472b6", "#a3e635"];
const W = 1200;
const PLOT_BOTTOM = 232;
const PAD = { l: 14, r: 14, t: 14 };
const TYPES = ["event", "email", "sms", "meta"] as const;

/** Daily lines for the ticked Graph items (each on its own scale), the first item's goal dashed, projected days dashed, and a marker row per action type under the axis. */
export function CalendarChart({ rows, series, currency }: { rows: CalendarRow[]; series: ChartSeries[]; currency: Currency }) {
  const box = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ i: number; left: number; top: number } | null>(null);
  const n = rows.length;
  if (n === 0) return null;
  if (series.length === 0) return <p className="py-6 text-center text-sm text-text-muted">Tick at least one item under Graph items to draw the chart.</p>;

  const used = TYPES.filter((t) => rows.some((r) => r.actions.some((a) => a.type === t)));
  const H = PLOT_BOTTOM + 30 + Math.max(1, used.length) * 14;
  const X = (i: number) => PAD.l + (n === 1 ? 0 : (i / (n - 1)) * (W - PAD.l - PAD.r));
  const plotH = PLOT_BOTTOM - PAD.t;
  const firstProj = rows.findIndex((r) => r.projected);
  const last = firstProj < 0 ? n - 1 : firstProj - 1;
  const path = (vals: (number | null)[], s: ChartSeries, from: number, to: number) => {
    let d = "";
    for (let i = from; i <= to; i++) {
      const v = vals[i];
      if (v === null || v === undefined) continue;
      const y = PAD.t + plotH * (1 - (v - s.min) / (s.max - s.min));
      d += `${d && vals[i - 1] != null ? "L" : "M"}${X(i).toFixed(1)},${y.toFixed(1)} `;
    }
    return d;
  };

  const onMove = (e: React.MouseEvent<SVGRectElement>) => {
    const svg = e.currentTarget.ownerSVGElement!.getBoundingClientRect();
    const px = ((e.clientX - svg.left) / svg.width) * W;
    const i = Math.max(0, Math.min(n - 1, Math.round(((px - PAD.l) / (W - PAD.l - PAD.r)) * (n - 1))));
    const b = box.current!.getBoundingClientRect();
    setHover({ i, left: e.clientX - b.left, top: e.clientY - b.top });
  };

  const hr = hover ? rows[hover.i] : null;
  return (
    <div ref={box} className="relative">
      <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-text-muted">
        {series.map((s, si) => (
          <span key={s.key}>
            <i className="mr-1.5 inline-block h-[3px] w-3.5 rounded align-middle" style={{ background: SERIES_COLORS[si % SERIES_COLORS.length] }} />
            {s.label}
          </span>
        ))}
        <span>
          <i className="mr-1.5 inline-block h-[3px] w-3.5 rounded align-middle" style={{ background: "#fbbf24", opacity: 0.6 }} />
          Goal (first item)
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label="Line chart of the ticked metrics by day with the marketing actions marked below">
        {[0, 1, 2, 3, 4].map((g) => (
          <line key={g} x1={PAD.l} x2={W - PAD.r} y1={PAD.t + (plotH * g) / 4} y2={PAD.t + (plotH * g) / 4} stroke="currentColor" opacity={0.1} />
        ))}
        {rows.map((r, i) => {
          const day = Number(r.date.slice(8, 10));
          return n <= 40 ? (day % 5 === 1 || i === n - 1 ? <text key={r.date} x={X(i)} y={PLOT_BOTTOM + 16} textAnchor="middle" fontSize={10} fill="currentColor" opacity={0.6}>{r.date.slice(5, 7) + "/" + r.date.slice(8, 10)}</text> : null) : day === 1 ? <text key={r.date} x={X(i)} y={PLOT_BOTTOM + 16} textAnchor="middle" fontSize={10} fill="currentColor" opacity={0.6}>{r.date.slice(0, 7)}</text> : null;
        })}
        {firstProj > 0 && <rect x={X(firstProj - 0.5)} y={PAD.t} width={W - PAD.r - X(firstProj - 0.5)} height={plotH} fill="currentColor" opacity={0.04} />}
        {series.map((s, si) => {
          const color = SERIES_COLORS[si % SERIES_COLORS.length];
          return (
            <g key={s.key}>
              {si === 0 && <path d={path(s.goals, s, 0, n - 1)} fill="none" stroke="#fbbf24" strokeWidth={1.4} strokeDasharray="2 4" opacity={0.8} />}
              <path d={path(s.values, s, 0, last)} fill="none" stroke={color} strokeWidth={2.2} strokeLinejoin="round" />
              {firstProj > 0 && <path d={path(s.values, s, firstProj - 1, n - 1)} fill="none" stroke={color} strokeWidth={2} strokeDasharray="5 4" opacity={0.8} />}
            </g>
          );
        })}
        {rows.map((r, i) => {
          const groups = groupByType(r.actions);
          if (!groups.length) return null;
          return (
            <g key={`m-${r.date}`}>
              <line x1={X(i)} x2={X(i)} y1={PAD.t} y2={PLOT_BOTTOM + 16} stroke="currentColor" opacity={0.07} />
              {groups.map((g) => (
                <ActionIcon key={g.type} type={g.type} size={12} x={X(i) - 6} y={PLOT_BOTTOM + 34 + used.indexOf(g.type) * 14 - 6} />
              ))}
            </g>
          );
        })}
        {hover && <line x1={X(hover.i)} x2={X(hover.i)} y1={PAD.t} y2={PLOT_BOTTOM + 16} stroke="currentColor" opacity={0.5} />}
        <rect x={0} y={0} width={W} height={H} fill="transparent" onMouseMove={onMove} onMouseLeave={() => setHover(null)} />
      </svg>
      {hover && hr && (
        <div className="pointer-events-none absolute z-20 min-w-[190px] max-w-xs rounded-lg border border-border bg-surface-raised px-3 py-2 text-[11px] leading-relaxed shadow-lg" style={{ left: Math.max(0, hover.left > (box.current?.clientWidth ?? 0) - 330 ? hover.left - 320 : hover.left + 14), top: Math.max(0, hover.top - 20) }}>
          <div className="font-semibold">
            {hr.label}
            {hr.projected && <span className="ml-1 text-[10px] font-normal text-text-faint">projected</span>}
          </div>
          {series.map((s, si) => {
            const v = hr.cells[s.key]?.actual ?? null;
            return (
              <div key={s.key} className="flex justify-between gap-4">
                <span>
                  <i className="mr-1.5 inline-block h-2 w-2 rounded-full" style={{ background: SERIES_COLORS[si % SERIES_COLORS.length] }} />
                  {s.label}
                </span>
                <span className="tabular">{v === null ? "–" : formatValue(v, s.format, currency)}</span>
              </div>
            );
          })}
          {series[0] && hr.cells[series[0].key]?.goal != null && (
            <div className="flex justify-between gap-4 text-[#fbbf24]">
              <span>Goal</span>
              <span className="tabular">{formatValue(hr.cells[series[0].key].goal as number, series[0].format, currency)}</span>
            </div>
          )}
          {groupByType(hr.actions).map((g) => (
            <div key={g.type} className="mt-1.5 border-t border-border pt-1.5 text-text-muted">
              <div className="text-[10px] uppercase tracking-wide text-text-faint">{ACTION_META[g.type].label}{g.names.length > 1 ? "s" : ""}</div>
              {g.names.map((nm) => (
                <div key={nm} className="text-text">
                  {nm}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
      <p className="mt-2 text-[11px] text-text-faint">Each line is drawn on its own scale; hover a day for the real values. Dashed = projected days.</p>
    </div>
  );
}
