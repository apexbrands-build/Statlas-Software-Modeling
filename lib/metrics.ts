import type { Format } from "./format";
import type {
  ChannelDay,
  ChannelKey,
  ClientSettings,
  DailyFact,
  PlanTargetDay,
  Source,
} from "./types";
import { CHANNEL_KEYS } from "./types";
import { BRAND_CHANNELS, CORE_CHANNELS, PLATFORMS, RETENTION_CHANNELS } from "./channels";
import { MIX_KEYS, type MixKey, type MixOf } from "./planning/mix";
import type { RoasOf } from "./planning/roas";

/* ------------------------------------------------------------------ */
/* Aggregation                                                         */
/* ------------------------------------------------------------------ */

export interface Totals {
  days: number;
  grossSales: number;
  discounts: number;
  netSales: number;
  shippingCollected: number;
  tax: number;
  newOrderRevenue: number;
  returningOrderRevenue: number;
  newOrders: number;
  returningOrders: number;
  refunds: number;
  cogs: number;
  cogsUnmappedSales: number;
  emailRevenue: number;
  emailCampaignRevenue: number;
  emailFlowRevenue: number;
  emailOrders: number;
  emailSent: number;
  smsRevenue: number;
  smsCampaignRevenue: number;
  smsFlowRevenue: number;
  smsOrders: number;
  smsSent: number;
  channels: Record<ChannelKey, ChannelDay>;
  /** Ad spend a plan has but did not split by platform (always 0 for actual days). Counts in total spend, MER and CM. */
  unassignedSpend: number;
}

const emptyChannels = (): Record<ChannelKey, ChannelDay> =>
  Object.fromEntries(
    CHANNEL_KEYS.map((k) => [k, { spend: 0, platformRevenue: 0, platformPurchases: 0 }]),
  ) as Record<ChannelKey, ChannelDay>;

export function emptyTotals(): Totals {
  return {
    days: 0,
    grossSales: 0,
    discounts: 0,
    netSales: 0,
    shippingCollected: 0,
    tax: 0,
    newOrderRevenue: 0,
    returningOrderRevenue: 0,
    newOrders: 0,
    returningOrders: 0,
    refunds: 0,
    cogs: 0,
    cogsUnmappedSales: 0,
    emailRevenue: 0,
    emailCampaignRevenue: 0,
    emailFlowRevenue: 0,
    emailOrders: 0,
    emailSent: 0,
    smsRevenue: 0,
    smsCampaignRevenue: 0,
    smsFlowRevenue: 0,
    smsOrders: 0,
    smsSent: 0,
    channels: emptyChannels(),
    unassignedSpend: 0,
  };
}

export function aggregate(facts: DailyFact[]): Totals {
  const t = emptyTotals();
  for (const f of facts) {
    t.days += 1;
    t.grossSales += f.grossSales;
    t.discounts += f.discounts;
    t.netSales += f.netSales;
    t.shippingCollected += f.shippingCollected;
    t.tax += f.tax;
    t.newOrderRevenue += f.newOrderRevenue;
    t.returningOrderRevenue += f.returningOrderRevenue;
    t.newOrders += f.newOrders;
    t.returningOrders += f.returningOrders;
    t.refunds += f.refunds;
    t.cogs += f.cogs;
    t.cogsUnmappedSales += f.cogsUnmappedSales;
    t.emailRevenue += f.emailRevenue;
    t.emailCampaignRevenue += f.emailCampaignRevenue;
    t.emailFlowRevenue += f.emailFlowRevenue;
    t.emailOrders += f.emailOrders;
    t.emailSent += f.emailSent;
    t.smsRevenue += f.smsRevenue ?? 0;
    t.smsCampaignRevenue += f.smsCampaignRevenue ?? 0;
    t.smsFlowRevenue += f.smsFlowRevenue ?? 0;
    t.smsOrders += f.smsOrders ?? 0;
    t.smsSent += f.smsSent ?? 0;
    t.unassignedSpend += f.unassignedSpend ?? 0;
    for (const k of CHANNEL_KEYS) {
      t.channels[k].spend += f.channels[k].spend;
      t.channels[k].platformRevenue += f.channels[k].platformRevenue;
      t.channels[k].platformPurchases += f.channels[k].platformPurchases;
    }
  }
  return t;
}

