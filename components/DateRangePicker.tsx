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

interface Option {
  label: string;
  range: Range;
}
interface Group {
  id: string;
  title: string;
  options: Option[];
}

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const ago = (i: number, unit: string) => (i === 0 ? `This ${unit}` : i === 1 ? `Last ${unit}` : `${i} ${unit}s ago`);

/** The preset lists, built from today's date (weeks start on Monday). */
export function buildGroups(today: string): Group[] {
  const year = Number(today.slice(0, 4));

  const days: Option[] = [7, 14, 30, 60, 90].map((n) => ({ label: `Last ${n} days`, range: { from: addDays(today, -n), to: addDays(today, -1) } }));

  const weeks: Option[] = Array.from({ length: 7 }, (_, i) => {
    const start = addDays(startOfWeek(today), -7 * i);
    return { label: ago(i, "week"), range: { from: start, to: addDays(start, 6) } };
  });

  const singleMonths: Option[] = Array.from({ length: 7 }, (_, i) => {
    const m = addMonths(today, -i);
    return { label: ago(i, "month"), range: { from: startOfMonth(m), to: endOfMonth(m) } };
  });
  const lastMonthsEnd = endOfMonth(addMonths(today, -1));
  const monthRanges: Option[] = [2, 3, 4, 5, 6].map((n) => ({ label: `Last ${n} months`, range: { from: startOfMonth(addMonths(today, -n)), to: lastMonthsEnd } }));

  const quarters: Option[] = Array.from({ length: 7 }, (_, i) => {
    const start = addMonths(startOfQuarter(today), -3 * i);
    const q = Math.floor((Number(start.slice(5, 7)) - 1) / 3) + 1;
    const label = i === 0 ? "This quarter" : i === 1 ? "Last quarter" : `${start.slice(0, 4)} Q${q}`;
    return { label, range: { from: start, to: endOfQuarter(start) } };
  });

  const years: Option[] = Array.from({ length: 6 }, (_, i) => {
    const y = year - 1 - i;
    return { label: i === 0 ? "Last year" : String(y), range: { from: `${y}-01-01`, to: `${y}-12-31` } };
  });

  const bfcm: Option[] = Array.from({ length: 6 }, (_, i) => ({ label: `BFCM ${year - 1 - i}`, range: bfcmRange(year - 1 - i) }));

  return [
    { id: "days", title: "Days", options: days },
    { id: "weeks", title: "Weeks", options: weeks },
    { id: "months", title: "Months", options: [...singleMonths, ...monthRanges] },
    { id: "quarters", title: "Quarters", options: quarters },
    { id: "years", title: "Years", options: years },
    { id: "bfcm", title: "BFCM", options: bfcm },
  ];
}

/**
 * Date range control: a button showing the range, and a pop-up with preset lists on the left
 * (Days, Weeks, Months, Quarters, Years, BFCM) and a month calendar on the right for a custom range.
 */
export function DateRangePicker({ value, onChange }: { value: Range; onChange: (r: Range) => void }) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(startOfMonth(value.from));
  const [pending, setPending] = useState<string | null>(null); // first click of a custom range
  const [openGroup, setOpenGroup] = useState<string | null>("days");
  const ref = useRef<HTMLDivElement>(null);
  const today = useMemo(() => todayLocal(), []);
  const groups = useMemo(() => buildGroups(today), [today]);

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

  const apply = (r: Range) => {
    onChange(r);
    setView(startOfMonth(r.from));
    setPending(null);
    setOpen(false);
  };

  function pick(d: string) {
    if (!pending) return setPending(d);
    apply(d < pending ? { from: d, to: pending } : { from: pending, to: d });
  }

  // Calendar grid for the viewed month (weeks start on Sunday like the reference tool)
  const lead = dayOfWeek(view);
  const days = Number(endOfMonth(view).slice(8, 10));
  const cells: (string | null)[] = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => addDays(view, i))];
  const lo = pending ?? value.from;
  const hi = pending ?? value.to;
  const same = (a: Range) => a.from === value.from && a.to === value.to;

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
        <div role="dialog" aria-label="Choose dates" className="absolute right-0 z-40 mt-2 flex w-[min(94vw,36rem)] gap-4 rounded-2xl border border-border bg-bg p-4 shadow-2xl">
          <div className="max-h-[26rem] w-44 shrink-0 space-y-1.5 overflow-y-auto pr-1">
            {groups.map((g) => (
              <div key={g.id}>
                <button
                  type="button"
                  onClick={() => setOpenGroup(openGroup === g.id ? null : g.id)}
                  aria-expanded={openGroup === g.id}
                  className={`flex w-full items-center justify-between rounded-lg border px-3 py-1.5 text-left text-sm ${openGroup === g.id ? "border-accent text-accent" : "border-border text-text-muted hover:text-text"}`}
                >
                  {g.title}
                  <span className="text-xs">{openGroup === g.id ? "⌃" : "⌄"}</span>
                </button>
                {openGroup === g.id && (
                  <div className="mt-1 space-y-0.5 pl-1">
                    {g.options.map((o) => (
                      <button key={o.label} type="button" onClick={() => apply(o.range)} className={`block w-full rounded-md px-2 py-1 text-left text-xs ${same(o.range) ? "bg-accent/20 text-accent" : "text-text-muted hover:bg-surface-raised hover:text-text"}`}>
                        {o.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
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
                  <button key={d} type="button" onClick={() => pick(d)} className={`tabular aspect-square rounded-lg text-sm ${d === lo || d === hi ? "bg-accent font-semibold text-black" : d > lo && d < hi ? "bg-accent/20 text-text" : "text-text-muted hover:bg-surface-raised"}`}>
                    {Number(d.slice(8, 10))}
                  </button>
                ),
              )}
            </div>
            <p className="mt-3 text-[11px] text-text-faint">{pending ? "Now click the end date." : "Custom range: click a start date, then an end date."}</p>
          </div>
        </div>
      )}
    </div>
  );
}
