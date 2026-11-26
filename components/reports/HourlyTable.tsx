"use client";

import { Fragment } from "react";
import { formatValue } from "@/lib/format";
import { markerText, type DayCell, type HourlyCell, type HourlyResult, type HourlyRow } from "@/lib/reports/hourly";
import { HOURLY_BLOCKS, type HourlySpec } from "@/lib/reports/hourly-specs";
import type { Currency } from "@/lib/types";
import { heatStyle } from "./CalendarTable";
import { ActionIcon } from "./calendar-icons";

const HOUR_W = 84;
const HAPPENED_W = 230;
const toneClass = (tone: HourlyCell["tone"]) => (tone === "good" ? "text-good" : tone === "bad" ? "text-bad" : "text-text-faint");
const diffText = (diff: number | null) => (diff === null ? "" : `${diff >= 0 ? "+" : ""}${Math.round(diff * 100)}%`);

/**
 * The hourly grid: hours down the side, blocks of columns across, a Day row that stays in view. Every column is three numbers:
 * actual, expected and the difference (green or red beyond 10% either way). Hours to come show the expectation only, an hour that
 * is still open is shown without a verdict, and a column with no hourly source says so.
 */
export function HourlyTable({ result, specs, currency, cumulative }: { result: HourlyResult; specs: HourlySpec[]; currency: Currency; cumulative: boolean }) {
  const fmt = (spec: HourlySpec, v: number | null) => (v === null ? "–" : formatValue(v, spec.format, currency));
  const blocks = HOURLY_BLOCKS.map((b) => ({ ...b, specs: specs.filter((s) => s.block === b.id) })).filter((b) => b.specs.length > 0);
  const firstOfBlock = new Set(blocks.map((b) => b.specs[0].key));
  const edge = (spec: HourlySpec) => (firstOfBlock.has(spec.key) ? "border-l-2 border-l-border" : "border-l border-l-border/50");
  const firstToCome = result.rows.find((r) => r.state === "tocome")?.hour ?? -1;
  const today = result.progress.kind === "today";
  const head = "sticky z-10 whitespace-nowrap border-b border-border bg-surface-raised px-2.5 font-medium";
  const pinned = "sticky z-10 bg-surface";

  const happened = (row: HourlyRow) =>
    row.markers.length === 0 ? null : (
      <ul className="space-y-0.5">
        {row.markers.map((m) => (
          <li key={`${m.type}|${m.name}`} className="flex items-start gap-1.5 leading-snug text-text">
            <span className="mt-0.5 shrink-0">
              <ActionIcon type={m.type} size={12} />
            </span>
            <span className="min-w-0 break-words">{markerText(m)}</span>
          </li>
        ))}
      </ul>
    );

  const cells = (row: HourlyRow | null, spec: HourlySpec, c: HourlyCell | DayCell, base: string) => {
    const state = row?.state ?? "done";
    // The Day row stays in view over the scrolling hours, so it keeps a solid background: its verdict is the colour of the difference.
    const heat = row !== null && state === "done" && !c.noData ? heatStyle(c.tone, c.diff) : undefined;
    const full = row === null && today && "full" in c && c.full !== null && c.expected !== null ? c.full : null;
    return (
      <Fragment key={spec.key}>
        <td className={`${base} ${edge(spec)} px-2.5 py-1.5 text-right`} style={heat}>
          {state === "tocome" ? "" : c.noData ? <span className="whitespace-nowrap text-[10px] text-text-faint">no hourly data yet</span> : fmt(spec, c.actual)}
        </td>
        <td className={`${base} px-2.5 py-1.5 text-right text-text-muted`}>
          {fmt(spec, c.expected)}
          {full !== null && spec.additive && <span className="block whitespace-nowrap text-[9.5px] font-normal text-text-faint">day {fmt(spec, full)}</span>}
        </td>
        <td className={`${base} px-2.5 py-1.5 text-right ${toneClass(c.tone)}`}>{diffText(c.diff)}</td>
      </Fragment>
    );
  };

  return (
    <div className="max-h-[720px] overflow-auto rounded-xl border border-border bg-surface">
      <table className="tabular w-max min-w-full border-separate border-spacing-0 text-xs">
        <thead>
          <tr>
            <th rowSpan={2} className={`${head} left-0 top-0 z-20 text-left text-text-muted`} style={{ minWidth: HOUR_W, width: HOUR_W }}>
              Hour
              <span className="block text-[9.5px] font-normal text-text-faint">{cumulative ? "running total" : "store's clock"}</span>
            </th>
            <th rowSpan={2} className={`${head} top-0 z-20 border-r text-left text-text-muted`} style={{ left: HOUR_W, minWidth: HAPPENED_W, width: HAPPENED_W }}>
              What happened
            </th>
            {blocks.map((b) => (
              <th key={b.id} colSpan={b.specs.length * 3} className={`${head} top-0 h-8 border-l-2 border-l-border text-left text-text`}>
                {/* The block's name stays in view while its columns scroll sideways. */}
                <span className="sticky inline-block" style={{ left: HOUR_W + HAPPENED_W + 10 }}>
                  {b.label}
                </span>
              </th>
            ))}
          </tr>
          <tr>
            {specs.map((s) => (
              <Fragment key={s.key}>
                <th className={`${head} top-8 h-8 text-right text-text-muted ${edge(s)}`}>{s.short}</th>
                <th className={`${head} top-8 h-8 text-right text-text-faint`}>Expected</th>
                <th className={`${head} top-8 h-8 text-right text-text-faint`}>Diff</th>
              </Fragment>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.rows.map((r) => {
            const rule = r.hour === firstToCome && r.hour > 0 ? "border-t-2 border-t-accent/50" : "";
            const base = `border-b border-border/40 ${rule}`;
            return (
              <tr key={r.hour} className={r.state === "tocome" ? "text-text-faint" : r.state === "partial" ? "text-text-muted" : ""}>
                <td className={`${pinned} left-0 ${base} px-2.5 py-1.5 text-left text-text-muted`}>
                  {r.label}
                  {r.state === "partial" && (
                    <span className="ml-1.5 rounded border border-border px-1 text-[9px] uppercase tracking-wide text-text-faint" title="This hour is still open: its orders may still be loading, so it is shown without a verdict.">
                      open
                    </span>
                  )}
                </td>
                <td className={`${pinned} ${base} border-r border-r-border/40 px-2.5 py-1.5 text-left`} style={{ left: HOUR_W, maxWidth: HAPPENED_W }}>
                  {happened(r)}
                </td>
                {specs.map((s) => cells(r, s, r.cells[s.key], base))}
              </tr>
            );
          })}
          <tr className="font-semibold">
            <td className="sticky bottom-0 left-0 z-20 border-t border-border bg-surface-raised px-2.5 py-2 text-left">{result.day.label}</td>
            <td className="sticky bottom-0 z-20 border-r border-t border-border bg-surface-raised px-2.5 py-2" style={{ left: HOUR_W }} />
            {specs.map((s) => cells(null, s, result.day.cells[s.key], "sticky bottom-0 z-10 border-t border-border bg-surface-raised"))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
