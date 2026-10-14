"use client";

import { formatValue } from "@/lib/format";
import type { creativeScore, MetricKey } from "@/lib/creative/score";
import { METRIC_KEYS, scoreLabel } from "@/lib/creative/score";
import type { CreativeHistory } from "@/lib/creative/types";
import type { Currency } from "@/lib/types";

const LABEL: Record<MetricKey, { name: string; hint: string }> = {
  zeroSpend: { name: "Active ads with no spend", hint: "Share of the ads running right now that got no spend in the last 30 days: ads without budget behind them. Lower is better." },
  concentration: { name: "Top 5 ads' share of spend", hint: "How much of the last 30 days' spend sits in the five biggest ads. Lower means more ads are carrying the account." },
  roasDegradation: { name: "ROAS after a launch", hint: "How a batch of ads' ROAS in its first week compares with the week before the launch, weighted by spend. Higher is better." },
  spendDegradation: { name: "Spend over four weeks", hint: "How ads' weekly spend changes over the last four weeks. Spend that holds or grows scores higher." },
  evergreenShare: { name: "Ads older than 30 days still spending", hint: "Share of the ads that spent in the last 30 days that were launched more than 30 days ago: proven ads still carrying the account." },
};

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
  const idle = history.activeAds.filter((a) => !(a.spend30 > 0)).length;
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
      {history.activeAds.length > 0 && (
        <p className="text-xs text-text-muted">
          {idle} of {history.activeAds.length} active ad{history.activeAds.length === 1 ? "" : "s"} had no spend in the last 30 days.
        </p>
      )}
    </div>
  );
}