export interface PlanTotals {
  days: number;
  orderRevenue: number;
  newRevenue: number;
  returningRevenue: number;
  orders: number;
  newOrders: number;
  spend: number;
  /** Planned Google Brand spend, kept apart so aMER can leave it out like the actuals do. */
  brandSpend: number;
  /** Planned retention (returning-audience) spend of every platform, likewise. */
  retentionSpend: number;
  cm: number;
  spendByChannel: Partial<Record<ChannelKey, number>>;
  /** Per channel with a ROAS target: planned spend and the platform revenue that spend is expected to bring at the target. Empty unless aggregatePlan got a `roasOf`. */
  platformRoasPlan: Partial<Record<ChannelKey, { spend: number; expectedRevenue: number }>>;
  /** Planned email, SMS and organic revenue for the period (order revenue x the plan's share), only for a line every day of the period plans. Empty unless aggregatePlan got a `mixOf`. */
  mixRevenue: Partial<Record<MixKey, number>>;
  /** Optional P&L lines; null when the plan does not forecast them. */
  grossSales: number | null;
  discounts: number | null;
  shipping: number | null;
  refunds: number | null;
}

export function aggregatePlan(rows: PlanTargetDay[], roasOf?: RoasOf, mixOf?: MixOf): PlanTotals {
  const covered: Partial<Record<MixKey, { revenue: number; base: number }>> = {};
  const p: PlanTotals = {
    days: 0,
    orderRevenue: 0,
    newRevenue: 0,
    returningRevenue: 0,
    orders: 0,
    newOrders: 0,
    spend: 0,
    brandSpend: 0,
    retentionSpend: 0,
    cm: 0,
    spendByChannel: {},
    platformRoasPlan: {},
    mixRevenue: {},
    grossSales: null,
    discounts: null,
    shipping: null,
    refunds: null,
  };
  for (const r of rows) {
    p.days += 1;
    p.orderRevenue += r.orderRevenue;
    p.newRevenue += r.newRevenue;
    p.returningRevenue += r.returningRevenue;
    p.orders += r.orders;
    p.newOrders += r.newOrders;
    p.spend += r.spend;
    p.cm += r.cm;
    for (const k of ["grossSales", "discounts", "shipping", "refunds"] as const) if (r[k] !== undefined) p[k] = (p[k] ?? 0) + (r[k] as number);
    for (const k of CHANNEL_KEYS) {
      const v = r.spendByChannel[k];
      if (v === undefined) continue;
      p.spendByChannel[k] = (p.spendByChannel[k] ?? 0) + v;
      const target = v > 0 ? roasOf?.(r.date, k) : null;
      if (target != null) {
        const cur = p.platformRoasPlan[k] ?? { spend: 0, expectedRevenue: 0 };
        p.platformRoasPlan[k] = { spend: cur.spend + v, expectedRevenue: cur.expectedRevenue + v * target };
      }
    }
    p.brandSpend += r.spendByChannel.google_brand ?? 0;
    for (const k of RETENTION_CHANNELS) p.retentionSpend += r.spendByChannel[k] ?? 0;
    if (mixOf) {
      for (const k of MIX_KEYS) {
        const share = mixOf(r.date, k);
        if (share === null) continue;
        const c = (covered[k] ??= { revenue: 0, base: 0 });
        c.revenue += r.orderRevenue * share;
        c.base += r.orderRevenue;
      }
    }
  }
  // A line counts only when every day of the period plans it: otherwise its total would cover part of the revenue and read as a shortfall.
  for (const k of MIX_KEYS) {
    const c = covered[k];
    if (c && p.orderRevenue > 0 && c.base >= p.orderRevenue - 0.5) p.mixRevenue[k] = c.revenue;
  }
  return p;
}

/* ------------------------------------------------------------------ */
/* Core formulas                                                       */
/* ------------------------------------------------------------------ */

export const div = (a: number, b: number): number | null => (b === 0 || !Number.isFinite(b) ? null : a / b);

