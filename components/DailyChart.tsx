"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { shortLabel } from "@/lib/dates";

export interface ChartSeries {
  id: string;
  label: string;
  kind: "bar" | "line";
  color: string;
  values: (number | null)[];
  dashed?: boolean;
}

interface Props {
  dates: string[];
  series: ChartSeries[];
  formatValue: (v: number) => string;
  formatAxis?: (v: number) => string;
  height?: number;
}

function niceTicks(min: number, max: number, count = 5): number[] {
  if (max === min) max = min + 1;
  const raw = (max - min) / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
  const start = Math.floor(min / step) * step;
  const out: number[] = [];
  for (let v = start; v <= max + step * 0.999; v += step) out.push(Number(v.toFixed(10)));
  return out;
}

export function DailyChart({ dates, series, formatValue, formatAxis, height = 320 }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.max(320, el.clientWidth)));
    ro.observe(el);
    setWidth(Math.max(320, el.clientWidth));
    return () => ro.disconnect();
  }, []);

  const m = { l: 60, r: 12, t: 12, b: 28 };
  const innerW = width - m.l - m.r;
  const innerH = height - m.t - m.b;
  const n = dates.length;

  const { ticks, lo, hi } = useMemo(() => {
    let mn = 0;
    let mx = 0;
    for (const s of series) for (const v of s.values) if (v !== null && Number.isFinite(v)) {
      mn = Math.min(mn, v);
      mx = Math.max(mx, v);
    }
    const t = niceTicks(mn, mx * 1.05 || 1);
    return { ticks: t, lo: t[0], hi: t[t.length - 1] };
  }, [series]);

  const y = (v: number) => m.t + innerH - ((v - lo) / (hi - lo || 1)) * innerH;
  const slot = innerW / Math.max(1, n);
  const x = (i: number) => m.l + slot * i + slot / 2;

  const bars = series.filter((s) => s.kind === "bar");
  const barW = Math.max(1, Math.min(28, (slot * 0.8) / Math.max(1, bars.length)));
  const labelEvery = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(innerW / 64))));
  const fmtAxis = formatAxis ?? formatValue;

  const linePath = (vals: (number | null)[]) => {
    let d = "";
    let pen = false;
    vals.forEach((v, i) => {
      if (v === null || !Number.isFinite(v)) {
        pen = false;
        return;
      }
      d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    });
    return d;
  };

  return (
    <div ref={wrap} className="relative w-full">
      <svg
        width={width}
        height={height}
        role="img"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const i = Math.floor((e.clientX - r.left - m.l) / slot);
          setHover(i >= 0 && i < n ? i : null);
        }}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={m.l} x2={width - m.r} y1={y(t)} y2={y(t)} stroke="var(--apex-border)" strokeWidth={t === 0 ? 1.5 : 1} />
            <text x={m.l - 8} y={y(t) + 4} textAnchor="end" fontSize="10" fill="var(--apex-text-faint)">
              {fmtAxis(t)}
            </text>
          </g>
        ))}
        {dates.map((d, i) =>
          i % labelEvery === 0 ? (
            <text key={d} x={x(i)} y={height - 8} textAnchor="middle" fontSize="10" fill="var(--apex-text-faint)">
              {shortLabel(d)}
            </text>
          ) : null,
        )}
        {bars.map((s, bi) =>
          s.values.map((v, i) =>
            v === null ? null : (
              <rect
                key={`${s.id}-${i}`}
                x={x(i) - (bars.length * barW) / 2 + bi * barW}
                y={Math.min(y(v), y(0))}
                width={Math.max(1, barW - 1)}
                height={Math.abs(y(v) - y(0))}
                fill={s.color}
                opacity={hover === null || hover === i ? 1 : 0.55}
              />
            ),
          ),
        )}
        {series
          .filter((s) => s.kind === "line")
          .map((s) => (
            <path
              key={s.id}
              d={linePath(s.values)}
              fill="none"
              stroke={s.color}
              strokeWidth={2}
              strokeDasharray={s.dashed ? "5 4" : undefined}
              strokeLinejoin="round"
            />
          ))}
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={m.t} y2={m.t + innerH} stroke="var(--apex-text-faint)" strokeDasharray="2 3" />}
      </svg>
      {hover !== null && (
        <div
          className="pointer-events-none absolute top-2 z-10 min-w-40 rounded-lg border border-border bg-surface-raised p-2 text-xs shadow-lg"
          style={{ left: Math.min(Math.max(0, x(hover) + 12), width - 180) }}
        >
          <div className="mb-1 font-medium text-text">{shortLabel(dates[hover])}</div>
          {series.map((s) => (
            <div key={s.id} className="tabular flex items-center justify-between gap-3">
              <span className="flex items-center gap-1.5 text-text-muted">
                <span className="inline-block h-2 w-2 rounded-sm" style={{ background: s.color }} />
                {s.label}
              </span>
              <span className="text-text">{s.values[hover] === null ? "–" : formatValue(s.values[hover] as number)}</span>
            </div>
          ))}
        </div>
      )}
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-muted">
        {series.map((s) => (
          <span key={s.id} className="flex items-center gap-1.5">
            <span
              className="inline-block h-0.5 w-4"
              style={{
                background: s.kind === "bar" ? undefined : s.color,
                borderTop: s.dashed ? `2px dashed ${s.color}` : undefined,
                height: s.kind === "bar" ? 8 : s.dashed ? 0 : 2,
                width: s.kind === "bar" ? 8 : 16,
                ...(s.kind === "bar" ? { background: s.color } : {}),
              }}
            />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}
