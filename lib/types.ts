export type ChannelKey =
  | "google_nonbrand"
  | "google_brand"
  | "meta_acquisition"
  | "meta_returning"
  | "pinterest";

export const CHANNEL_KEYS: ChannelKey[] = [
  "google_nonbrand",
  "google_brand",
  "meta_acquisition",
  "meta_returning",
  "pinterest",
];

export const CHANNEL_LABELS: Record<ChannelKey, string> = {
  google_nonbrand: "Google",
  google_brand: "Google Brand",
  meta_acquisition: "Meta",
  meta_returning: "Meta Returning",
  pinterest: "Pinterest",
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
  /** Gross sales minus discounts (Shopify). */
  netSales: number;
  shippingCollected: number;
  tax: number;
  newOrderRevenue: number;
  returningOrderRevenue: number;
  newOrders: number;
  returningOrders: number;
  refunds: number;
  /** From Shopify variant costs. */
  cogs: number;
  emailRevenue: number;
  emailCampaignRevenue: number;
  emailFlowRevenue: number;
  emailOrders: number;
  emailSent: number;
  channels: Record<ChannelKey, ChannelDay>;
}

export interface ClientSettings {
  clientId: string;
  /** Incrementality (iROAS) factors: platform-reported revenue x multiplier = incremental revenue. */
  multipliers: Record<ChannelKey, number>;
  /** Other variable costs (payment fees, packaging...) as % of net sales. */
  otherVariablePct: number;
  /** Fulfilment/shipping cost paid by the brand, per order. */
  shippingCostPerOrder: number;
  /** Monthly fixed costs (shown separately, not part of headline CM). */
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
}

export type Source = "Shopify" | "Platform-reported" | "Klaviyo" | "Derived" | "Settings";
