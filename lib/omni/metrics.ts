/**
 * The numbers each sales platform reports, and the ones its team calculates from them.
 * One catalog drives what is stored (`channel_sales.metrics`), what a file's columns are called, and what a channel page shows.
 * The four numbers every channel has (revenue, orders, units, ad spend) are columns of their own and are not listed as stored metrics.
 */

export type Platform = "amazon" | "tiktok_shop" | "retail" | "other";

/** "price" is money shown with cents (an average order value, a cost per click); "currency" is shown in whole units. */
export type Unit = "currency" | "price" | "number" | "percent" | "ratio";
export type Better = "up" | "down" | null;

export interface MetricDef {
  key: string;
  label: string;
  unit: Unit;
  group: string;
  /** How a period is built from its days: added up, averaged over the days that have it, or the latest day that has it. */
  agg: "sum" | "avg" | "last";
  better: Better;
  /** Column names files use for it, lower case, punctuation removed. */
  aliases: string[];
  whole?: boolean;
  hint?: string;
}

/** A period of a channel: the four core numbers and the stored metrics that were present. */
export interface Totals {
  revenue: number;
  orders: number;
  units: number;
  adSpend: number;
  m: Record<string, number>;
}

export interface DerivedDef {
  key: string;
  label: string;
  unit: Unit;
  group: string;
  better: Better;
  calc: (t: Totals) => number | null;
  hint?: string;
}

export interface PlatformCatalog {
  coreLabels: { revenue: string; orders: string; units: string; adSpend: string };
  coreAliases: { revenue: string[]; orders: string[]; units: string[]; adSpend: string[] };
  stored: MetricDef[];
  derived: DerivedDef[];
  /**
   * Totals that are the sum of parts when the platform reports its ads by type, so one type's file never overwrites another's.
   * `target` is "adSpend" or a stored metric; `parts` are stored metrics.
   */
  rollups: { target: string; parts: string[] }[];
}

/** A channel saved before platforms existed is recognised by its name. */
export function platformOf(c: { key: string; label: string; kind: "marketplace" | "retail"; platform?: Platform }): Platform {
  if (c.platform) return c.platform;
  const name = `${c.key} ${c.label}`.toLowerCase();
  if (/amazon/.test(name)) return "amazon";
  if (/tik\s*tok|(^|[^a-z])tts([^a-z]|$)/.test(name)) return "tiktok_shop";
  return c.kind === "retail" ? "retail" : "other";
}

const get = (t: Totals, key: string): number | null => (typeof t.m[key] === "number" && Number.isFinite(t.m[key]) ? t.m[key] : null);
const div = (a: number | null, b: number | null): number | null => (a === null || b === null || !(b > 0) ? null : a / b);
const sub = (a: number | null, b: number | null): number | null => (a === null || b === null ? null : a - b);
const add = (a: number | null, b: number | null): number | null => (a === null && b === null ? null : (a ?? 0) + (b ?? 0));

const s = (key: string, label: string, unit: Unit, group: string, aliases: string[], extra: Partial<MetricDef> = {}): MetricDef => ({ key, label, unit, group, agg: "sum", better: "up", aliases, ...extra });
const d = (key: string, label: string, unit: Unit, group: string, better: Better, calc: (t: Totals) => number | null, hint?: string): DerivedDef => ({ key, label, unit, group, better, calc, hint });

const GENERIC_CORE = { revenue: ["revenue", "sales", "net sales", "gmv"], orders: ["orders"], units: ["units"], adSpend: ["ad spend", "adspend", "spend"] };
const NONE: PlatformCatalog = { coreLabels: { revenue: "Revenue", orders: "Orders", units: "Units", adSpend: "Ad spend" }, coreAliases: GENERIC_CORE, stored: [], derived: [], rollups: [] };

const ROUGH_ORGANIC = "Rough by day: ad sales are counted in a window after the click (7 days for Sponsored Products, 14 for Brands and Display), all sales on the order day. Read it by week or month.";
const GMV_MAX = "GMV Max counts organic orders of the promoted products as its own, so this reads high. It cannot be compared with the ROAS of an ad platform.";

const AD_TYPE = { sp: "Sponsored Products", sb: "Sponsored Brands", sd: "Sponsored Display" } as const;
const byType = (suffix: string, types: readonly ("sp" | "sb" | "sd")[] = ["sp", "sb", "sd"]) => types.map((p) => `${p}_${suffix}`);

