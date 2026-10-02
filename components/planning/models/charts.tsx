"use client";

import { useId } from "react";

const PAD = { l: 44, r: 12, t: 10, b: 26 };

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const f = v / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
}

export interface ScatterPoint {
  x: number;
  y: number;
  tone: "history" | "lastYear" | "selected";
}

const TONE: Record<ScatterPoint["tone"], string> = { history: "var(--color-text-faint, #888)", lastYear: "#5eead4", selected: "#ef4444" };

/** aMER against spend: historical days as dots, the fitted curve as a line, the chosen spend as a red dot. */
export function ScatterCurve({ points, curve, xFmt, height = 260 }: { points: ScatterPoint[]; curve: { x: number; y: number }[]; xFmt: (v: number) => string; height?: number }) {
  const w = 760;
  const xs = [...points.map((p) => p.x), ...curve.map((p) => p.x)];
  const ys = [...points.map((p) => p.y), ...curve.map((p) => p.y)];
  const xMax = niceMax(Math.max(1, ...xs));
  const yMax = niceMax(Math.max(1, ...ys));
  const X = (v: number) => PAD.l + (v / xMax) * (w - PAD.l - PAD.r);
  const Y = (v: number) => height - PAD.b - (Math.min(v, yMax) / yMax) * (height - PAD.t - PAD.b);
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  const path = curve.map((p, i) => `${i ? "L" : "M"}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${height}`} className="w-full" role="img" aria-label="aMER against spend">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={PAD.l} x2={w - PAD.r} y1={Y(yMax * t)} y2={Y(yMax * t)} stroke="currentColor" opacity={0.1} />
          <text x={PAD.l - 6} y={Y(yMax * t) + 3} textAnchor="end" fontSize={10} fill="currentColor" opacity={0.6}>
            {(yMax * t).toFixed(yMax < 5 ? 1 : 0)}
          </text>
          <text x={X(xMax * t)} y={height - 8} textAnchor="middle" fontSize={10} fill="currentColor" opacity={0.6}>
            {xFmt(xMax * t)}
          </text>
        </g>
      ))}
      {points
        .filter((p) => p.tone !== "selected")
        .map((p, i) => (
          <circle key={i} cx={X(p.x)} cy={Y(p.y)} r={p.tone === "lastYear" ? 3 : 2.2} fill={TONE[p.tone]} opacity={p.tone === "lastYear" ? 0.9 : 0.55} />
        ))}
      <path d={path} fill="none" stroke="#facc15" strokeWidth={2.5} strokeDasharray="1 4" strokeLinecap="round" />
      {points
        .filter((p) => p.tone === "selected")
        .map((p, i) => (
          <circle key={i} cx={X(p.x)} cy={Y(p.y)} r={6} fill={TONE.selected} stroke="white" strokeWidth={1.5} />
        ))}
    </svg>
  );
}

export function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-muted">
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: i.color }} />
          {i.label}
        </span>
      ))}
    </div>
  );
}

export interface LineSeries {
  label: string;
  color: string;
  values: (number | null)[];
  dashed?: boolean;
}

/** Simple multi-line chart over labelled steps (months, ages). */
export function LineChart({ series, labels, yFmt, height = 220 }: { series: LineSeries[]; labels: string[]; yFmt: (v: number) => string; height?: number }) {
  const id = useId();
  const w = 760;
  const yMax = niceMax(Math.max(1e-9, ...series.flatMap((s) => s.values.map((v) => v ?? 0))));
  const n = Math.max(1, labels.length - 1);
  const X = (i: number) => PAD.l + (i / n) * (w - PAD.l - PAD.r);
  const Y = (v: number) => height - PAD.b - (v / yMax) * (height - PAD.t - PAD.b);
  return (
    <svg viewBox={`0 0 ${w} ${height}`} className="w-full" role="img" aria-labelledby={id}>
      <title id={id}>Line chart</title>
      {[0, 0.25, 0.5, 0.75, 1].map((t) => (
        <g key={t}>
          <line x1={PAD.l} x2={w - PAD.r} y1={Y(yMax * t)} y2={Y(yMax * t)} stroke="currentColor" opacity={0.1} />
          <text x={PAD.l - 6} y={Y(yMax * t) + 3} textAnchor="end" fontSize={10} fill="currentColor" opacity={0.6}>
            {yFmt(yMax * t)}
          </text>
        </g>
      ))}
      {labels.map((l, i) => (
        <text key={i} x={X(i)} y={height - 8} textAnchor="middle" fontSize={10} fill="currentColor" opacity={0.6}>
          {l}
        </text>
      ))}
      {series.map((s) => {
        let d = "";
        s.values.forEach((v, i) => {
          if (v == null) return;
          d += `${d && s.values[i - 1] != null ? "L" : "M"}${X(i).toFixed(1)},${Y(v).toFixed(1)} `;
        });
        return <path key={s.label} d={d} fill="none" stroke={s.color} strokeWidth={2} strokeDasharray={s.dashed ? "5 4" : undefined} />;
      })}
    </svg>
  );
}
