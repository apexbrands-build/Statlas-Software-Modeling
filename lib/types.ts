export type ChannelKey =
  | "google_nonbrand"
  | "google_brand"
  | "meta_acquisition"
  | "meta_returning"
  | "pinterest"
  | "pinterest_returning"
  | "youtube"
  | "youtube_returning"
  | "bing"
  | "bing_returning"
  | "applovin"
  | "applovin_returning"
  | "tiktok"
  | "tiktok_returning"
  | "snapchat"
  | "snapchat_returning";

export const CHANNEL_KEYS: ChannelKey[] = [
  "google_nonbrand",
  "google_brand",
  "meta_acquisition",
  "meta_returning",
  "pinterest",
  "pinterest_returning",
  "youtube",
  "youtube_returning",
  "bing",
  "bing_returning",
  "applovin",
  "applovin_returning",
  "tiktok",
  "tiktok_returning",
  "snapchat",
  "snapchat_returning",
];

export const CHANNEL_LABELS: Record<ChannelKey, string> = {
  google_nonbrand: "Google",
  google_brand: "Google Brand",
  meta_acquisition: "Meta",
  meta_returning: "Meta Returning",
  pinterest: "Pinterest",
  pinterest_returning: "Pinterest Returning",
  youtube: "YouTube",
  youtube_returning: "YouTube Returning",
  bing: "Bing",
  bing_returning: "Bing Returning",
  applovin: "AppLovin",
  applovin_returning: "AppLovin Returning",
  tiktok: "TikTok",
  tiktok_returning: "TikTok Returning",
  snapchat: "Snapchat",
  snapchat_returning: "Snapchat Returning",
};

export type Currency = "GBP" | "USD" | "EUR";

export interface Client {
  id: string;
  name: string;
  currency: Currency;
  timezone: string;
  podId: string;
}

export interface ChannelDay {
  spend: number;
  /** Revenue as reported by the ad platform (7-day click). */
  platformRevenue: number;
  platformPurchases: number;
}

/**
 * One row per client per day (mirrors the `metrics_daily` / `orders` rollups in the database).
 * Revenue definition: Order Revenue = net sales + shipping collected + tax, refunds NOT deducted.
 */
export interface DailyFact {
  clientId: string;
  date: string; // YYYY-MM-DD
  /** Gross sales (list price x quantity, before discounts, refunds, shipping and tax). */
  grossSales: number;
  /** Order discounts. */
  discounts: number;
  /** Net sales = gross sales - discounts - refunds (Shopify). Shipping and tax are not included. */
  netSales: number;
  shippingCollected: number;
  tax: number;
  newOrderRevenue: number;
  returningOrderRevenue: number;
  newOrders: number;
  returningOrders: number;
  /** Returns/refunds dated when they happened (Shopify "Returns"); already deducted from netSales. */
  refunds: number;
  /** From Shopify variant costs (only lines whose cost is known). */
  cogs: number;
  /** Net sales of lines whose product cost is unknown; the COGS fallback % applies to this. */
  cogsUnmappedSales: number;
  emailRevenue: number;
  emailCampaignRevenue: number;
  emailFlowRevenue: number;
  emailOrders: number;
  emailSent: number;
  channels: Record<ChannelKey, ChannelDay>;
}

/**
 * Store settings mirrored from the reference tool's Edit pop-up. Fields marked "applied" change the dashboard;
 * the rest are saved for when the matching feature is built (shown in the UI as "saved, not applied yet").
 */
