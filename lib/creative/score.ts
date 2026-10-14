/**
 * Creative Score: five ad-level metrics, each scored 0 to 100, averaged with equal weights.
 *
 * Bands are provisional (recalibrated 2026-10-14 to the strategist's reference slide): linear between anchors,
 * clamped outside. Improvements are graded, not flat (more ROAS or spend after a launch scores higher).
 * Once at least PERCENTILE_MIN_CLIENTS portfolio values exist for every metric, each part becomes a percentile.
 */

export type MetricKey = "zeroRevenue" | "concentration" | "roasDegradation" | "spendDegradation" | "evergreenShare";

export const METRIC_KEYS: MetricKey[] = ["zeroRevenue", "concentration", "roasDegradation", "spendDegradation", "evergreenShare"];

/** Anchors as [value (fraction), score], sorted by value. */
export const BANDS: Record<MetricKey, [value: number, score: number][]> = {
  zeroRevenue: [
    [0.25, 100],
    [0.37, 90],
    [0.7, 0],
  ],
  concentration: [
    [0.15, 100],
    [0.42, 0],
  ],
  roasDegradation: [
    [-0.15, 0],
    [-0.12, 18],
    [0, 80],
    [0.1, 100],
  ],
  spendDegradation: [
    [-1.0, 0],
    [-0.34, 80],
    [0, 90],
    [0.2, 100],
  ],
  evergreenShare: [
    [0, 0],
    [0.33, 76],
    [0.5, 100],
  ],
};

/** Which way is better when ranking against the portfolio (degradations are graded, so higher is better). */
export const DIRECTION: Record<MetricKey, "lower" | "higher" | "closerToZero"> = {
  zeroRevenue: "lower",
  concentration: "lower",
  roasDegradation: "higher",
  spendDegradation: "higher",
  evergreenShare: "higher",
};

export const PERCENTILE_MIN_CLIENTS = 10;

function interpolate(anchors: [number, number][], value: number): number {
  const first = anchors[0];
  const last = anchors[anchors.length - 1];
  if (value <= first[0]) return first[1];
  if (value >= last[0]) return last[1];
  for (let i = 1; i < anchors.length; i++) {
    const [x1, y1] = anchors[i];
    if (value <= x1) {
      const [x0, y0] = anchors[i - 1];
      return y0 + ((value - x0) / (x1 - x0)) * (y1 - y0);
    }
  }
  return last[1];
}

export function bandScore(key: MetricKey, value: number | null): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.round(interpolate(BANDS[key], value));
}

/** Share (0 to 100) of portfolio values this one beats; ties count half. An empty portfolio gives 50. */
export function percentileScore(value: number, portfolio: number[], direction: "lower" | "higher" | "closerToZero"): number {
  if (!portfolio.length) return 50;
  const key = (x: number) => (direction === "lower" ? -x : direction === "higher" ? x : -Math.abs(x));
  const v = key(value);
  let wins = 0;
  for (const p of portfolio) {
    const k = key(p);
    if (v > k) wins += 1;
    else if (v === k) wins += 0.5;
  }
  return (wins / portfolio.length) * 100;
}

export function creativeScore(
  metrics: Record<MetricKey, number | null>,
  portfolio?: Partial<Record<MetricKey, number[]>> | null,
): { score: number | null; parts: Record<MetricKey, number | null>; mode: "provisional" | "percentile" } {
  const usePercentile = !!portfolio && METRIC_KEYS.every((k) => (portfolio[k]?.length ?? 0) >= PERCENTILE_MIN_CLIENTS);
  const parts = {} as Record<MetricKey, number | null>;
  for (const k of METRIC_KEYS) {
    const v = metrics[k];
    if (v == null || !Number.isFinite(v)) parts[k] = null;
    else parts[k] = usePercentile ? Math.round(percentileScore(v, portfolio![k]!, DIRECTION[k])) : bandScore(k, v);
  }
  const vals = METRIC_KEYS.map((k) => parts[k]).filter((x): x is number => x != null);
  const score = vals.length ? Math.round(vals.reduce((s, x) => s + x, 0) / vals.length) : null;
  return { score, parts, mode: usePercentile ? "percentile" : "provisional" };
}

/** Under 50 Poor (the account needs more new ads), 50 to 74 Average, 75 and up Great. */
export function scoreLabel(score: number): "Poor" | "Average" | "Great" {
  if (score < 50) return "Poor";
  if (score < 75) return "Average";
  return "Great";
}
