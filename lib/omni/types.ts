/**
 * One day of sales on a sales channel other than the store's own site (Amazon, TikTok Shop, retail), as loaded from a file,
 * rolled up from synced Shopify orders, or pulled by a connector. A retail channel can hold one row per retailer and day.
 */
export interface ChannelSale {
  /** YYYY-MM-DD. */
  date: string;
  /** The key of the channel in the client's settings (`extra.halo.channels`). */
  channel: string;
  /** Empty for a channel with no retailers. */
  retailer: string;
  revenue: number;
  orders: number;
  units: number;
  /** Ad spend on the channel itself (Amazon Ads, GMV Max, retail media). */
  adSpend: number;
  source: "import" | "shopify" | "connector" | "demo";
}

/** A channel's day with its retailers added together. */
export interface ChannelDay {
  revenue: number;
  orders: number;
  units: number;
  adSpend: number;
}
