"use client";

import { useState, type ReactNode } from "react";

export const inputCls = "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent";

/** Collapsible section, like the reference tool's accordion rows. */
export function Accordion({ title, subtitle, children, notApplied, defaultOpen = false }: { title: string; subtitle?: string; children: ReactNode; notApplied?: boolean; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="rounded-xl border border-border bg-surface">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-start justify-between gap-4 px-4 py-3 text-left">
        <span className="flex flex-1 flex-wrap items-baseline gap-x-6 gap-y-1">
          <span className="min-w-40 text-sm font-semibold">{title}</span>
          {subtitle && <span className="text-xs text-text-muted">{subtitle}</span>}
          {notApplied && <span className="rounded-full border border-border px-2 text-[10px] uppercase tracking-wide text-text-faint">Saved · not applied yet</span>}
        </span>
        <span className={`text-text-muted transition-transform ${open ? "rotate-180" : ""}`}>⌄</span>
      </button>
      {open && <div className="space-y-4 border-t border-border px-4 py-4">{children}</div>}
    </section>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block text-xs text-text-muted">
      {label}
      <div className="mt-1 text-sm text-text">{children}</div>
      {hint && <span className="mt-1 block text-[11px] text-text-faint">{hint}</span>}
    </label>
  );
}

export function Select({ value, options, onChange, disabledOptions = [], label }: { value: string; options: string[]; onChange: (v: string) => void; disabledOptions?: string[]; label: string }) {
  return (
    <select aria-label={label} className={inputCls} value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((o) => (
        <option key={o} value={o} disabled={disabledOptions.includes(o)}>
          {o}
          {disabledOptions.includes(o) ? " (coming soon)" : ""}
        </option>
      ))}
    </select>
  );
}

export function Check({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string; disabled?: boolean }) {
  return (
    <label className={`flex items-start gap-3 text-sm ${disabled ? "opacity-60" : ""}`}>
      <input type="checkbox" className="mt-0.5 accent-[var(--apex-accent)]" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>
        {label}
        {hint && <span className="mt-0.5 block text-xs text-text-muted">{hint}</span>}
      </span>
    </label>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)} className={`h-6 w-11 shrink-0 rounded-full border border-border p-0.5 transition-colors ${checked ? "bg-accent" : "bg-surface-raised"}`}>
      <span className={`block rounded-full bg-white transition-transform ${checked ? "translate-x-5 bg-black" : ""}`} style={{ width: 18, height: 18 }} />
    </button>
  );
}

export function NumberInput({ value, onChange, label, step = 1, suffix }: { value: number; onChange: (v: number) => void; label: string; step?: number; suffix?: string }) {
  return (
    <div className="relative">
      <input aria-label={label} type="number" min={0} step={step} className={`${inputCls} ${suffix ? "pr-8" : ""}`} value={value} onChange={(e) => onChange(e.target.value === "" || Number.isNaN(Number(e.target.value)) ? 0 : Number(e.target.value))} />
      {suffix && <span className="absolute right-3 top-2 text-sm text-text-muted">{suffix}</span>}
    </div>
  );
}

export function Modal({ title, onClose, children, footer, wide }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 md:p-10" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} className={`w-full ${wide ? "max-w-3xl" : "max-w-xl"} rounded-2xl border border-border bg-bg`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-base font-semibold" style={{ fontFamily: "var(--apex-font-heading)" }}>
            {title}
          </h2>
          <button onClick={onClose} aria-label="Close" className="rounded-lg border border-border px-3 py-1 text-sm text-text-muted hover:text-text">
            Close
          </button>
        </div>
        <div className="space-y-3 px-5 py-4">{children}</div>
        {footer && <div className="flex items-center justify-end gap-3 border-t border-border px-5 py-4">{footer}</div>}
      </div>
    </div>
  );
}
