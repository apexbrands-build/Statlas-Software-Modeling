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

export interface ClientSettings {
  clientId: string;
  /** Incrementality (iROAS) factors: platform-reported revenue x multiplier = incremental revenue. */
  multipliers: Record<ChannelKey, number>;
  /** Cost of delivery / other variable costs (payment fees, packaging...) as % of Net Sales + Shipping. */
  otherVariablePct: number;
  /** Optional fulfilment cost per order, also part of cost of delivery. */
  deliveryCostPerOrder: number;
  /** COGS estimate (% of sales) for products with no cost per item. */
  cogsFallbackPct: number;
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