export interface ExtraSettings {
  logoUrl: string;
  industry: string;
  weekStartDay: string;
  showIncrementalByDefault: boolean; // applied later
  fbClickWindow: string;
  /** Applied to the Meta sync: click window ("1 Day" | "7 Day" | "28 Day") and view window ("Disabled" | "1 Day" | "7 Day"). Separate from the old fbClickWindow/fbViewWindow keys, which held an unused placeholder default. */
  fbAttrClick: string;
  fbAttrView: string;
  fbViewWindow: string;
  fbClickType: string;
  fbExcludeOnsite: boolean;
  fbUseIncrementalDefault: boolean;
  googleRevenueTiming: string;
  pinterestAttribution: string;
  /** A campaign name containing this tag (as its own word, e.g. "NB") is never brand. */
  nonBrandTag: string;
  dontSeparateBrand: boolean;
  dontSeparateRetention: boolean;
  dontSeparateReactivation: boolean;
  excludeTestCampaigns: boolean;
  testKeyword: string;
  testStartsWith: string;
  testEndsWith: string;
  excludeTestFromRoas: boolean;
  cmReduceByAdSpend: boolean;
  cmIncludeShippingAsProfit: boolean;
  cogsAccrueReturnsByRate: boolean;
  dontUseShopifyCogs: boolean;
  giftCardMode: string;
  emailRevenueSource: "klaviyo" | "ga4";
  organicDefinition: string;
  churnAtRiskDays: number;
  churnDays: number;
  dio: number;
  dso: number;
  dpo: number;
  tiktokReferralFeePct: number;
  tiktokGmvSharePct: number;
  tiktokGmvCommissionPct: number;
}

export interface ClientSettings {
  clientId: string;
  /** Incrementality (iROAS) factors: platform-reported revenue x multiplier = incremental revenue. */
  /** Only channels with a factor set. A channel without a factor is treated as 1 (platform-reported). */
  multipliers: Partial<Record<ChannelKey, number>>;
  /** Cost of delivery / other variable costs (payment fees, packaging...) as % of Net Sales + Shipping. */
  otherVariablePct: number;
  /** Optional fulfilment cost per order, also part of cost of delivery. */
  deliveryCostPerOrder: number;
  /** COGS estimate (% of sales) for products with no cost per item. */
  cogsFallbackPct: number;
  /** When on, COGS = cogsFallbackPct of net sales for ALL sales, ignoring Shopify costs. */
  cogsFlatRate: boolean;
  excludedOrderTags: string[];
  extra: ExtraSettings;
  /** Monthly fixed costs. Not part of CM; reserved for the future P&L output. */
  monthlyFixedCosts: number;
  attributionWindow: "7d_click";
  revenueDefinition: "order_revenue";
  /** Google campaigns whose name contains this text are treated as Brand. */
  brandCampaignKeyword: string;
  excludeBrandFromAmer: boolean;
  excludeMetaReturningFromAmer: boolean;
  /** Shopify sales channels counted as DTC. */
  dtcChannels: string[];
}

export interface PlanVersion {
  id: string;
  clientId: string;
  name: string;
  isDefault: boolean;
  year: number;
  description: string;
  /** Day-of-week pattern shared by every month of the plan; null until first saved. */
  seasonality: PlanSeasonality | null;
  updatedAt: string | null;
  updatedBy: string | null;
}

/** Day-of-week pattern: offsets in % vs the average day (index 0 = Sunday), and how much of it to apply. */
export interface PlanSeasonality {
  dow: number[];
  effectPct: number;
}

/** One daily plan target row (mirrors `plan_targets`). */
export interface PlanTargetDay {
  planId: string;
  clientId: string;
  date: string;
  orderRevenue: number;
  newRevenue: number;
  returningRevenue: number;
  orders: number;
  newOrders: number;
  spend: number;
  cm: number;
  spendByChannel: Partial<Record<ChannelKey, number>>;
  /** P&L-level lines, filled by the forecasting layer (optional). */
  grossSales?: number;
  discounts?: number;
  shipping?: number;
  refunds?: number;
  tax?: number;
  cogs?: number;
  costOfDelivery?: number;
}

/** One campaign on one day (mirrors `ad_spend_daily`). */
export interface CampaignDay {
  date: string;
  /** meta | google_ads | pinterest | ... (as stored by the connectors) */
  platform: string;
  campaignId: string;
  campaignName: string;
  category: "acquisition" | "brand" | "retention" | "test";
  audience: "new" | "returning" | "unknown";
  spend: number;
  platformRevenue: number;
  platformPurchases: number;
}

export type Source = "Shopify" | "Platform-reported" | "Klaviyo" | "Derived" | "Settings";