export const orderRevenue = (t: Totals) => t.newOrderRevenue + t.returningOrderRevenue;
export const orders = (t: Totals) => t.newOrders + t.returningOrders;
export const totalSpend = (t: Totals) => CHANNEL_KEYS.reduce((s, k) => s + t.channels[k].spend, 0) + t.unassignedSpend;

export interface CmParts {
  /** Gross - discounts - refunds. Taxes are not included. */
  netSales: number;
  /** Shipping charges collected from customers. */
  shipping: number;
  cogs: number;
  /** Cost of delivery = other variable costs (% of net sales + shipping, plus optional per-order cost). */
  costOfDelivery: number;
  adSpend: number;
  /** Headline contribution margin. */
  cm: number;
}

/**
 * Contribution margin = (Net Sales + Shipping) - COGS - Ad spend - Cost of delivery.
 * Net Sales = gross - discounts - refunds (no tax). Fixed costs are NOT part of CM (they belong in the P&L).
 */
export function cmParts(t: Totals, s: ClientSettings): CmParts {
  const adSpend = totalSpend(t);
  const revenue = t.netSales + t.shippingCollected;
  const costOfDelivery = (s.otherVariablePct / 100) * revenue + s.deliveryCostPerOrder * orders(t);
  // Known product costs plus an estimate (fallback %) for sales whose product has no cost.
  // "Flat rate" ignores Shopify costs entirely: COGS is a share of net sales.
  const cogs = s.cogsFlatRate ? (s.cogsFallbackPct / 100) * t.netSales : t.cogs + (s.cogsFallbackPct / 100) * t.cogsUnmappedSales;
  const cm = revenue - cogs - adSpend - costOfDelivery;
  return { netSales: t.netSales, shipping: t.shippingCollected, cogs, costOfDelivery, adSpend, cm };
}

export interface GroupStats {
  spend: number;
  platformRevenue: number;
  iRevenue: number;
  iOrders: number;
  /** Multiplier: the single factor, or the revenue-weighted blend when channels are merged. */
  multiplier: number;
}

/** Incrementality factor for a channel; no factor set = 1 (platform-reported numbers). */
export const factor = (s: ClientSettings, k: ChannelKey): number => s.multipliers[k] ?? 1;

/** incremental = false reports platform numbers as-is (factor 1). */
export function groupStats(t: Totals, s: ClientSettings, channels: ChannelKey[], incremental = true): GroupStats {
  let spend = 0;
  let platformRevenue = 0;
  let iRevenue = 0;
  let iOrders = 0;
  for (const k of channels) {
    const c = t.channels[k];
    const f = incremental ? factor(s, k) : 1;
    spend += c.spend;
    platformRevenue += c.platformRevenue;
    iRevenue += c.platformRevenue * f;
    iOrders += c.platformPurchases * f;
  }
  const multiplier = channels.length === 1 ? (incremental ? factor(s, channels[0]) : 1) : (div(iRevenue, platformRevenue) ?? 0);
  return { spend, platformRevenue, iRevenue, iOrders, multiplier };
}

export function paidStats(t: Totals, s: ClientSettings) {
  return groupStats(t, s, CHANNEL_KEYS);
}

/** The acquisition channels only (brand search and returning audiences left out): what "new paid" means. */
export function newPaidStats(t: Totals, s: ClientSettings) {
  return groupStats(t, s, PLATFORMS.filter((p) => !p.returningOnly).map((p) => p.acquisition));
}

/**
 * Spend counted as acquisition spend for aMER. Settings can leave out brand search and the retention (returning) spend of every platform;
 * total spend, and so MER, always keep all of it.
 */
export function amerSpend(t: Totals, s: ClientSettings): number {
  const left = new Set<ChannelKey>([...(s.excludeBrandFromAmer ? BRAND_CHANNELS : []), ...(s.excludeMetaReturningFromAmer ? RETENTION_CHANNELS : [])]);
  let sp = totalSpend(t);
  for (const k of left) sp -= t.channels[k].spend;
  return sp;
}

/**
 * ROAS target of a channel group over a plan period: the platform revenue the planned spend is expected to bring at each month's target, over the
 * planned spend (so months weigh by their spend). Incremental mode applies each channel's factor. Null when a spending channel has no target
 * (returning channels), when there is no target at all, or no spend.
 */
