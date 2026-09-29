"use client";

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
}

export function MetricTile({ label, value, refValue, diff, tone, source, formula, onInfo }: TileProps) {
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
      <div className="pr-6 text-xs font-medium uppercase tracking-wide text-text-muted">{label}</div>
      <div className="tabular mt-2 text-2xl font-semibold text-text" style={{ fontFamily: "var(--apex-font-heading)" }}>
        {value}
      </div>
      <div className={`tabular mt-1 flex items-baseline gap-2 text-xs ${TONE_CLASS[tone]}`}>
        <span>{refValue ?? " "}</span>
        <span className="font-medium">{diff ?? ""}</span>
      </div>
    </div>
  );
}
