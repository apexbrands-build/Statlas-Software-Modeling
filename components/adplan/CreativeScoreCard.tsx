"use client";

import { formatValue } from "@/lib/format";
import type { creativeScore, MetricKey } from "@/lib/creative/score";
import { METRIC_KEYS, scoreLabel } from "@/lib/creative/score";
import type { CreativeHistory } from "@/lib/creative/types";
import type { Currency } from "@/lib/types";
import { undeliveredCount } from "@/lib/creative/metrics";
import { SCORE_DEFINITIONS } from "@/lib/creative/definitions";

const TONE = { Poor: "text-bad", Average: "text-text", Great: "text-good" } as const;

/** The Creative Score: overall 0 to 100, the Poor / Average / Great scale and the five metrics behind it. */
export function CreativeScoreCard({ history, score, metrics, currency, loadError = null }: { history: CreativeHistory | null; score: ReturnType<typeof creativeScore> | null; metrics: Record<MetricKey, number | null> | null; currency: Currency; loadError?: string | null }) {
  if (loadError) {
    return (
      <div className="rounded-xl border border-border bg-surface p-4">
        <h3 className="text-sm font-semibold">Creative Score</h3>
        <p className="mt-2 text-sm text-bad">The ad history could not be loaded ({loadError}). Reload the page; if it keeps failing, the database functions of migration 0013 may be missing.</p>
      </div>
    );
  }
  if (!history || !score || !metrics || history.scoreAds.length === 0) {
    const hasHistory = Boolean(history && (history.months.length > 0 || history.ads.length > 0));
    return (
      <div className="rounded-xl border border-border bg-surface p-4">
        <h3 className="text-sm font-semibold">Creative Score</h3>
        <p className="mt-2 text-sm text-text-muted">
          {hasHistory
            ? "No Meta ad spent in the last 30 days, so there is nothing to score yet. The demand model still works from the campaign totals."
            : "No ad history yet. The score appears once this client's Meta ads have spend: run a Meta history sync in Store Settings. The demand model still works from the campaign totals and the Canon defaults."}
        </p>
      </div>
    );
  }
  const label = score.score === null ? null : scoreLabel(score.score);
  const undelivered = undeliveredCount(history.scoreAds);
  const spenders = history.scoreAds.filter((a) => a.spend30 > 0);
  const spenderCount = spenders.length;
  const zeroCount = spenders.filter((a) => !(a.revenue30 > 0)).length;
  const pct = (v: number | null) => (v === null ? "–" : formatValue(v, "percent1", currency));
  return (
    <div className="space-y-3 rounded-xl border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold">Creative Score</h3>
        {score.mode === "provisional" && (
          <span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-text-muted" title="The bands are calibrated to the reference slide. They become percentiles of this agency's clients once ten clients have 90 days of ad data.">
            provisional
          </span>
        )}
      </div>
      <div className="flex items-end gap-3">
        <span className={`tabular text-5xl font-semibold ${label ? TONE[label] : ""}`} aria-label="Creative Score">
          {score.score ?? "–"}
        </span>
        {label && <span className={`pb-1 text-sm font-medium ${TONE[label]}`}>{label}</span>}
      </div>
      <div className="relative h-2 rounded-full bg-bg" aria-hidden>
        <div className="absolute inset-y-0 left-0 rounded-l-full bg-bad/40" style={{ width: "50%" }} />
        <div className="absolute inset-y-0 bg-text-faint/40" style={{ left: "50%", width: "25%" }} />
        <div className="absolute inset-y-0 right-0 rounded-r-full bg-good/40" style={{ width: "25%" }} />
        {score.score !== null && <div className="absolute -top-1 h-4 w-1 rounded bg-text" style={{ left: `calc(${Math.min(100, Math.max(0, score.score))}% - 2px)` }} />}
      </div>
      <p className="flex justify-between text-[10px] text-text-faint">
        <span>Poor under 50</span>
        <span>Average 50 to 74</span>
        <span>Great 75+</span>
      </p>
      <ul className="space-y-2">
        {METRIC_KEYS.map((k) => {
          const part = score.parts[k];
          return (
            <li key={k} className="group relative text-sm">
              <div className="flex items-baseline justify-between gap-2">
                <button type="button" className="cursor-help border-b border-dotted border-text-faint text-left text-text-muted outline-none focus-visible:text-text" aria-describedby={`tip-${k}`}>
                  {SCORE_DEFINITIONS[k].name}
                </button>
                <span className="tabular">
                  {pct(metrics[k])} <span className="text-text-faint">· {part ?? "–"}/100</span>
                </span>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-bg">
                <div className="h-full rounded-full bg-accent" style={{ width: `${part ?? 0}%` }} />
              </div>
              <div id={`tip-${k}`} role="tooltip" className="pointer-events-none invisible absolute left-0 top-full z-20 mt-1 w-72 rounded-lg border border-border bg-bg p-3 text-xs leading-snug text-text opacity-0 shadow-lg transition-opacity group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100">
                <p>{SCORE_DEFINITIONS[k].meaning}</p>
                <p className="mt-1.5 text-text-muted">{SCORE_DEFINITIONS[k].window}</p>
              </div>
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-text-muted">
        {zeroCount} of {spenderCount} ad{spenderCount === 1 ? "" : "s"} that spent in the last 30 days had no revenue reported on {zeroCount === 1 ? "it" : "them"} (Zero Revenue Rate).
        {undelivered > 0 && ` ${undelivered} more ad${undelivered === 1 ? "" : "s"} never spent and ${undelivered === 1 ? "is" : "are"} not counted.`}
      </p>
    </div>
  );
}