export function groupRoasTarget(p: PlanTotals, s: ClientSettings, channels: ChannelKey[], incremental: boolean): number | null {
  let spend = 0;
  let revenue = 0;
  for (const k of channels) {
    const t = p.platformRoasPlan[k];
    if (!t) {
      if ((p.spendByChannel[k] ?? 0) > 0) return null;
      continue;
    }
    // Some of this channel's planned spend has no target (a month with no aMER): show none rather than the covered months only.
    if (t.spend < (p.spendByChannel[k] ?? 0) - 1e-6) return null;
    spend += t.spend;
    revenue += t.expectedRevenue * (incremental ? factor(s, k) : 1);
  }
  return div(revenue, spend);
}

/** The plan's acquisition spend: the same rule as `amerSpend`, so an aMER target and an aMER actual divide by the same kind of spend. */
export function planAmerSpend(p: PlanTotals, s: ClientSettings): number {
  return p.spend - (s.excludeBrandFromAmer ? p.brandSpend : 0) - (s.excludeMetaReturningFromAmer ? p.retentionSpend : 0);
}

/* ------------------------------------------------------------------ */
/* Metric registry                                                     */
/* ------------------------------------------------------------------ */

/** up = higher is better (including ad spend: above plan is shown green), down = lower is better. */
export type Direction = "up" | "down";

export interface MetricDef {
  key: string;
  label: string;
  format: Format;
  direction: Direction;
  source: Source;
  formula: string;
  value: (t: Totals, s: ClientSettings) => number | null;
  /** A sum over days (revenue, spend, CM, orders): its plan target for a whole period can be reached or projected. Ratios are not. */
  additive?: boolean;
  /** Plan target for the same period, if the plan covers this metric. */
  target?: (p: PlanTotals, s: ClientSettings) => number | null;
}

const def = (d: MetricDef): [string, MetricDef] => [d.key, d];

