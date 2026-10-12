"use client";

import Link from "next/link";
import type { Tone } from "@/lib/metrics";

const TONE_CLASS: Record<Tone, string> = {
  good: "text-good",
  bad: "text-bad",
  neutral: "text-text-muted",
};

export interface TileProps {
  label: string;
  value: string;
  refValue?: string | null;
  diff?: string | null;
  tone: Tone;
  source: string;
  formula: string;
  onInfo: () => void;
  size?: "hero" | "normal";
  /** Link to the report behind this metric (null or missing = no icon). */
  reportHref?: string | null;
}

export function MetricTile({ label, value, refValue, diff, tone, source, formula, onInfo, reportHref }: TileProps) {
  return (
    <div className="group relative rounded-[12px] border border-border bg-surface p-4" title={`${formula}\nSource: ${source}`}>
      <button
        type="button"
        onClick={onInfo}
        aria-label={`Trend for ${label}`}
        className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full border border-border text-[11px] font-semibold text-text-faint hover:border-accent hover:text-accent"
      >
        i
      </button>
      {reportHref && (
        <Link
          href={reportHref}
          aria-label={`Open the ${label} report`}
          title="Open report"
          className="absolute right-10 top-2 flex h-6 w-6 items-center justify-center rounded-full border border-border text-text-faint hover:border-accent hover:text-accent"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.5 1.5" />
            <path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.5-1.5" />
          </svg>
        </Link>
      )}
      <div className={`${reportHref ? "pr-14" : "pr-6"} text-xs font-medium uppercase tracking-wide text-text-muted`}>{label}</div>
      <div className={`tabular mt-2 font-semibold text-text ${value.length > 10 ? "text-base" : value.length > 8 ? "text-xl" : "text-2xl"}`} style={{ fontFamily: "var(--apex-font-heading)" }}>
        {value}
      </div>
      <div className={`tabular mt-1 flex items-baseline gap-2 text-xs ${TONE_CLASS[tone]}`}>
        <span>{refValue ?? " "}</span>
        <span className="font-medium">{diff ?? ""}</span>
      </div>
    </div>
  );
}