const AMAZON: PlatformCatalog = {
  coreLabels: { revenue: "Ordered product sales", orders: "Order items", units: "Units ordered", adSpend: "Ad spend" },
  coreAliases: {
    revenue: ["revenue", "sales", "ordered product sales"],
    orders: ["orders", "total order items", "order items"],
    units: ["units", "units ordered"],
    adSpend: ["ad spend", "adspend", "spend", "cost"],
  },
  stored: [
    s("sessions", "Sessions", "number", "Traffic", ["sessions", "sessions total", "total sessions"]),
    s("page_views", "Page views", "number", "Traffic", ["page views", "page views total", "pageviews"]),
    s("buy_box_views", "Page views with the Featured Offer", "number", "Traffic", ["buy box page views"]),
    s("units_refunded", "Units refunded", "number", "Sales", ["units refunded"], { better: "down" }),
    s("refunds", "Refunds", "currency", "Sales", ["refunds", "refund amount", "refunded amount"], { better: "down" }),
    s("ad_sales", "Ad-attributed sales", "currency", "Ads", ["ad sales", "attributed sales", "advertising sales"]),
    s("ad_orders", "Ad orders", "number", "Ads", ["ad orders", "attributed orders"]),
    s("ad_clicks", "Ad clicks", "number", "Ads", ["clicks", "ad clicks"]),
    s("ad_impressions", "Ad impressions", "number", "Ads", ["impressions", "ad impressions"]),
    s("sp_spend", "Sponsored Products spend", "currency", "Ads", ["sp spend", "sponsored products spend"]),
    s("sp_sales", "Sponsored Products sales", "currency", "Ads", ["sp sales", "sponsored products sales"]),
    s("sb_spend", "Sponsored Brands spend", "currency", "Ads", ["sb spend", "sponsored brands spend"]),
    s("sb_sales", "Sponsored Brands sales", "currency", "Ads", ["sb sales", "sponsored brands sales"]),
    s("sd_spend", "Sponsored Display spend", "currency", "Ads", ["sd spend", "sponsored display spend"]),
    s("sd_sales", "Sponsored Display sales", "currency", "Ads", ["sd sales", "sponsored display sales"]),
    ...(["sp", "sb", "sd"] as const).flatMap((p) => [
      s(`${p}_orders`, `${AD_TYPE[p]} orders`, "number", "Ads", [`${p} orders`]),
      s(`${p}_clicks`, `${AD_TYPE[p]} clicks`, "number", "Ads", [`${p} clicks`]),
      s(`${p}_impressions`, `${AD_TYPE[p]} impressions`, "number", "Ads", [`${p} impressions`]),
    ]),
    ...(["sb", "sd"] as const).flatMap((p) => [
      s(`${p}_ntb_orders`, `${AD_TYPE[p]} new-to-brand orders`, "number", "Ads", [`${p} new to brand orders`, `${p} ntb orders`]),
      s(`${p}_ntb_sales`, `${AD_TYPE[p]} new-to-brand sales`, "currency", "Ads", [`${p} new to brand sales`, `${p} ntb sales`]),
    ]),
    s("ntb_orders", "New-to-brand orders", "number", "Ads", ["new to brand orders", "ntb orders"]),
    s("ntb_sales", "New-to-brand sales", "currency", "Ads", ["new to brand sales", "ntb sales"]),
    s("sns_sales", "Subscribe & Save sales", "currency", "Subscriptions", ["subscribe and save sales", "subscribe save sales", "sns sales", "total subscriptions revenue", "subscription revenue"]),
    s("sns_units", "Subscribe & Save units", "number", "Subscriptions", ["subscribe and save units", "sns units", "shipped subscription units"]),
    s("active_subscriptions", "Active subscriptions", "number", "Subscriptions", ["active subscriptions"], { agg: "last", hint: "The latest day loaded in the period." }),
    s("referral_fees", "Referral fees", "currency", "Costs", ["referral fees", "referral fee"], { better: "down" }),
    s("fulfilment_fees", "Fulfilment (FBA) fees", "currency", "Costs", ["fba fees", "fulfilment fees", "fulfillment fees"], { better: "down" }),
    s("promo_cost", "Coupons and deals", "currency", "Costs", ["promotions", "coupons", "promo cost"], { better: "down" }),
  ],
  derived: [
    d("tacos", "Total ACOS", "percent", "Ads", "down", (t) => div(t.adSpend, t.revenue), "Ad spend ÷ all sales. Amazon does not show it. It is the number to run the channel on: MER = 1 ÷ total ACOS."),
    d("acos", "ACOS", "percent", "Ads", "down", (t) => div(t.adSpend, get(t, "ad_sales")), "Ad spend ÷ the sales Amazon's ads take credit for."),
    d("ad_roas", "Ad ROAS", "ratio", "Ads", "up", (t) => (t.adSpend > 0 ? div(get(t, "ad_sales"), t.adSpend) : null)),
    d("organic_sales", "Organic sales", "currency", "Sales", "up", (t) => sub(t.revenue, get(t, "ad_sales")), ROUGH_ORGANIC),
    d("ad_share", "Ad-attributed share of sales", "percent", "Ads", null, (t) => div(get(t, "ad_sales"), t.revenue)),
    d("conversion", "Conversion (unit session %)", "percent", "Traffic", "up", (t) => div(t.units, get(t, "sessions")), "Units ordered ÷ sessions, Amazon's conversion rate."),
    d("buy_box_pct", "Buy Box %", "percent", "Traffic", "up", (t) => div(get(t, "buy_box_views"), get(t, "page_views")), "Share of page views where the brand's offer was the featured one."),
    d("aov", "Sales per order item", "price", "Sales", "up", (t) => div(t.revenue, t.orders)),
    d("asp", "Average selling price", "price", "Sales", null, (t) => div(t.revenue, t.units)),
    d("cpc", "Cost per click", "price", "Ads", "down", (t) => div(t.adSpend, get(t, "ad_clicks"))),
    d("ctr", "Click-through rate", "percent", "Ads", "up", (t) => div(get(t, "ad_clicks"), get(t, "ad_impressions"))),
    d("refund_rate", "Refund rate", "percent", "Sales", "down", (t) => div(get(t, "units_refunded"), t.units), "Units refunded ÷ units ordered."),
    d("sns_share", "Subscribe & Save share of sales", "percent", "Subscriptions", null, (t) => div(get(t, "sns_sales"), t.revenue)),
    d("ntb_share", "New-to-brand share of Brands and Display sales", "percent", "Ads", "up", (t) => div(get(t, "ntb_sales"), add(get(t, "sb_sales"), get(t, "sd_sales"))), "Sponsored Products does not report new-to-brand."),
    d("sp_acos", "Sponsored Products ACOS", "percent", "Ads", "down", (t) => div(get(t, "sp_spend"), get(t, "sp_sales"))),
    d("sb_acos", "Sponsored Brands ACOS", "percent", "Ads", "down", (t) => div(get(t, "sb_spend"), get(t, "sb_sales"))),
    d("sd_acos", "Sponsored Display ACOS", "percent", "Ads", "down", (t) => div(get(t, "sd_spend"), get(t, "sd_sales"))),
  ],
  rollups: [
    { target: "adSpend", parts: byType("spend") },
    { target: "ad_sales", parts: byType("sales") },
    { target: "ad_orders", parts: byType("orders") },
    { target: "ad_clicks", parts: byType("clicks") },
    { target: "ad_impressions", parts: byType("impressions") },
    { target: "ntb_orders", parts: byType("ntb_orders", ["sb", "sd"]) },
    { target: "ntb_sales", parts: byType("ntb_sales", ["sb", "sd"]) },
  ],
};

