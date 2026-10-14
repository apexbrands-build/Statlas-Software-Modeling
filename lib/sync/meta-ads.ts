import "server-only";
import { pickPurchase, type Action } from "./meta";

export type AdFormat = "video" | "image" | "carousel" | "other";

export interface AdCreative {
  object_type?: string;
  video_id?: string;
  asset_feed_spec?: { videos?: unknown[]; images?: unknown[] };
  object_story_spec?: { video_data?: unknown; photo_data?: unknown; link_data?: { child_attachments?: unknown[]; image_hash?: string; picture?: string; video_id?: string } };
}

/** An ad as the Graph API returns it from `{account}/ads`. */
export interface AdRow {
  id: string;
  name?: string;
  adset_id?: string;
  campaign?: { id?: string; name?: string };
  effective_status?: string;
  created_time?: string;
  creative?: AdCreative | null;
}

/** One ad on one day as the Graph API returns it from insights at ad level. */
export interface AdInsightRow {
  ad_id: string;
  ad_name?: string;
  adset_id?: string;
  campaign_id?: string;
  campaign_name?: string;
  date_start: string;
  spend?: string;
  impressions?: string;
  clicks?: string;
  actions?: Action[];
  action_values?: Action[];
}

/** Video, image or carousel from the ad's creative; anything unknown, empty or missing is "other" (never dropped). */
export function adFormat(c: AdCreative | null | undefined): AdFormat {
  if (!c) return "other";
  const story = c.object_story_spec;
  const feed = c.asset_feed_spec;
  if (c.object_type === "VIDEO" || c.video_id || story?.video_data || story?.link_data?.video_id || (feed?.videos?.length ?? 0) > 0) return "video";
  if ((story?.link_data?.child_attachments?.length ?? 0) > 1 || (feed?.images?.length ?? 0) > 1) return "carousel";
  if (c.object_type === "PHOTO" || story?.photo_data || story?.link_data?.image_hash || story?.link_data?.picture || (feed?.images?.length ?? 0) === 1) return "image";
  return "other";
}

/** True when the campaign name contains one of the comma separated keywords (any case); an empty keyword list flags nothing. */
export function isCatalogCampaign(name: string | null | undefined, keywords: string): boolean {
  if (!name) return false;
  const words = keywords
    .split(",")
    .map((k) => k.trim().toLowerCase())
    .filter(Boolean);
  const n = name.toLowerCase();
  return words.some((w) => n.includes(w));
}

const num = (v: string | undefined) => Number(v ?? 0) || 0;

/** A `meta_ad_daily` row. Purchases and revenue use the same purchase-type preference and attribution windows as the campaign sync. */
export function mapAdDay(r: AdInsightRow, windows: string[], clientId: string) {
  return {
    client_id: clientId,
    ad_id: r.ad_id,
    date: r.date_start,
    spend: num(r.spend),
    impressions: num(r.impressions),
    clicks: num(r.clicks),
    purchases: pickPurchase(r.actions, windows),
    revenue: pickPurchase(r.action_values, windows),
  };
}

/** A `meta_ads` row. */
export function mapAd(ad: AdRow, clientId: string, keywords: string) {
  return {
    client_id: clientId,
    ad_id: ad.id,
    name: ad.name ?? null,
    campaign_id: ad.campaign?.id ?? null,
    campaign_name: ad.campaign?.name ?? null,
    adset_id: ad.adset_id ?? null,
    created_at: ad.created_time ?? null,
    format: adFormat(ad.creative),
    is_catalog: isCatalogCampaign(ad.campaign?.name, keywords),
    status: ad.effective_status ?? null,
    updated_at: new Date().toISOString(),
  };
}
