"use client";

import { formatValue } from "@/lib/format";
import type { creativeScore, MetricKey } from "@/lib/creative/score";
import { METRIC_KEYS, scoreLabel } from "@/lib/creative/score";
import type { CreativeHistory } from "@/lib/creative/types";
import type { Currency } from "@/lib/types";
import { undeliveredCount } from "@/lib/creative/metrics";

const LABEL: Record<MetricKey, { name: string; hint: string }> = {
  zeroRevenue: { name: "Ads that spent with no revenue", hint: "Share of ads with spend in the last 30 days that brought no attributed revenue. Lower is better." },
  concentration: { name: "Top 5 ads' share of spend", hint: "How much of the last 30 days' spend sits in the five biggest ads. Lower means more ads are carrying the account." },
  roasDegradation: { name: "ROAS after a launch", hint: "How a batch of ads' ROAS in its first week compares with the week before the launch, weighted by spend. Higher is better." },
  spendDegradation: { name: "Spend over four weeks", hint: "How ads' weekly spend changes over the last four weeks. Spend that holds or grows scores higher." },
  evergreenShare: { name: "Spend on ads older than 30 days", hint: "Share of spend on ads launched more than 30 days ago: proven ads still carrying the account." },
};

const TONE = { Poor: "text-bad", Average: "text-text", Great: "text-good" } as const;

/** The Creative Score: overall 0 to 100, the Poor / Average / Great scale and the five metrics behind it. */
export function CreativeScoreCard({ history, score, metrics, currency }: { history: CreativeHistory | null; score: ReturnType<typeof creativeScore> | null; metrics: Record<MetricKey, number | null> | null; currency: Currency }) {
  if (!history || !score || !metrics || history.scoreAds.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-surface p-4">
        <h3 className="text-sm font-semibold">Creative Score</h3>
        <p className="mt-2 text-sm text-text-muted">No ad history yet. The score appears once this client&apos;s Meta ads have spend: run a Meta history sync in Store Settings. The demand model still works with the Canon defaults.</p>
      </div>
    );
  }
  const label = score.score === null ? null : scoreLabel(score.score);
  const undelivered = undeliveredCount(history.scoreAds);
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
            <li key={k} className="text-sm" title={LABEL[k].hint}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-text-muted">{LABEL[k].name}</span>
                <span className="tabular">
                  {pct(metrics[k])} <span className="text-text-faint">· {part ?? "–"}/100</span>
                </span>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-bg">
                <div className="h-full rounded-full bg-accent" style={{ width: `${part ?? 0}%` }} />
              </div>
            </li>
          );
        })}
      </ul>
      {undelivered > 0 && <p className="text-xs text-text-muted">{undelivered} launched ad{undelivered === 1 ? "" : "s"} never delivered.</p>}
    </div>
  );
}