const TIKTOK: PlatformCatalog = {
  coreLabels: { revenue: "GMV", orders: "Orders", units: "Items sold", adSpend: "Shop ads cost" },
  coreAliases: {
    revenue: ["revenue", "sales", "gmv", "gross merchandise value"],
    orders: ["orders", "sku orders"],
    units: ["units", "items sold"],
    adSpend: ["ad spend", "adspend", "spend", "cost", "ads cost"],
  },
  stored: [
    s("buyers", "Buyers", "number", "Sales", ["customers", "buyers"]),
    s("refunds", "Refunds", "currency", "Sales", ["refunds", "refund amount"], { better: "down" }),
    s("visitors", "Visitors", "number", "Traffic", ["visitors", "avg visitors", "unique visitors"]),
    s("page_views", "Product page views", "number", "Traffic", ["page views", "product page views", "product clicks"]),
    s("add_to_carts", "Add-to-carts", "number", "Traffic", ["add to cart count", "add to carts"]),
    s("live_gmv", "LIVE", "currency", "By content", ["live gmv", "gmv from live", "live"]),
    s("video_gmv", "Video", "currency", "By content", ["video gmv", "gmv from video", "video"]),
    s("card_gmv", "Product card", "currency", "By content", ["product card gmv", "gmv from product card", "product card"]),
    s("affiliate_gmv", "Affiliate", "currency", "By source", ["affiliate gmv", "affiliate"]),
    s("seller_gmv", "Seller", "currency", "By source", ["seller gmv", "seller"]),
    s("creators_with_sales", "Creators with sales", "number", "Affiliates", ["creators with sales", "affiliates with sales"], { agg: "avg", hint: "Average per day: the same creator can sell on several days." }),
    s("videos_posted", "Videos posted", "number", "Affiliates", ["videos", "videos posted", "new video count"]),
    s("lives_held", "LIVEs held", "number", "Affiliates", ["lives", "live sessions", "new live count"]),
    s("samples_shipped", "Samples shipped", "number", "Affiliates", ["shipped samples", "samples shipped", "samples"]),
    s("affiliate_commission", "Affiliate commission", "currency", "Affiliates", ["affiliate commission", "commission", "est commission", "actual commission"], { better: "down" }),
    s("ads_gmv", "Shop ads gross revenue", "currency", "Shop ads", ["gross revenue", "ads gross revenue", "gmv max gross revenue"], { hint: GMV_MAX }),
    s("ads_orders", "Shop ads orders", "number", "Shop ads", ["ads orders", "gmv max orders"]),
    s("referral_fees", "Referral fees", "currency", "Costs", ["referral fee", "referral fees"], { better: "down" }),
    s("shipping_cost", "Shipping and fulfilment", "currency", "Costs", ["shipping cost", "shipping"], { better: "down" }),
    s("seller_discounts", "Seller-funded discounts", "currency", "Costs", ["seller discounts", "seller discount"], { better: "down" }),
  ],
  derived: [
    d("aov", "Average order value", "price", "Sales", "up", (t) => div(t.revenue, t.orders)),
    d("net_gmv", "GMV net of refunds", "currency", "Sales", "up", (t) => sub(t.revenue, get(t, "refunds")), "GMV counts orders that are later cancelled or refunded. This is the number the P&L uses."),
    d("refund_rate", "Refund rate", "percent", "Sales", "down", (t) => div(get(t, "refunds"), t.revenue)),
    d("conversion", "Conversion", "percent", "Traffic", "up", (t) => div(t.orders, get(t, "visitors")), "Orders ÷ visitors."),
    d("affiliate_share", "Affiliate share of GMV", "percent", "By source", null, (t) => div(get(t, "affiliate_gmv"), t.revenue)),
    d("commission_rate", "Commission rate", "percent", "Affiliates", "down", (t) => div(get(t, "affiliate_commission"), get(t, "affiliate_gmv"))),
    d("ads_roi", "Shop ads ROI", "ratio", "Shop ads", "up", (t) => (t.adSpend > 0 ? div(get(t, "ads_gmv"), t.adSpend) : null), GMV_MAX),
    d("ads_cost_share", "Shop ads cost as % of GMV", "percent", "Shop ads", "down", (t) => div(t.adSpend, t.revenue), "The honest reading of shop ads: what they cost against everything the shop sold."),
    d("cost_per_order", "Shop ads cost per order", "price", "Shop ads", "down", (t) => div(t.adSpend, get(t, "ads_orders"))),
  ],
  rollups: [],
};

