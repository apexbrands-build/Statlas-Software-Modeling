/** Shared fixtures for the creative tests (Tasks 2 to 5). Not used by the app. */
import { eachDay } from "../dates";
import { zeroLaunched, type AdFormat, type CreativeDay, type CreativeHistory, type LaunchedAd, type MonthAgg, type ScoreAd } from "./types";

export const FIXTURE_AS_OF = "2026-09-30";

export function scoreAd(adId: string, launchDate: string, spend30: number, revenue30: number, weeks: [number, number, number, number] = [0, 0, 0, 0]): ScoreAd {
  return { adId, launchDate, spend30, revenue30, weeks };
}

export function launchedAd(p: Partial<LaunchedAd> & { adId: string; launchDate: string }): LaunchedAd {
  return {
    name: p.adId,
    format: "image",
    isCatalog: false,
    spend7: 0,
    spend30: 0,
    revenue30: 0,
    spendTotal: 0,
    revenueTotal: 0,
    ...p,
  };
}

export function day(date: string, spend: number, revenue: number, catalogSpend = 0): CreativeDay {
  return { date, spend, revenue, catalogSpend, launched: zeroLaunched() };
}

/** One CreativeDay per date from..to with the same spend and revenue. */
export function flatDays(from: string, to: string, spend: number, revenue: number): CreativeDay[] {
  return eachDay(from, to).map((d) => day(d, spend, revenue));
}

export function monthAgg(month: string, spend: number, carriedSpend: number, catalogSpend = 0, launched: Partial<Record<AdFormat, number>> = {}): MonthAgg {
  return { month, spend, catalogSpend, carriedSpend, launched: { ...zeroLaunched(), ...launched } };
}

/**
 * Ten score ads at 2026-09-30: 8 spenders (3 with zero revenue) and 2 that never delivered.
 * Spend: 500, 400, 300, 200, 100, 50, 30, 20 (total 1,600; top 5 = 1,500).
 * Launch dates: four spenders launched more than 30 days before asOf (evergreen), four within 30 days.
 */
export const FIXTURE_SCORE_ADS: ScoreAd[] = [
  scoreAd("a1", "2026-05-01", 500, 1500, [100, 80, 60, 60]),
  scoreAd("a2", "2026-06-15", 400, 900),
  scoreAd("a3", "2026-08-01", 300, 0),
  scoreAd("a4", "2026-08-30", 200, 400),
  scoreAd("a5", "2026-08-31", 100, 0),
  scoreAd("a6", "2026-09-10", 50, 120),
  scoreAd("a7", "2026-09-20", 30, 0),
  scoreAd("a8", "2026-09-25", 20, 60, [0, 0, 0, 20]),
  scoreAd("a9", "2026-09-26", 0, 0),
  scoreAd("a10", "2026-09-28", 0, 0),
];

/**
 * Two launch batches for ROAS degradation:
 * 2026-09-10 (spend7 100): ROAS 3.0 the week before, 2.4 the week after (-0.2);
 * 2026-08-10 (spend7 300, weight 3x): ROAS 2.0 before, 1.8 after (-0.1). Weighted: -0.125.
 * Plus ads that must be ignored: a catalog launch, one too recent, one too old, one with no spend before it.
 */
export const FIXTURE_DAYS: CreativeDay[] = [
  ...flatDays("2026-08-03", "2026-08-09", 100, 200),
  ...flatDays("2026-08-10", "2026-08-16", 100, 180),
  ...flatDays("2026-09-03", "2026-09-09", 100, 300),
  ...flatDays("2026-09-10", "2026-09-16", 100, 240),
  // catalog batch on 2026-07-20 would read +100% if it counted
  ...flatDays("2026-07-13", "2026-07-19", 100, 100),
  ...flatDays("2026-07-20", "2026-07-26", 100, 200),
];

export const FIXTURE_ADS: LaunchedAd[] = [
  launchedAd({ adId: "b1", launchDate: "2026-09-10", format: "video", spend7: 100 }),
  launchedAd({ adId: "b2", launchDate: "2026-08-10", format: "image", spend7: 200 }),
  launchedAd({ adId: "b3", launchDate: "2026-08-10", format: "carousel", spend7: 100 }),
  launchedAd({ adId: "cat", launchDate: "2026-07-20", isCatalog: true, spend7: 1000 }),
  launchedAd({ adId: "recent", launchDate: "2026-09-25", spend7: 500 }),
  launchedAd({ adId: "old", launchDate: "2026-06-01", spend7: 500 }),
  // no days before 2026-06-20 in FIXTURE_DAYS: skipped
  launchedAd({ adId: "nobefore", launchDate: "2026-07-05", spend7: 500 }),
];

export const FIXTURE_HISTORY: CreativeHistory = {
  asOf: FIXTURE_AS_OF,
  months: [],
  ads: FIXTURE_ADS,
  days: FIXTURE_DAYS,
  scoreAds: FIXTURE_SCORE_ADS,
};

export const EMPTY_HISTORY: CreativeHistory = { asOf: FIXTURE_AS_OF, months: [], ads: [], days: [], scoreAds: [] };
