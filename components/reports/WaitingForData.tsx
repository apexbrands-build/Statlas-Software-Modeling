"use client";

import { ReportFrame } from "./ReportFrame";
import { getReport } from "@/lib/reports/registry";

/** Layout placeholder for reports whose data source is not connected yet. */
export function WaitingForData({ slug, outline }: { slug: string; outline: string[] }) {
  const def = getReport(slug);
  return (
    <ReportFrame slug={slug} range={null}>
      <div className="rounded-xl border border-dashed border-border bg-surface p-6">
        <span className="rounded-full border border-accent px-3 py-1 text-xs font-medium uppercase tracking-wide text-accent">Waiting for data source</span>
        <p className="mt-4 text-sm text-text-muted">
          Needs: <span className="text-text">{def?.needs ?? "a data source"}</span>. The report appears here once it is connected.
        </p>
        <p className="mt-4 text-xs font-medium uppercase tracking-wide text-text-faint">What this report will show</p>
        <ul className="mt-2 grid gap-1 text-sm text-text-muted md:grid-cols-2">
          {outline.map((o) => (
            <li key={o} className="rounded-lg border border-border px-3 py-2">
              {o}
            </li>
          ))}
        </ul>
      </div>
    </ReportFrame>
  );
}
