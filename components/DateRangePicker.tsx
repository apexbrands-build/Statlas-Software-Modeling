"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  addDays,
  addMonths,
  addYears,
  bfcmRange,
  dayOfWeek,
  endOfMonth,
  endOfQuarter,
  startOfMonth,
  startOfQuarter,
  startOfWeek,
  todayLocal,
  usDate,
  type Range,
} from "@/lib/dates";

type Mode = "range" | "week" | "month" | "quarter" | "year";

const RELATIVE: { label: string; get: (today: string) => Range }[] = [
  { label: "Yesterday", get: (t) => ({ from: addDays(t, -1), to: addDays(t, -1) }) },
  { label: "Last 7 days", get: (t) => ({ from: addDays(t, -7), to: addDays(t, -1) }) },
  { label: "Last 14 days", get: (t) => ({ from: addDays(t, -14), to: addDays(t, -1) }) },
  { label: "Last 30 days", get: (t) => ({ from: addDays(t, -30), to: addDays(t, -1) }) },
  { label: "This month", get: (t) => ({ from: startOfMonth(t), to: endOfMonth(t) }) },
  { label: "Last month", get: (t) => ({ from: startOfMonth(addMonths(t, -1)), to: endOfMonth(addMonths(t, -1)) }) },
  { label: "This quarter", get: (t) => ({ from: startOfQuarter(t), to: endOfQuarter(t) }) },
  { label: "Last quarter", get: (t) => ({ from: startOfQuarter(addMonths(startOfQuarter(t), -3)), to: endOfQuarter(addMonths(startOfQuarter(t), -3)) }) },
  { label: "Year to date", get: (t) => ({ from: `${t.slice(0, 4)}-01-01`, to: addDays(t, -1) }) },
  { label: "Last year", get: (t) => ({ from: `${Number(t.slice(0, 4)) - 1}-01-01`, to: `${Number(t.slice(0, 4)) - 1}-12-31` }) },
];

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

/**
 * Date range control: a button showing the range, and a pop-up with preset buttons on the left
 * (Last x Days, Week, Month, Last x Months, Quarter, Year, BFCM, Relative) and a month calendar on the right.
 */
