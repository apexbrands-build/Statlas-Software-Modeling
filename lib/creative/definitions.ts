/**
 * The Creative Score's names and definitions, as the CTC Modeling page words them
 * (https://commonthreadco.com/pages/methodology-modeling, section 05; saved in Agency/Training/CTC Canon/source-methodology-modeling.md).
 * `meaning` is the page's sentence. `window` is what Apex Analytics actually measures: the page gives no time windows, so these are ours.
 */
import type { MetricKey } from "./score";

export const SCORE_DEFINITIONS: Record<MetricKey, { name: string; meaning: string; window: string }> = {
  zeroRevenue: {
    name: "Zero Revenue Rate",
    meaning: "The percentage of active ads that never converted. High values mean many ads are not working.",
    window: "Measured over the last 30 days: ads that spent but have no revenue reported on them, out of all ads that spent. Ads that never spent are counted apart, not here.",
  },
  concentration: {
    name: "Ad Concentration",
    meaning: "The percentage of total spend in the top 5 ads. High values mean over-reliance on a few ads, creating fatigue risk.",
    window: "Measured over the last 30 days of spend.",
  },
  roasDegradation: {
    name: "ROAS Degradation",
    meaning: "The change in efficiency after initial launch week. Negative values mean ads are losing effectiveness quickly.",
    window: "For each batch of ads launched on the same day (launches of the last 90 days): account ROAS in the 7 days from launch against the 7 days before, weighted by the batch's first-week spend.",
  },
  spendDegradation: {
    name: "Spend Degradation",
    meaning: "The change in spend after initial launch week. Negative values signal rapid fatigue.",
    window: "Week-over-week change in spend of ads that spent in both weeks, over the last 4 weeks (3 week pairs).",
  },
  evergreenShare: {
    name: "Evergreen Share",
    meaning: "The percentage of ads running consistently for 30+ days. Higher evergreen share means more stable performance and lower creative demand.",
    window: "Ads that spent in the last 30 days and were launched more than 30 days ago, out of all ads that spent. Counts ads, not spend.",
  },
};
