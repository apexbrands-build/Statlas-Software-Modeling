import type { CreativeMonth } from "../creative/plan";
import type { ChannelKey } from "../types";

/** A platform in the plan's spend split. `alt` is the Brand (Google) or non-acquisition / returning (others) share. */
export interface PlanPlatform {
  key: string;
  label: string;
  main: ChannelKey;
  alt: ChannelKey;
  altLabel: string;
}

export const PLAN_PLATFORMS: PlanPlatform[] = [
  { key: "google", label: "Google", main: "google_nonbrand", alt: "google_brand", altLabel: "Brand" },
  { key: "meta", label: "Facebook / Meta", main: "meta_acquisition", alt: "meta_returning", altLabel: "Non-acquisition" },
  { key: "pinterest", label: "Pinterest", main: "pinterest", alt: "pinterest_returning", altLabel: "Non-acquisition" },
  { key: "youtube", label: "YouTube", main: "youtube", alt: "youtube_returning", altLabel: "Non-acquisition" },
  { key: "bing", label: "Bing", main: "bing", alt: "bing_returning", altLabel: "Non-acquisition" },
  { key: "tiktok", label: "TikTok", main: "tiktok", alt: "tiktok_returning", altLabel: "Non-acquisition" },
  { key: "snapchat", label: "Snapchat", main: "snapchat", alt: "snapchat_returning", altLabel: "Non-acquisition" },
  { key: "applovin", label: "AppLovin", main: "applovin", alt: "applovin_returning", altLabel: "Non-acquisition" },
];

/** Rates that turn order revenue into the P&L. All percentages are 0-100. */
export interface PlanRates {
  /** Discounts as % of gross sales. */
  discountPct: number;
  /** Shipping charged as % of (gross - discounts). */
  shippingPct: number;
  /** Tax as % of (gross - discounts). */
  taxPct: number;
  /** Refunds as % of (gross - discounts). */
  refundPct: number;
  /** COGS as % of net sales. */
  cogsPct: number;
  /** Other variable costs (cost of delivery) as % of net sales + shipping. */
  otherVarPct: number;
  newAov: number;
  returningAov: number;
}

export interface DayOverride {
  spend?: number;
  newRevenue?: number;
  returningRevenue?: number;
}

/** What the strategist decides for one month; everything else is derived. */
export interface PlanMonthInputs {
  /** Total ad spend for the month. */
  spend: number;
  /** New order revenue / acquisition spend (same definition as the dashboard aMER). */
  amer: number;
  /** Returning order revenue the plan uses: the override if set, else the Returning Customer Model, else typed. */
  returningRevenue: number;
  /** What the Returning Customer Model produced for this month (kept so the override can be compared and undone). */
  returningModel?: number;
  /** Strategist's own number (e.g. a subscription launch); beats the model while set. */
  returningOverride?: number | null;
  /** % of spend per platform key (sums to 100). */
  platformPct: Record<string, number>;
  /** Brand (Google) / non-acquisition (others) share of each platform's spend, %. */
  altPct: Record<string, number>;
  lockedPlatforms?: string[];
  rates: PlanRates;
  /** Fixed costs (SG&A) for the month. Only used in the Plan P&L, never in CM. Falls back to the client's setting. */
  fixedCosts?: number;
  /** Fixed daily values (a locked day keeps them; the rest of the month absorbs the difference). */
  overrides?: Record<string, DayOverride>;
  /** Platform ROAS targets the strategist typed for this month, per channel. Absent = the suggested value (aMER / incrementality factor). */
  roas?: Partial<Record<ChannelKey, number>>;
  /** The Creative Demand model's result for this month (new ads needed, moments and evergreen, video and image). Does not change any target. */
  creative?: CreativeMonth;
  source?: "manual" | "last_year" | "recent" | "actuals";
}

export type MonthStatus = "in_progress" | "final";

export interface PlanMonth {
  /** First day of the month, YYYY-MM-01. */
  month: string;
  inputs: PlanMonthInputs | null;
  status: MonthStatus;
  locked: boolean;
}

export interface PlanChange {
  at: string;
  by: string;
  summary: string;
}

export const ZERO_RATES: PlanRates = { discountPct: 0, shippingPct: 0, taxPct: 0, refundPct: 0, cogsPct: 0, otherVarPct: 0, newAov: 0, returningAov: 0 };

export function blankInputs(): PlanMonthInputs {
  return { spend: 0, amer: 0, returningRevenue: 0, platformPct: {}, altPct: {}, rates: { ...ZERO_RATES }, source: "manual" };
}