export const CATALOG: Record<Platform, PlatformCatalog> = { amazon: AMAZON, tiktok_shop: TIKTOK, retail: NONE, other: NONE };

const CORE: Record<"revenue" | "orders" | "units" | "adSpend", { unit: Unit; group: string }> = {
  revenue: { unit: "currency", group: "Sales" },
  orders: { unit: "number", group: "Sales" },
  units: { unit: "number", group: "Sales" },
  adSpend: { unit: "currency", group: "Ads" },
};
const isCore = (key: string): key is keyof typeof CORE => key in CORE;

/** The label, unit and good direction of a core number, a stored metric or a calculated one; null for a key the platform does not have. */
export function metricInfo(platform: Platform, key: string): { label: string; unit: Unit; better: Better; group: string; hint?: string } | null {
  const c = CATALOG[platform];
  if (isCore(key)) return { label: c.coreLabels[key], unit: CORE[key].unit, better: "up", group: CORE[key].group };
  const m = c.stored.find((x) => x.key === key) ?? c.derived.find((x) => x.key === key);
  return m ? { label: m.label, unit: m.unit, better: m.better, group: m.group, hint: m.hint } : null;
}

/** A metric's value for a period; null when the period does not hold what it needs. */
export function metricValue(platform: Platform, key: string, t: Totals): number | null {
  if (isCore(key)) return t[key];
  const c = CATALOG[platform];
  if (c.stored.some((x) => x.key === key)) return get(t, key);
  const derived = c.derived.find((x) => x.key === key);
  return derived ? derived.calc(t) : null;
}
