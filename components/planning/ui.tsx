"use client";

import { useEffect, useRef, type ReactNode } from "react";

export const btn = "rounded-lg border border-border px-3 py-1.5 text-sm text-text-muted hover:text-text disabled:opacity-40 disabled:hover:text-text-muted";
export const btnPrimary = "rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-black hover:opacity-90 disabled:opacity-40";
export const inputClass = "rounded-lg border border-border bg-bg px-2 py-1 text-sm text-text outline-none focus:border-accent disabled:opacity-50";

export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function monthKey(year: number, m: number): string {
  return `${year}-${String(m + 1).padStart(2, "0")}-01`;
}

/** Number box that commits on blur or Enter (so typing "1" on the way to "1500" does not recalculate everything). */
export function NumField({ value, onCommit, disabled, decimals = 0, className = "w-24", suffix }: { value: number; onCommit: (v: number) => void; disabled?: boolean; decimals?: number; className?: string; suffix?: string }) {
  const shown = Number.isFinite(value) ? String(Math.round(value * 10 ** decimals) / 10 ** decimals) : "0";
  return (
    <span className="inline-flex items-center gap-1">
      <input
        key={shown}
        type="text"
        inputMode="decimal"
        defaultValue={shown}
        disabled={disabled}
        className={`${inputClass} ${className} text-right tabular`}
        onBlur={(e) => {
          const v = Number(e.currentTarget.value.replace(/[, £$€%]/g, ""));
          if (Number.isFinite(v) && v !== value) onCommit(v);
          else e.currentTarget.value = shown;
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
      />
      {suffix && <span className="text-xs text-text-faint">{suffix}</span>}
    </span>
  );
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} role="dialog" aria-label={title} className={`mt-10 w-full ${wide ? "max-w-3xl" : "max-w-lg"} rounded-xl border border-border bg-surface p-5`}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold" style={{ fontFamily: "var(--apex-font-heading)" }}>
            {title}
          </h2>
          <button onClick={onClose} className="text-text-muted hover:text-text" aria-label="Close">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