export const METRICS: Record<string, MetricDef> = Object.fromEntries([
  def({
    key: "cm",
    additive: true,
    label: "Contribution Margin",
    format: "currency0",
    direction: "up",
    source: "Derived",
    formula: "Net Sales + Shipping − COGS − Ad spend − Cost of delivery (other variable costs)",
    value: (t, s) => cmParts(t, s).cm,
    target: (p) => p.cm,
  }),
  def({
    key: "orderRevenue",
    additive: true,
    label: "Order Revenue",
    format: "currency0",
    direction: "up",
    source: "Shopify",
    formula: "Gross sales − discounts + shipping + tax (refunds not deducted)",
    value: (t) => orderRevenue(t),
    target: (p) => p.orderRevenue,
  }),
  def({
    key: "adSpend",
    additive: true,
    label: "Ad Spend",
    format: "currency0",
    direction: "up",
    source: "Platform-reported",
    formula: "Sum of spend across all paid channels",
    value: (t) => totalSpend(t),
    target: (p) => p.spend,
  }),
  def({
    key: "mer",
    label: "MER",
    format: "ratio2",
    direction: "up",
    source: "Derived",
    formula: "Order Revenue ÷ total ad spend",
    value: (t) => div(orderRevenue(t), totalSpend(t)),
    target: (p) => div(p.orderRevenue, p.spend),
  }),
  def({
    key: "aov",
    label: "AOV",
    format: "currency2",
    direction: "up",
    source: "Shopify",
    formula: "Order Revenue ÷ orders",
    value: (t) => div(orderRevenue(t), orders(t)),
    target: (p) => div(p.orderRevenue, p.orders),
  }),
  def({
    key: "orders",
    additive: true,
    label: "Orders",
    format: "number",
    direction: "up",
    source: "Shopify",
    formula: "Count of DTC orders",
    value: (t) => orders(t),
    target: (p) => p.orders,
  }),
  def({
    key: "returningRevenue",
    additive: true,
    label: "Returning Revenue",
    format: "currency0",
    direction: "up",
    source: "Shopify",
    formula: "Order Revenue from customers with a prior order",
    value: (t) => t.returningOrderRevenue,
    target: (p) => p.returningRevenue,
  }),
  def({
    key: "returningOrders",
    additive: true,
    label: "Returning Orders",
    format: "number",
    direction: "up",
    source: "Shopify",
    formula: "Orders from customers with a prior order",
    value: (t) => t.returningOrders,
    target: (p) => p.orders - p.newOrders,
  }),
  def({
    key: "returningAov",
    label: "Returning AOV",
    format: "currency2",
    direction: "up",
    source: "Shopify",
    formula: "Returning revenue ÷ returning orders",
    value: (t) => div(t.returningOrderRevenue, t.returningOrders),
    target: (p) => div(p.returningRevenue, p.orders - p.newOrders),
  }),
  def({
    key: "repeatRate",
    label: "Repeat Rate",
    format: "percent1",
    direction: "up",
    source: "Shopify",
    formula: "Returning orders ÷ total orders",
    value: (t) => div(t.returningOrders, orders(t)),
    target: (p) => div(p.orders - p.newOrders, p.orders),
  }),
  def({
    key: "newRevenue",
    additive: true,
    label: "New Revenue",
    format: "currency0",
    direction: "up",
    source: "Shopify",
    formula: "Order Revenue from first-time customers",
    value: (t) => t.newOrderRevenue,
    target: (p) => p.newRevenue,
  }),
  def({
    key: "newOrders",
    additive: true,
    label: "New Orders",
    format: "number",
    direction: "up",
    source: "Shopify",
    formula: "First-time customer orders",
    value: (t) => t.newOrders,
    target: (p) => p.newOrders,
  }),
  def({
    key: "newAov",
    label: "New AOV",
    format: "currency2",
    direction: "up",
    source: "Shopify",
    formula: "New revenue ÷ new orders",
    value: (t) => div(t.newOrderRevenue, t.newOrders),
    target: (p) => div(p.newRevenue, p.newOrders),
  }),
  def({
    key: "weightedCac",
    label: "Weighted CAC",
    format: "currency2",
    direction: "down",
    source: "Derived",
    formula: "Total ad spend ÷ new orders",
    value: (t) => div(totalSpend(t), t.newOrders),
    target: (p) => div(p.spend, p.newOrders),
  }),
  def({
    key: "amer",
    label: "aMER",
    format: "ratio2",
    direction: "up",
    source: "Derived",
    formula: "New Order Revenue ÷ acquisition ad spend (total spend unless excluded in settings)",
    value: (t, s) => div(t.newOrderRevenue, amerSpend(t, s)),
    target: (p, s) => div(p.newRevenue, planAmerSpend(p, s)),
  }),
  def({
    key: "paidIRevenue",
    label: "Total paid iRevenue",
    format: "currency0",
    direction: "up",
    source: "Platform-reported",
    formula: "Σ platform-reported revenue × incrementality multiplier, all channels (acquisition, brand search and returning audiences)",
    value: (t, s) => paidStats(t, s).iRevenue,
  }),
  def({
    key: "newPaidIRevenue",
    label: "New paid iRevenue",
    format: "currency0",
    direction: "up",
    source: "Platform-reported",
    formula: "Σ platform-reported revenue × incrementality multiplier on the acquisition channels only (Meta acquisition, Google non-brand and each platform's acquisition channel); brand search and returning audiences are left out",
    value: (t, s) => newPaidStats(t, s).iRevenue,
  }),
  def({
    key: "newPaidIOrders",
    label: "New paid iOrders",
    format: "number",
    direction: "up",
    source: "Platform-reported",
    formula: "Σ platform-reported purchases × incrementality multiplier on the acquisition channels only",
    value: (t, s) => newPaidStats(t, s).iOrders,
  }),
  def({
    key: "newPaidAov",
    label: "New paid AOV",
    format: "currency2",
    direction: "up",
    source: "Platform-reported",
    formula: "New paid iRevenue ÷ New paid iOrders",
    value: (t, s) => {
      const p = newPaidStats(t, s);
      return div(p.iRevenue, p.iOrders);
    },
  }),
  def({
    key: "newPaidICac",
    label: "New paid iCAC",
    format: "currency2",
    direction: "down",
    source: "Platform-reported",
    formula: "Spend on the acquisition channels ÷ New paid iOrders",
    value: (t, s) => {
      const p = newPaidStats(t, s);
      return div(p.spend, p.iOrders);
    },
  }),
  def({
    key: "newIpaMer",
    label: "New ipaMER",
    format: "ratio2",
    direction: "up",
    source: "Platform-reported",
    formula: "New paid iRevenue ÷ spend on the acquisition channels",
    value: (t, s) => {
      const p = newPaidStats(t, s);
      return div(p.iRevenue, p.spend);
    },
  }),
  def({
    key: "paidShareOfRevenue",
    label: "Paid iRev % of revenue",
    format: "percent1",
    direction: "up",
    source: "Derived",
    formula: "Total paid iRevenue ÷ order revenue",
    value: (t, s) => div(paidStats(t, s).iRevenue, orderRevenue(t)),
  }),
  def({
    key: "newPaidShareOfNewRevenue",
    label: "New paid iRev % of new revenue",
    format: "percent1",
    direction: "up",
    source: "Derived",
    formula: "New paid iRevenue ÷ new customer order revenue",
    value: (t, s) => div(newPaidStats(t, s).iRevenue, t.newOrderRevenue),
  }),
  def({
    key: "paidIOrders",
    label: "Paid iOrders",
    format: "number",
    direction: "up",
    source: "Platform-reported",
    formula: "Σ platform-reported purchases × incrementality multiplier",
    value: (t, s) => paidStats(t, s).iOrders,
  }),
  def({
    key: "paidAov",
    label: "Paid AOV",
    format: "currency2",
    direction: "up",
    source: "Platform-reported",
    formula: "Paid iRevenue ÷ Paid iOrders",
    value: (t, s) => {
      const p = paidStats(t, s);
      return div(p.iRevenue, p.iOrders);
    },
  }),
  def({
    key: "paidICac",
    label: "Paid iCAC",
    format: "currency2",
    direction: "down",
    source: "Platform-reported",
    formula: "Total ad spend ÷ Paid iOrders",
    value: (t, s) => div(totalSpend(t), paidStats(t, s).iOrders),
  }),
  def({
    key: "ipaMer",
    label: "ipaMER",
    format: "ratio2",
    direction: "up",
    source: "Platform-reported",
    formula: "Paid iRevenue ÷ total ad spend",
    value: (t, s) => div(paidStats(t, s).iRevenue, totalSpend(t)),
  }),
  def({
    key: "emailRevenue",
    additive: true,
    label: "Email Revenue",
    format: "currency0",
    direction: "up",
    source: "Klaviyo",
    formula: "Klaviyo-attributed revenue (campaigns + flows)",
    value: (t) => t.emailRevenue,
    target: (p) => p.mixRevenue.email ?? null,
  }),
  def({
    key: "emailOrders",
    label: "Email Orders",
    format: "number",
    direction: "up",
    source: "Klaviyo",
    formula: "Klaviyo-attributed orders",
    value: (t) => t.emailOrders,
  }),
  def({
    key: "emailCampaignRevenue",
    label: "Campaign Revenue",
    format: "currency0",
    direction: "up",
    source: "Klaviyo",
    formula: "Klaviyo campaign-attributed revenue",
    value: (t) => t.emailCampaignRevenue,
  }),
  def({
    key: "emailFlowRevenue",
    label: "Flow Revenue",
    format: "currency0",
    direction: "up",
    source: "Klaviyo",
    formula: "Klaviyo flow-attributed revenue",
    value: (t) => t.emailFlowRevenue,
  }),
  def({
    key: "emailRevPer1k",
    label: "Revenue / 1K Sent",
    format: "currency2",
    direction: "up",
    source: "Klaviyo",
    formula: "Email revenue ÷ (emails sent ÷ 1,000)",
    value: (t) => div(t.emailRevenue, t.emailSent / 1000),
  }),
  def({
    key: "smsRevenue",
    additive: true,
    label: "SMS Revenue",
    format: "currency0",
    direction: "up",
    source: "SMS platform",
    formula: "SMS-attributed revenue (campaigns + flows)",
    value: (t) => t.smsRevenue,
    target: (p) => p.mixRevenue.sms ?? null,
  }),
  def({
    key: "smsOrders",
    label: "SMS Orders",
    format: "number",
    direction: "up",
    source: "SMS platform",
    formula: "SMS-attributed orders",
    value: (t) => t.smsOrders,
  }),
  def({
    key: "smsCampaignRevenue",
    label: "SMS Campaign Revenue",
    format: "currency0",
    direction: "up",
    source: "SMS platform",
    formula: "SMS campaign-attributed revenue",
    value: (t) => t.smsCampaignRevenue,
  }),
  def({
    key: "smsFlowRevenue",
    label: "SMS Flow Revenue",
    format: "currency0",
    direction: "up",
    source: "SMS platform",
    formula: "SMS automation (flow) attributed revenue",
    value: (t) => t.smsFlowRevenue,
  }),
  def({
    key: "smsRevPer1k",
    label: "SMS Revenue / 1K Sent",
    format: "currency2",
    direction: "up",
    source: "SMS platform",
    formula: "SMS revenue ÷ (messages sent ÷ 1,000)",
    value: (t) => div(t.smsRevenue, t.smsSent / 1000),
  }),
  def({
    key: "organicRevenue",
    additive: true,
    label: "Organic Revenue",
    format: "currency0",
    direction: "up",
    source: "Derived",
    formula: "Order Revenue − Paid iRevenue − Email Revenue − SMS Revenue (floored at 0)",
    value: (t, s) => Math.max(0, orderRevenue(t) - paidStats(t, s).iRevenue - t.emailRevenue - t.smsRevenue),
    target: (p) => p.mixRevenue.organic ?? null,
  }),
  def({
    key: "organicOrders",
    label: "Organic Orders",
    format: "number",
    direction: "up",
    source: "Derived",
    formula: "Orders − Paid iOrders − Email orders − SMS orders (floored at 0)",
    value: (t, s) => Math.max(0, orders(t) - paidStats(t, s).iOrders - t.emailOrders - t.smsOrders),
  }),
  def({
    key: "organicAov",
    label: "Organic AOV",
    format: "currency2",
    direction: "up",
    source: "Derived",
    formula: "Organic revenue ÷ organic orders",
    value: (t, s) => {
      const rev = Math.max(0, orderRevenue(t) - paidStats(t, s).iRevenue - t.emailRevenue - t.smsRevenue);
      const ord = Math.max(0, orders(t) - paidStats(t, s).iOrders - t.emailOrders - t.smsOrders);
      return div(rev, ord);
    },
  }),
  def({
    key: "organicPctOfRevenue",
    label: "Organic % of Revenue",
    format: "percent1",
    direction: "up",
    source: "Derived",
    formula: "Organic revenue ÷ Order Revenue",
    value: (t, s) => div(Math.max(0, orderRevenue(t) - paidStats(t, s).iRevenue - t.emailRevenue - t.smsRevenue), orderRevenue(t)),
    target: (p) => (p.mixRevenue.organic !== undefined && p.orderRevenue > 0 ? p.mixRevenue.organic / p.orderRevenue : null),
  }),
]);

