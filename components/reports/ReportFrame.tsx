"use client";

import Link from "next/link";
import { useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { DateRangePicker } from "@/components/DateRangePicker";
import { useApp } from "@/lib/app-context";
import { endOfMonth, startOfMonth, todayLocal, type Range } from "@/lib/dates";
import { getReport } from "@/lib/reports/registry";

/** Selected date range for a report (defaults to the current month, like Home). */
export function useReportRange() {
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const [range, setRange] = useState<Range | null>(null);
  const active = useMemo(() => {
    if (range) return range;
    if (!mounted) return null;
    const t = todayLocal();
    return { from: startOfMonth(t), to: endOfMonth(t) };
  }, [range, mounted]);
  return { range: active, setRange };
}

export function ReportFrame({ slug, range, setRange, controls, children }: { slug: string; range: Range | null; setRange?: (r: Range) => void; controls?: ReactNode; children: ReactNode }) {
  const { client } = useApp();
  const def = getReport(slug);
  return (
    <div className="mx-auto max-w-[1400px] space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/reporting" className="rounded-lg border border-border px-3 py-1.5 text-sm text-text-muted hover:text-text">
          ← Reports
        </Link>
        <div className="mr-auto min-w-0">
          <h1 className="text-xl font-semibold" style={{ fontFamily: "var(--apex-font-heading)" }}>
            {def?.title ?? "Report"}
          </h1>
          <p className="text-xs text-text-muted">
            {def?.description}
            {client ? ` · ${client.currency} · ${client.timezone}` : ""}
          </p>
        </div>
        {controls}
        {range && setRange && <DateRangePicker value={range} onChange={setRange} />}
      </div>
      {children}
    </div>
  );
}

export const selectClass = "rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-text outline-none focus:border-accent";

export function Loading() {
  return <div className="h-64 animate-pulse rounded-xl bg-surface" />;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-border bg-surface p-8 text-center text-text-muted">{children}</div>;
}
