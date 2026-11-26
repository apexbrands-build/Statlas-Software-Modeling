import { describe, expect, it } from "vitest";
import type { OtherChannel } from "../types";
import type { PeriodTotals } from "./channel-metrics";
import { channelPage, DEFAULT_COLUMNS, toCsv } from "./channel-page";
import type { ChannelView } from "./views";

const totals = (core: Partial<PeriodTotals>, m: Record<string, number> = {}): PeriodTotals => ({ revenue: 0, orders: 0, units: 0, adSpend: 0, days: 10, lastData: "2026-11-10", ...core, m });
const view = (over: Partial<ChannelView> = {}): ChannelView => ({
  key: "amazon", label: "Amazon", hasData: true, lastData: "2026-11-10", revenue: 1000, orders: 40, units: 50, adSpend: 100, roas: 10, contribution: 280,
  forecastToDate: 900, forecastFull: 2700, pctToForecast: 1000 / 900, comparable: { revenue: 1000, adSpend: 100, contribution: 280 }, uncoveredDays: 0, projected: 2800,
  planAdSpendToDate: 90, planContributionToDate: 252, createdByAds: 120, dates: [], actual: [], plan: [], ...over,
});
const amazon: OtherChannel = { key: "amazon", label: "Amazon", kind: "marketplace", platform: "amazon", costPct: 62, aov: 38 };
const tts: OtherChannel = { key: "tiktok_shop", label: "TikTok Shop", kind: "marketplace", platform: "tiktok_shop", costPct: 70, aov: 29 };

const amazonNow = totals({ revenue: 1000, orders: 40, units: 50, adSpend: 100 }, { ad_sales: 400, sp_spend: 70, sb_spend: 20, sd_spend: 10, sp_sales: 300, sb_sales: 80, sd_sales: 20, sp_orders: 8, sp_clicks: 70, sessions: 250, page_views: 330, buy_box_views: 320 });
const amazonPrev = totals({ revenue: 800, orders: 30, units: 40, adSpend: 100 }, { ad_sales: 300, sessions: 220 });

describe("channelPage, Amazon", () => {
  const page = channelPage({ platform: "amazon", channel: amazon, view: view(), now: amazonNow, prev: amazonPrev });
  const head = (key: string) => page.headlines.find((h) => h.key === key);

  it("leads with contribution, then sales, ad spend and total ACOS, each against the forecast", () => {
    expect(page.headlines.slice(0, 4).map((h) => h.key)).toEqual(["contribution", "revenue", "adSpend", "tacos"]);
    expect(head("contribution")).toMatchObject({ value: 280, cmp: 280, ref: 252, refWord: "forecast", better: "up" });
    expect(head("revenue")).toMatchObject({ label: "Ordered product sales", value: 1000, ref: 900, refWord: "forecast" });
    expect(head("adSpend")).toMatchObject({ value: 100, ref: 90, refWord: "planned" });
    expect(head("tacos")?.value).toBeCloseTo(0.1);
    expect(head("tacos")).toMatchObject({ ref: 0.1, refWord: "planned", better: "down" });
    expect(head("tacos")?.also).toBe("MER 10.00");
  });
  it("falls back to the same days last year when the plan has no forecast", () => {
    const p = channelPage({ platform: "amazon", channel: amazon, view: view({ forecastToDate: null, forecastFull: null, comparable: null, planAdSpendToDate: null, planContributionToDate: null }), now: amazonNow, prev: amazonPrev });
    const h = (key: string) => p.headlines.find((x) => x.key === key);
    expect(h("revenue")).toMatchObject({ ref: 800, refWord: "last year", cmp: 1000 });
    expect(h("contribution")?.ref).toBeCloseTo(800 * 0.38 - 100);
    expect(h("tacos")?.ref).toBeCloseTo(0.125);
    expect(h("tacos")?.refWord).toBe("last year");
  });
  it("has no reference at all with neither a forecast nor last year", () => {
    const p = channelPage({ platform: "amazon", channel: amazon, view: view({ forecastToDate: null, comparable: null, planAdSpendToDate: null, planContributionToDate: null }), now: amazonNow, prev: null });
    expect(p.headlines.every((h) => h.ref === null && h.refWord === null)).toBe(true);
  });
  it("shows ACOS, the halo and orders after the first four", () => {
    expect(head("acos")?.value).toBeCloseTo(0.25);
    expect(head("acos")).toMatchObject({ ref: 100 / 300, refWord: "last year" });
    expect(head("halo")).toMatchObject({ value: 120, ref: null });
    expect(head("orders")).toMatchObject({ value: 40, also: "50 units" });
  });
  it("splits ads by type, and the types add up to the ad spend", () => {
    const t = page.tables.find((x) => x.title === "Ads by type");
    expect(t?.rows.map((r) => r.label)).toEqual(["Sponsored Products", "Sponsored Brands", "Sponsored Display", "All ads"]);
    const spend = t!.rows.slice(0, 3).reduce((a, r) => a + (r.cells[0] ?? 0), 0);
    expect(spend).toBe(100);
    expect(t!.rows[3].cells[0]).toBe(100);
    expect(t!.rows[0].cells[3]).toBeCloseTo(70 / 300);
  });
  it("leaves out a number nobody loaded, and a block with nothing in it", () => {
    const traffic = page.blocks.find((b) => b.title === "Sales and traffic");
    expect(traffic?.rows.map((r) => r.key)).toEqual(["sessions", "conversion", "buy_box_pct", "asp"]);
    expect(traffic?.rows[0]).toMatchObject({ value: 250, prev: 220 });
    expect(page.blocks.find((b) => b.title === "Subscriptions")).toBeUndefined();
  });
});