/* ------------------------------------------------------------------ */
/* Channel groups                                                      */
/* ------------------------------------------------------------------ */

export interface ChannelGroup {
  id: string;
  label: string;
  channels: ChannelKey[];
}

/**
 * breakout = show each platform's non-acquisition channel (Google Brand, Meta Returning...) as its own row.
 * acquisitionOnly = leave the non-acquisition channels out entirely.
 */
export function channelGroups(breakout: boolean, acquisitionOnly = false): ChannelGroup[] {
  const out: ChannelGroup[] = [];
  for (const p of PLATFORMS) {
    if (acquisitionOnly && p.returningOnly) continue;
    if (acquisitionOnly) {
      out.push({ id: p.acquisition, label: p.label, channels: [p.acquisition] });
    } else if (breakout) {
      out.push({ id: p.acquisition, label: p.label, channels: [p.acquisition] });
      out.push({ id: p.nonAcquisition, label: p.nonAcquisitionLabel, channels: [p.nonAcquisition] });
    } else {
      out.push({ id: p.id, label: p.label, channels: [p.acquisition, p.nonAcquisition] });
    }
  }
  return out;
}

/** Hide platforms with no spend at all, except the core Google and Meta rows. */
export function visibleGroups(groups: ChannelGroup[], t: Totals): ChannelGroup[] {
  return groups.filter((g) => g.channels.some((k) => CORE_CHANNELS.includes(k)) || g.channels.some((k) => t.channels[k].spend > 0));
}

