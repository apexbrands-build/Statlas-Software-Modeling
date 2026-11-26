import type { OtherChannel } from "../types";
import type { PeriodTotals } from "./channel-metrics";
import { metricInfo, metricValue, type Better, type Platform, type Totals, type Unit } from "./metrics";
import type { ChannelView } from "./views";

/**
 * What an Amazon or TikTok Shop page shows, as plain data. It is read in the order the business is run: contribution first, then
 * sales, ad spend and the channel's efficiency, then the platform's own detail. A number is compared with the forecast when the plan
 * has one for the period, and otherwise with the same days last year.
 */

export interface Headline {
  key: string;
  label: string;
  value: number | null;
  unit: Unit;
  better: Better;
  /** The value that is compared with `ref`: the days the forecast covers, or the whole period against last year. */
  cmp: number | null;
  ref: number | null;
  refWord: "forecast" | "planned" | "last year" | null;
  hint?: string;
  /** A second reading shown under the value. */
  also?: string;
}

export interface BlockRow {
  key: string;
  label: string;
  value: number | null;
  unit: Unit;
  /** The same days last year. */
  prev: number | null;
  better: Better;
  hint?: string;
}

export interface Block {
  title: string;
  note?: string;
  rows: BlockRow[];
}

export interface PageTable {
  title: string;
  note?: string;
  columns: { label: string; unit: Unit }[];
  rows: { label: string; cells: (number | null)[] }[];
}

export interface ChannelPageData {
  platform: Platform;
  headlines: Headline[];
  blocks: Block[];
  tables: PageTable[];
}

/** The columns of the table by day, week or month, and the choices of the chart. */
export const DEFAULT_COLUMNS: Record<Platform, string[]> = {
  amazon: ["revenue", "units", "orders", "adSpend", "ad_sales", "tacos", "acos", "organic_sales", "sessions", "conversion", "buy_box_pct", "sns_sales"],
  tiktok_shop: ["revenue", "orders", "units", "adSpend", "ads_gmv", "ads_cost_share", "ads_roi", "affiliate_gmv", "seller_gmv", "live_gmv", "video_gmv", "card_gmv", "visitors", "conversion", "refunds"],
  retail: ["revenue", "units", "orders", "adSpend"],
  other: ["revenue", "orders", "units", "adSpend"],
};

const BLOCKS: Record<Platform, { title: string; note?: string; keys: string[] }[]> = {
  amazon: [
    { title: "Sales and traffic", keys: ["sessions", "conversion", "buy_box_pct", "asp", "refund_rate", "units_refunded"] },
    { title: "Ads", note: "What Amazon's ads take credit for. Organic sales are rough by day: read them by week or month.", keys: ["ad_sales", "ad_share", "organic_sales", "ad_roas", "cpc", "ctr", "ntb_share"] },
    { title: "Subscriptions", keys: ["sns_sales", "sns_share", "sns_units", "active_subscriptions"] },
  ],
  tiktok_shop: [
    { title: "Sales and traffic", note: "GMV counts orders that are later cancelled or refunded; the P&L uses GMV net of refunds.", keys: ["net_gmv", "refund_rate", "buyers", "visitors", "conversion", "add_to_carts"] },
    { title: "Affiliates", keys: ["affiliate_gmv", "affiliate_share", "creators_with_sales", "videos_posted", "lives_held", "samples_shipped", "affiliate_commission", "commission_rate"] },
    { title: "Shop ads", note: "GMV Max counts organic orders of the promoted products as its own, so its ROI reads high. Cost as a share of all GMV is the honest reading.", keys: ["ads_gmv", "ads_roi", "ads_cost_share", "cost_per_order", "ads_orders"] },
  ],
  retail: [],
  other: [],
};

const marginOf = (c: OtherChannel) => 1 - Math.min(100, Math.max(0, Number.isFinite(c.costPct) ? c.costPct : 0)) / 100;
const div = (a: number | null, b: number | null) => (a === null || b === null || !(b > 0) ? null : a / b);