export function DateRangePicker({ value, onChange }: { value: Range; onChange: (r: Range) => void }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("range");
  const [view, setView] = useState(startOfMonth(value.from));
  const [pending, setPending] = useState<string | null>(null); // first click of a range
  const [nDays, setNDays] = useState(30);
  const [nMonths, setNMonths] = useState(3);
  const [panel, setPanel] = useState<null | "days" | "months" | "relative">(null);
  const ref = useRef<HTMLDivElement>(null);
  const today = useMemo(() => todayLocal(), []);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const apply = (r: Range, close = true) => {
    onChange(r);
    setView(startOfMonth(r.from));
    setPending(null);
    if (close) setOpen(false);
  };

  function pick(d: string) {
    if (mode === "week") return apply({ from: startOfWeek(d), to: addDays(startOfWeek(d), 6) });
    if (mode === "month") return apply({ from: startOfMonth(d), to: endOfMonth(d) });
    if (mode === "quarter") return apply({ from: startOfQuarter(d), to: endOfQuarter(d) });
    if (mode === "year") return apply({ from: `${d.slice(0, 4)}-01-01`, to: `${d.slice(0, 4)}-12-31` });
    if (!pending) return setPending(d);
    apply(d < pending ? { from: d, to: pending } : { from: pending, to: d });
  }

  // Calendar grid for the viewed month (weeks start on Sunday like the reference tool)
  const first = view;
  const lead = dayOfWeek(first);
  const days = Number(endOfMonth(first).slice(8, 10));
  const cells: (string | null)[] = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => addDays(first, i))];
  const lo = pending ?? value.from;
  const hi = pending ?? value.to;

  const sideBtn = (label: string, active: boolean, onClick: () => void) => (
    <button key={label} type="button" onClick={onClick} className={`w-full rounded-lg border px-3 py-1.5 text-left text-sm ${active ? "border-accent text-accent" : "border-border text-text-muted hover:text-text"}`}>
      {label}
    </button>
  );
  const num = "w-16 rounded-md border border-border bg-surface px-2 py-1 text-sm outline-none focus:border-accent";

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen(!open)} aria-haspopup="dialog" aria-expanded={open} className="flex items-center gap-3 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm hover:border-accent">
        <span aria-hidden>📅</span>
        <span className="tabular">
          {usDate(value.from)} – {usDate(value.to)}
        </span>
        <span className="text-text-faint">⌄</span>
      </button>
      {open && (
        <div role="dialog" aria-label="Choose dates" className="absolute right-0 z-40 mt-2 flex w-[min(92vw,34rem)] gap-4 rounded-2xl border border-border bg-bg p-4 shadow-2xl">
          <div className="w-40 shrink-0 space-y-2">
            {sideBtn("Last x Days", panel === "days", () => setPanel(panel === "days" ? null : "days"))}
            {panel === "days" && (
              <div className="flex items-center gap-2 pl-2 text-xs text-text-muted">
                <input aria-label="Number of days" type="number" min={1} max={800} value={nDays} onChange={(e) => setNDays(Number(e.target.value) || 1)} className={num} />
                <button type="button" className="rounded-md bg-accent px-2 py-1 font-semibold text-black" onClick={() => apply({ from: addDays(today, -nDays), to: addDays(today, -1) })}>
                  Go
                </button>
              </div>
            )}
            {sideBtn("Week", mode === "week", () => { setMode("week"); apply({ from: startOfWeek(today), to: addDays(startOfWeek(today), 6) }, false); })}
            {sideBtn("Month", mode === "month", () => { setMode("month"); apply({ from: startOfMonth(today), to: endOfMonth(today) }, false); })}
            {sideBtn("Last x Months", panel === "months", () => setPanel(panel === "months" ? null : "months"))}
            {panel === "months" && (
              <div className="flex items-center gap-2 pl-2 text-xs text-text-muted">
                <input aria-label="Number of months" type="number" min={1} max={48} value={nMonths} onChange={(e) => setNMonths(Number(e.target.value) || 1)} className={num} />
                <button type="button" className="rounded-md bg-accent px-2 py-1 font-semibold text-black" onClick={() => apply({ from: startOfMonth(addMonths(today, -nMonths)), to: endOfMonth(addMonths(today, -1)) })}>
                  Go
                </button>
              </div>
            )}
            {sideBtn("Quarter", mode === "quarter", () => { setMode("quarter"); apply({ from: startOfQuarter(today), to: endOfQuarter(today) }, false); })}
            {sideBtn("Year", mode === "year", () => { setMode("year"); apply({ from: `${today.slice(0, 4)}-01-01`, to: `${today.slice(0, 4)}-12-31` }, false); })}
            {sideBtn("BFCM", false, () => {
              const y = Number(view.slice(0, 4));
              apply(bfcmRange(today < bfcmRange(y).from && y === Number(today.slice(0, 4)) ? y - 1 : y));
            })}
            {sideBtn("Relative", panel === "relative", () => setPanel(panel === "relative" ? null : "relative"))}
            {panel === "relative" && (
              <div className="max-h-48 space-y-1 overflow-auto pl-2">
                {RELATIVE.map((r) => (
                  <button key={r.label} type="button" onClick={() => apply(r.get(today))} className="block w-full rounded-md px-2 py-1 text-left text-xs text-text-muted hover:bg-surface-raised hover:text-text">
                    {r.label}
                  </button>
                ))}
              </div>
            )}
            {mode !== "range" && (
              <button type="button" onClick={() => setMode("range")} className="w-full text-left text-[11px] text-text-faint hover:text-text">
                ← Back to picking a custom range
              </button>
            )}
          </div>

          <div className="min-w-0 flex-1">
            <div className="mb-3 flex items-center justify-between gap-2 text-sm">
              <button type="button" aria-label="Previous year" onClick={() => setView(addYears(view, -1))} className="rounded-lg border border-border px-2 py-1 text-xs text-text-muted hover:text-text">
                {Number(view.slice(0, 4)) - 1}
              </button>
              <button type="button" aria-label="Previous month" onClick={() => setView(addMonths(view, -1))} className="rounded-lg border border-border px-2 py-1 text-text-muted hover:text-text">
                ‹
              </button>
              <span className="font-semibold tracking-wide">
                {MONTHS[Number(view.slice(5, 7)) - 1]} {view.slice(0, 4)}
              </span>
              <button type="button" aria-label="Next month" onClick={() => setView(addMonths(view, 1))} className="rounded-lg border border-border px-2 py-1 text-text-muted hover:text-text">
                ›
              </button>
              <button type="button" aria-label="Next year" onClick={() => setView(addYears(view, 1))} className="rounded-lg border border-border px-2 py-1 text-xs text-text-muted hover:text-text">
                {Number(view.slice(0, 4)) + 1}
              </button>
            </div>
            <div className="h-1.5 rounded-full bg-accent/70" />
            <div className="mt-2 grid grid-cols-7 gap-1 text-center text-xs text-text-faint">
              {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
                <div key={i}>{d}</div>
              ))}
            </div>
            <div className="mt-1 grid grid-cols-7 gap-1">
              {cells.map((d, i) =>
                d === null ? (
                  <div key={i} />
                ) : (
                  <button
                    key={d}
                    type="button"
                    onClick={() => pick(d)}
                    className={`tabular aspect-square rounded-lg text-sm ${d === lo || d === hi ? "bg-accent font-semibold text-black" : d > lo && d < hi ? "bg-accent/20 text-text" : "text-text-muted hover:bg-surface-raised"}`}
                  >
                    {Number(d.slice(8, 10))}
                  </button>
                ),
              )}
            </div>
            <p className="mt-3 text-[11px] text-text-faint">
              {mode === "range" ? (pending ? "Now click the end date." : "Click a start date, then an end date.") : `Click any day to select its whole ${mode}.`}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