/** incremental = factor-adjusted (iRev, iCPA, iROAS); otherwise platform-reported (Rev, CPA, ROAS). */
export function channelMetricDefs(g: ChannelGroup, incremental = true): MetricDef[] {
  const src: Source = "Platform-reported";
  const i = incremental ? "i" : "";
  const planSpend = (p: PlanTotals) => {
    const vals = g.channels.map((k) => p.spendByChannel[k]);
    return vals.every((v) => v === undefined) ? null : vals.reduce<number>((a, v) => a + (v ?? 0), 0);
  };
  return [
    {
      key: `${g.id}.spend`,
      additive: true,
      label: `${g.label} Spend`,
      format: "currency0",
      direction: "up",
      source: src,
      formula: `Spend on ${g.label}`,
      value: (t, st) => groupStats(t, st, g.channels, incremental).spend,
      target: planSpend,
    },
    {
      key: `${g.id}.irev`,
      label: `${g.label} ${i}Rev`,
      format: "currency0",
      direction: "up",
      source: src,
      formula: incremental ? "Platform-reported revenue (7-day click) × incrementality factor" : "Platform-reported revenue (7-day click)",
      value: (t, st) => groupStats(t, st, g.channels, incremental).iRevenue,
    },
    {
      key: `${g.id}.aov`,
      label: `${g.label} AOV`,
      format: "currency2",
      direction: "up",
      source: src,
      formula: `${i}Revenue ÷ ${i}Orders`,
      value: (t, st) => {
        const x = groupStats(t, st, g.channels, incremental);
        return div(x.iRevenue, x.iOrders);
      },
    },
    {
      key: `${g.id}.icpa`,
      label: `${g.label} ${i}CPA`,
      format: "currency2",
      direction: "down",
      source: src,
      formula: `Spend ÷ ${i}Orders`,
      value: (t, st) => {
        const x = groupStats(t, st, g.channels, incremental);
        return div(x.spend, x.iOrders);
      },
    },
    {
      key: `${g.id}.iroas`,
      label: `${g.label} ${i}ROAS`,
      format: "ratio2",
      direction: "up",
      source: src,
      formula: `${i}Revenue ÷ Spend`,
      value: (t, st) => {
        const x = groupStats(t, st, g.channels, incremental);
        return div(x.iRevenue, x.spend);
      },
      target: (p, st) => groupRoasTarget(p, st, g.channels, incremental),
    },
  ];
}