export function channelPage({ platform, channel, view, now, prev }: { platform: Platform; channel: OtherChannel; view: ChannelView; now: PeriodTotals; prev: PeriodTotals | null }): ChannelPageData {
  const val = (key: string, t: Totals | null) => (t ? metricValue(platform, key, t) : null);
  const margin = marginOf(channel);
  const covered = view.comparable !== null && view.forecastToDate !== null ? view.comparable : null;

  /** A headline compared with the plan when the plan has a reference for it, otherwise with the same days last year. */
  const head = (key: string, label: string, unit: Unit, better: Better, value: number | null, plan: { cmp: number | null; ref: number | null; word: "forecast" | "planned" } | null, lastYear: number | null, extra: Partial<Headline> = {}): Headline => {
    const usePlan = plan !== null && plan.ref !== null;
    return { key, label, value, unit, better, cmp: usePlan ? plan.cmp : value, ref: usePlan ? plan.ref : lastYear, refWord: usePlan ? plan.word : lastYear !== null ? "last year" : null, ...extra };
  };
  const info = (key: string) => metricInfo(platform, key) ?? { label: key, unit: "number" as Unit, better: null as Better, group: "" };
  /** A platform metric as a headline: the plan holds no target for these yet, so they are read against last year. */
  const fromCatalog = (key: string) => {
    const i = info(key);
    return head(key, i.label, i.unit, i.better, val(key, now), null, val(key, prev), { hint: i.hint });
  };

  const headlines: Headline[] = [
    head("contribution", "Contribution after ads", "currency", "up", view.hasData ? view.contribution : null, covered ? { cmp: covered.contribution, ref: view.planContributionToDate, word: "forecast" } : null, prev ? prev.revenue * margin - prev.adSpend : null, {
      hint: "Sales at the channel's margin (Store Settings) minus its own ad spend.",
    }),
    head("revenue", info("revenue").label, "currency", "up", view.hasData ? view.revenue : null, covered ? { cmp: covered.revenue, ref: view.forecastToDate, word: "forecast" } : null, prev ? prev.revenue : null),
    head("adSpend", info("adSpend").label, "currency", "up", view.hasData ? view.adSpend : null, covered && view.planAdSpendToDate !== null && view.planAdSpendToDate > 0 ? { cmp: covered.adSpend, ref: view.planAdSpendToDate, word: "planned" } : null, prev ? prev.adSpend : null),
  ];
  // The channel's efficiency: ad spend against everything it sold (Amazon's total ACOS, TikTok Shop's ads cost share), the reading of MER.
  const effKey = platform === "amazon" ? "tacos" : "ads_cost_share";
  const plannedEff = covered && view.planAdSpendToDate !== null && view.planAdSpendToDate > 0 ? div(view.planAdSpendToDate, view.forecastToDate) : null;
  const mer = div(view.revenue, view.adSpend);
  headlines.push(
    head(effKey, info(effKey).label, "percent", "down", val(effKey, now), plannedEff !== null && covered ? { cmp: div(covered.adSpend, covered.revenue), ref: plannedEff, word: "planned" } : null, val(effKey, prev), {
      hint: info(effKey).hint,
      also: mer === null ? undefined : `MER ${mer.toFixed(2)}`,
    }),
  );
  headlines.push(fromCatalog(platform === "amazon" ? "acos" : "ads_roi"));
  headlines.push(fromCatalog("aov"));
  headlines.push(head("orders", info("orders").label, "number", "up", view.hasData ? view.orders : null, null, prev ? prev.orders : null, { also: view.units > 0 ? `${view.units.toLocaleString("en-US")} units` : undefined }));
  if (view.createdByAds !== null) {
    headlines.push({ key: "halo", label: "Created by own-site ads", value: view.createdByAds, unit: "currency", better: null, cmp: null, ref: null, refWord: null, hint: "Modelled from the halo factors in Store Settings. It is inside the sales, not on top of them." });
  }

  const blocks: Block[] = [];
  for (const b of BLOCKS[platform]) {
    const rows: BlockRow[] = [];
    for (const key of b.keys) {
      const value = val(key, now);
      const before = val(key, prev);
      if (value === null && before === null) continue;
      const i = info(key);
      rows.push({ key, label: i.label, value, unit: i.unit, prev: before, better: i.better, hint: i.hint });
    }
    if (rows.length) blocks.push({ title: b.title, note: b.note, rows });
  }

  const tables: PageTable[] = [];
  const m = (key: string) => val(key, now);
  if (platform === "amazon") {
    const types = [
      { p: "sp", label: "Sponsored Products" },
      { p: "sb", label: "Sponsored Brands" },
      { p: "sd", label: "Sponsored Display" },
    ];
    if (types.some((t) => m(`${t.p}_spend`) !== null || m(`${t.p}_sales`) !== null)) {
      const row = (label: string, spend: number | null, sales: number | null, orders: number | null, clicks: number | null) => ({ label, cells: [spend, div(spend, now.adSpend), sales, div(spend, sales), orders, clicks, div(spend, clicks)] });
      tables.push({
        title: "Ads by type",
        note: "Sponsored Products counts sales for 7 days after the click, Brands and Display for 14.",
        columns: [
          { label: "Spend", unit: "currency" },
          { label: "Share of ad spend", unit: "percent" },
          { label: "Sales", unit: "currency" },
          { label: "ACOS", unit: "percent" },
          { label: "Orders", unit: "number" },
          { label: "Clicks", unit: "number" },
          { label: "Cost per click", unit: "price" },
        ],
        rows: [...types.map((t) => row(t.label, m(`${t.p}_spend`), m(`${t.p}_sales`), m(`${t.p}_orders`), m(`${t.p}_clicks`))), row("All ads", now.adSpend, m("ad_sales"), m("ad_orders"), m("ad_clicks"))],
      });
    }
  }
  if (platform === "tiktok_shop") {
    const split = (title: string, parts: { key: string; label: string }[], note?: string) => {
      if (!parts.some((p) => m(p.key) !== null)) return;
      tables.push({
        title,
        note,
        columns: [
          { label: "GMV", unit: "currency" },
          { label: "Share of GMV", unit: "percent" },
        ],
        rows: parts.map((p) => ({ label: p.label, cells: [m(p.key), div(m(p.key), now.revenue)] })),
      });
    };
    split("GMV by source", [
      { key: "affiliate_gmv", label: "Affiliate" },
      { key: "seller_gmv", label: "Seller" },
    ]);
    split("GMV by content", [
      { key: "live_gmv", label: "LIVE" },
      { key: "video_gmv", label: "Video" },
      { key: "card_gmv", label: "Product card" },
    ]);
  }
  return { platform, headlines, blocks, tables };
}

const csvCell = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

/** The table by period as a CSV: one column per metric, plain numbers (a ratio as a fraction), empty where there is no value. */
export function toCsv(platform: Platform, keys: string[], series: { keys: string[]; rows: Totals[] }): string {
  const header = ["Period", ...keys.map((k) => metricInfo(platform, k)?.label ?? k)].map(csvCell).join(",");
  const lines = series.keys.map((period, i) => [period, ...keys.map((k) => {
    const v = metricValue(platform, k, series.rows[i]);
    return v === null ? "" : String(Number(v.toFixed(4)));
  })].join(","));
  return [header, ...lines].join("\n");
}
