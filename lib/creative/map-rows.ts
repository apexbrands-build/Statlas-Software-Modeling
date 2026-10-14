/** Database rows of the Best Creatives functions (migration 0014) as the app's shapes. */
import type { AdAgg, FormatTotals } from "./best-creatives";
import { AD_FORMATS, type AdFormat } from "./types";

type Row = Record<string, unknown>;

const num = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};
const format = (v: unknown): AdFormat => (AD_FORMATS.includes(v as AdFormat) ? (v as AdFormat) : "other");
const date = (v: unknown): string | null => (v ? String(v).slice(0, 10) : null);

export function mapAdRow(r: Row): AdAgg {
  return {
    adId: String(r.ad_id),
    name: r.name ? String(r.name) : String(r.ad_id),
    campaignName: r.campaign_name ? String(r.campaign_name) : null,
    format: format(r.format),
    isCatalog: Boolean(r.is_catalog),
    status: r.status ? String(r.status) : null,
    launched: date(r.launched),
    firstSpend: date(r.first_spend) ?? "",
    lastSpend: date(r.last_spend) ?? "",
    activeDays: num(r.active_days),
    spend: num(r.spend),
    revenue: num(r.revenue),
    purchases: num(r.purchases),
    impressions: num(r.impressions),
    clicks: num(r.clicks),
    cur: { spend: num(r.cur_spend), revenue: num(r.cur_revenue) },
    prev: { spend: num(r.prev_spend), revenue: num(r.prev_revenue) },
  };
}

export function mapFormatRow(r: Row): FormatTotals {
  return {
    format: format(r.format),
    ads: num(r.ads),
    spend: num(r.spend),
    revenue: num(r.revenue),
    purchases: num(r.purchases),
    impressions: num(r.impressions),
    clicks: num(r.clicks),
    cur: { spend: num(r.cur_spend), revenue: num(r.cur_revenue) },
    prev: { spend: num(r.prev_spend), revenue: num(r.prev_revenue) },
  };
}

/** True when the read function or the ad tables are not there yet (the page says so); a timeout or any other error is real and is shown. */
export function isMissingFunction(err: { code?: string; message?: string }): boolean {
  if (err.code && ["PGRST202", "PGRST205", "42883", "42P01"].includes(err.code)) return true;
  return /creative_ads_report|creative_format_totals|meta_ad_daily|meta_ads/.test(err.message ?? "");
}
