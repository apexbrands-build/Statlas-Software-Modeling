/** The five Creative Score metrics, from ad-level data (catalog ads already left out of `scoreAds` by the SQL). */
import { addDays, diffDays } from "../dates";
import type { MetricKey } from "./score";
import type { CreativeDay, CreativeHistory, LaunchedAd, ScoreAd } from "./types";

const spenders = (ads: ScoreAd[]) => ads.filter((a) => a.spend30 > 0);

/** Ads that spent in the window with zero attributed revenue / ads that spent. */
export function zeroRevenueRate(ads: ScoreAd[]): number | null {
  const s = spenders(ads);
  if (!s.length) return null;
  return s.filter((a) => !(a.revenue30 > 0)).length / s.length;
}

/** Ads with no spend in the window: shown apart, never in the zero-revenue denominator. */
export function undeliveredCount(ads: ScoreAd[]): number {
  return ads.filter((a) => !(a.spend30 > 0)).length;
}

/** Spend of the top 5 ads / total spend. */
export function adConcentration(ads: ScoreAd[]): number | null {
  const spend = spenders(ads)
    .map((a) => a.spend30)
    .sort((a, b) => b - a);
  const total = spend.reduce((s, x) => s + x, 0);
  if (!(total > 0)) return null;
  return spend.slice(0, 5).reduce((s, x) => s + x, 0) / total;
}

/** Spenders launched more than 30 days before `asOf` / spenders. */
export function evergreenShare(ads: ScoreAd[], asOf: string): number | null {
  const s = spenders(ads);
  if (!s.length) return null;
  return s.filter((a) => diffDays(a.launchDate, asOf) > 30).length / s.length;
}

/** Sum over the 3 week pairs of (next - prev), for ads with spend in both weeks, / sum of prev. */
export function spendDegradation(ads: ScoreAd[]): number | null {
  let change = 0;
  let base = 0;
  for (const a of ads) {
    for (let i = 0; i < 3; i++) {
      const prev = a.weeks[i];
      const next = a.weeks[i + 1];
      if (prev > 0 && next > 0) {
        change += next - prev;
        base += prev;
      }
    }
  }
  return base > 0 ? change / base : null;
}

/**
 * Batches = launch days of non-catalog ads between asOf - 89 and asOf - 7. Per batch: ROAS of days d..d+6 vs d-7..d-1, minus 1,
 * weighted by the batch's summed spend7. Batches with no spend before (or after), no revenue before, or zero weight are skipped.
 */
export function roasDegradation(days: CreativeDay[], ads: LaunchedAd[], asOf: string): number | null {
  const from = addDays(asOf, -89);
  const to = addDays(asOf, -7);
  const weights = new Map<string, number>();
  for (const a of ads) {
    if (a.isCatalog || a.launchDate < from || a.launchDate > to) continue;
    weights.set(a.launchDate, (weights.get(a.launchDate) ?? 0) + a.spend7);
  }
  const byDate = new Map(days.map((d) => [d.date, d]));
  const sum = (start: string, n: number) => {
    let spend = 0;
    let revenue = 0;
    for (let i = 0; i < n; i++) {
      const d = byDate.get(addDays(start, i));
      if (d) {
        spend += d.spend;
        revenue += d.revenue;
      }
    }
    return { spend, revenue };
  };
  let weighted = 0;
  let totalWeight = 0;
  for (const [d, w] of weights) {
    if (!(w > 0)) continue;
    const before = sum(addDays(d, -7), 7);
    const after = sum(d, 7);
    if (!(before.spend > 0) || !(after.spend > 0) || !(before.revenue > 0)) continue;
    const change = after.revenue / after.spend / (before.revenue / before.spend) - 1;
    weighted += change * w;
    totalWeight += w;
  }
  return totalWeight > 0 ? weighted / totalWeight : null;
}

export function scoreMetrics(h: CreativeHistory): Record<MetricKey, number | null> {
  return {
    zeroRevenue: zeroRevenueRate(h.scoreAds),
    concentration: adConcentration(h.scoreAds),
    roasDegradation: roasDegradation(h.days, h.ads, h.asOf),
    spendDegradation: spendDegradation(h.scoreAds),
    evergreenShare: evergreenShare(h.scoreAds, h.asOf),
  };
}
