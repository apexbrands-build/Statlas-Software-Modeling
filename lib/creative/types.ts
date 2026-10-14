/**
 * Ad-level shapes for the Creative Score and the Creative Demand model.
 * Dates are YYYY-MM-DD; months are YYYY-MM-01 (same key as PlanMonth.month).
 * `spend` / `revenue` on days and months are non-catalog (the SQL leaves catalog ads out unless a column says catalog);
 * `catalogSpend` is the catalog part, so total Meta spend = spend + catalogSpend.
 */

export type AdFormat = "video" | "image" | "carousel" | "other";

export const AD_FORMATS: AdFormat[] = ["video", "image", "carousel", "other"];

export interface LaunchedAd {
  adId: string;
  name: string;
  format: AdFormat;
  isCatalog: boolean;
  launchDate: string;
  spend7: number;
  spend30: number;
  revenue30: number;
  spendTotal: number;
  revenueTotal: number;
}

export interface ScoreAd {
  adId: string;
  launchDate: string;
  spend30: number;
  revenue30: number;
  /** Four 7-day weeks, oldest first; the last week ends on `asOf`. */
  weeks: [number, number, number, number];
}

export interface CreativeDay {
  date: string;
  spend: number;
  revenue: number;
  catalogSpend: number;
  launched: Record<AdFormat, number>;
}

export interface MonthAgg {
  month: string;
  spend: number;
  catalogSpend: number;
  /** Non-catalog spend in the month on ads launched before its first day. */
  carriedSpend: number;
  launched: Record<AdFormat, number>;
}

export interface CreativeHistory {
  asOf: string;
  months: MonthAgg[];
  ads: LaunchedAd[];
  days: CreativeDay[];
  scoreAds: ScoreAd[];
}

export const zeroLaunched = (): Record<AdFormat, number> => ({ video: 0, image: 0, carousel: 0, other: 0 });