describe("channelPage, TikTok Shop", () => {
  const now = totals({ revenue: 2000, orders: 80, units: 100, adSpend: 100 }, { affiliate_gmv: 1200, seller_gmv: 800, live_gmv: 200, video_gmv: 1300, card_gmv: 500, ads_gmv: 500, ads_orders: 20, refunds: 60, visitors: 4000, creators_with_sales: 50 });
  const page = channelPage({ platform: "tiktok_shop", channel: tts, view: view({ key: "tiktok_shop", label: "TikTok Shop", revenue: 2000, adSpend: 100, contribution: 500, createdByAds: null }), now, prev: null });
  it("names sales GMV and reads shop ads as a share of GMV first, ROI second", () => {
    expect(page.headlines.find((h) => h.key === "revenue")?.label).toBe("GMV");
    expect(page.headlines.find((h) => h.key === "ads_cost_share")?.value).toBeCloseTo(0.05);
    expect(page.headlines.find((h) => h.key === "ads_roi")?.value).toBe(5);
    expect(page.headlines.find((h) => h.key === "halo")).toBeUndefined();
  });
  it("shows where the GMV came from, by source and by content", () => {
    expect(page.tables.find((t) => t.title === "GMV by source")?.rows.map((r) => [r.label, r.cells[0]])).toEqual([["Affiliate", 1200], ["Seller", 800]]);
    expect(page.tables.find((t) => t.title === "GMV by content")?.rows.map((r) => r.label)).toEqual(["LIVE", "Video", "Product card"]);
    expect(page.tables.find((t) => t.title === "GMV by source")?.rows[0].cells[1]).toBeCloseTo(0.6);
  });
});

describe("toCsv", () => {
  it("writes a header and one line per period, empty where there is no value", () => {
    const series = { keys: ["2026-11-01", "2026-11-02"], rows: [totals({ revenue: 100, adSpend: 10, units: 5 }, { sessions: 20 }), totals({ revenue: 0 })] };
    const csv = toCsv("amazon", ["revenue", "tacos", "sessions"], series).split("\n");
    expect(csv[0]).toBe("Period,Ordered product sales,Total ACOS,Sessions");
    expect(csv[1]).toBe("2026-11-01,100,0.1,20");
    expect(csv[2]).toBe("2026-11-02,0,,");
    expect(DEFAULT_COLUMNS.amazon).toContain("tacos");
    expect(DEFAULT_COLUMNS.tiktok_shop).toContain("affiliate_gmv");
  });
});
