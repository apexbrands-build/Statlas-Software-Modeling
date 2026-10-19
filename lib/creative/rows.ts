/** Database rows of the creative read functions (migration 0013) as the app's shapes. Numbers arrive as strings or null; dates may carry a time. */
import { AD_FORMATS, type AdFormat, type CreativeDay, type LaunchedAd, type MonthAgg, type ScoreAd } from "./types";

type Row = Record<string, unknown>;

const num = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};
const date = (v: unknown): string => String(v ?? "").slice(0, 10);
const format = (v: unknown): AdFormat => (AD_FORMATS.includes(v as AdFormat) ? (v as AdFormat) : "other");
const launched = (r: Row): Record<AdFormat, number> => ({ video: num(r.launched_video), image: num(r.launched_image), carousel: num(r.launched_carousel), other: num(r.launched_other) });

export function mapLaunchedAd(r: Row): LaunchedAd {
  return {
    adId: String(r.ad_id),
    name: r.name ? String(r.name) : String(r.ad_id),
    format: format(r.format),
    isCatalog: Boolean(r.is_catalog),
    launchDate: date(r.launch_date),
    spend7: num(r.spend_7d),
    spend30: num(r.spend_30d),
    revenue30: num(r.revenue_30d),
    spendTotal: num(r.spend_total),
    revenueTotal: num(r.revenue_total),
  };
}

export function mapMonthAgg(r: Row): MonthAgg {
  return { month: date(r.month), spend: num(r.spend), catalogSpend: num(r.catalog_spend), carriedSpend: num(r.carried_spend), launched: launched(r) };
}

export function mapCreativeDay(r: Row): CreativeDay {
  return { date: date(r.date), spend: num(r.spend), revenue: num(r.revenue), catalogSpend: num(r.catalog_spend), launched: launched(r) };
}

export function mapScoreAd(r: Row): ScoreAd {
  return { adId: String(r.ad_id), launchDate: date(r.launch_date), spend30: num(r.spend_30), revenue30: num(r.revenue_30), weeks: [num(r.w1), num(r.w2), num(r.w3), num(r.w4)] };
}