/** Label for a channel revenue tile including its factor, e.g. "Meta iRev (x1.15)". */
export function multiplierLabel(g: ChannelGroup, s: ClientSettings, t: Totals): string {
  const m = groupStats(t, s, g.channels).multiplier;
  return `${g.label} iRev (x${Number(m.toFixed(2))})`;
}

/* ------------------------------------------------------------------ */
/* Comparison status                                                   */
/* ------------------------------------------------------------------ */

export type Tone = "good" | "bad" | "neutral";

export interface Comparison {
  /** Relative difference vs the reference: (actual - ref) / |ref|. */
  diff: number | null;
  tone: Tone;
}

/** Differences within +/-10% of the reference are neutral grey. */
const NEUTRAL_BAND = 0.1;

export function compare(actual: number | null, ref: number | null, direction: Direction): Comparison {
  if (actual === null || ref === null || ref === 0 || !Number.isFinite(actual) || !Number.isFinite(ref)) {
    return { diff: null, tone: "neutral" };
  }
  const diff = (actual - ref) / Math.abs(ref);
  if (Math.abs(diff) <= NEUTRAL_BAND) return { diff, tone: "neutral" };
  if (direction === "up") return { diff, tone: diff > 0 ? "good" : "bad" };
  return { diff, tone: diff < 0 ? "good" : "bad" };
}

/* ------------------------------------------------------------------ */
/* Compare ranges                                                      */
/* ------------------------------------------------------------------ */
