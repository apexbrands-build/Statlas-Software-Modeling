import { describe, expect, it } from "vitest";
import { eachDay } from "../dates";
import type { OtherChannel } from "../types";
import type { MonthLine } from "./forecast";
import { spreadMonth } from "./forecast";
import type { ChannelDay } from "./types";
import { businessView, channelView, type SiteNumbers } from "./views";

const amazon: OtherChannel = { key: "amazon", label: "Amazon", kind: "marketplace", costPct: 65, aov: 30 };
const day = (revenue: number, adSpend = 0, orders = 0, units = 0): ChannelDay => ({ revenue, orders, units, adSpend });
/** March 2027: 31,000 forecast (1,000 a day), 6,200 of it credited to the ads. */
const line: MonthLine = { forecast: 31000, created: 6200, capped: false, adSpend: 3100, halo: 6200 };
const forecast = spreadMonth(31000, "2027-03-01", null);
const tenDays = new Map<string, ChannelDay>(Array.from({ length: 10 }, (_, i) => [`2027-03-${String(i + 1).padStart(2, "0")}`, day(1100, 100, 30, 40)]));

describe("channelView: one channel against its forecast", () => {
  const v = channelView({ channel: amazon, days: tenDays, forecast, lines: { "2027-03": line }, from: "2027-03-01", to: "2027-03-31" });
  it("adds up what the channel sold and spent", () => {
    expect(v.hasData).toBe(true);
    expect(v.lastData).toBe("2027-03-10");
    expect(v.revenue).toBe(11000);
    expect(v.adSpend).toBe(1000);
    expect(v.orders).toBe(300);
    expect(v.units).toBe(400);
    expect(v.roas).toBeCloseTo(11, 10);
  });
  it("takes contribution as revenue at the channel's margin, minus its ad spend", () => {
    expect(v.contribution).toBeCloseTo(11000 * 0.35 - 1000, 8);
  });
  it("compares only the days that have sales with the forecast, and projects the rest of the period", () => {
    expect(v.forecastToDate).toBeCloseTo(10000, 6);
    expect(v.forecastFull).toBeCloseTo(31000, 6);
    expect(v.pctToForecast).toBeCloseTo(1.1, 8);
    expect(v.projected).toBeCloseTo(11000 + 21000, 6);
  });
  it("credits the ads with the same share of actual sales as of the forecast", () => {
    expect(v.createdByAds).toBeCloseTo(11000 * 0.2, 6);
  });
  it("gives the chart a value per day: actual up to the last day with sales, forecast for every day", () => {
    expect(v.dates).toHaveLength(31);
    expect(v.actual[0]).toBe(1100);
    expect(v.actual[10]).toBeNull();
    expect(v.plan[30]).toBeCloseTo(1000, 8);
  });
});

describe("channelView: edges", () => {
  it("keeps the forecast when no sales are loaded", () => {
    const v = channelView({ channel: amazon, days: new Map(), forecast, lines: { "2027-03": line }, from: "2027-03-01", to: "2027-03-31" });
    expect(v.hasData).toBe(false);
    expect(v.revenue).toBe(0);
    expect(v.forecastFull).toBeCloseTo(31000, 6);
    expect(v.forecastToDate).toBeNull();
    expect(v.pctToForecast).toBeNull();
    expect(v.projected).toBeNull();
  });
  it("has no ROAS without ad spend, and contribution is revenue at the margin", () => {
    const days = new Map<string, ChannelDay>([["2027-03-01", day(1000)]]);
    const v = channelView({ channel: amazon, days, forecast: new Map(), lines: {}, from: "2027-03-01", to: "2027-03-31" });
    expect(v.roas).toBeNull();
    expect(v.contribution).toBeCloseTo(350, 8);
    expect(v.forecastFull).toBeNull();
    expect(v.createdByAds).toBeNull();
  });
  it("ignores days outside the range", () => {
    const days = new Map<string, ChannelDay>([["2027-02-28", day(999)], ["2027-03-01", day(100)]]);
    expect(channelView({ channel: amazon, days, forecast, lines: {}, from: "2027-03-01", to: "2027-03-31" }).revenue).toBe(100);
  });
  it("credits nothing to the ads in a month with no halo", () => {
    const v = channelView({ channel: amazon, days: tenDays, forecast, lines: { "2027-03": { ...line, created: 0, halo: 0 } }, from: "2027-03-01", to: "2027-03-31" });
    expect(v.createdByAds).toBeNull();
  });
});

describe("businessView: the own site plus every channel", () => {
  const site: SiteNumbers = { revenue: 80000, spend: 20000, cm: 16000, plan: { revenue: 78000, spend: 19000, cm: 15000 }, amer: 1.9, blendedAmer: 2.1 };
  const a = channelView({ channel: amazon, days: tenDays, forecast, lines: { "2027-03": line }, from: "2027-03-01", to: "2027-03-31" });
  const b = businessView(site, [a]);
  it("adds revenue, ad spend and contribution", () => {
    expect(b.revenue).toBe(91000);
    expect(b.spend).toBe(21000);
    expect(b.mer).toBeCloseTo(91000 / 21000, 10);
    expect(b.contribution).toBeCloseTo(16000 + a.contribution, 8);
  });
  it("adds the plan the same way, for the days with sales", () => {
    expect(b.plan!.revenue).toBeCloseTo(78000 + 10000, 6);
    expect(b.plan!.spend).toBeCloseTo(19000 + 1000, 6); // 3,100 planned for 31 days, 10 of them elapsed
    expect(b.plan!.contribution).toBeCloseTo(15000 + (10000 * 0.35 - 1000), 6);
  });
  it("lists the own site and each channel with its share of revenue", () => {
    expect(b.rows.map((r) => r.key)).toEqual(["site", "amazon"]);
    expect(b.rows[0]).toMatchObject({ actual: 80000, forecast: 78000 });
    expect(b.rows[0].share).toBeCloseTo(80000 / 91000, 10);
    expect(b.rows[1].pct).toBeCloseTo(1.1, 8);
    expect(b.rows[1].createdByAds).toBeCloseTo(2200, 6);
  });
  it("still has a plan when a channel has no forecast: that channel adds nothing to it", () => {
    const noLine = channelView({ channel: amazon, days: tenDays, forecast: new Map(), lines: {}, from: "2027-03-01", to: "2027-03-31" });
    const v = businessView(site, [noLine]);
    expect(v.plan!.revenue).toBe(78000);
    expect(v.rows[1].forecast).toBeNull();
  });
  it("has no plan when the own site has none", () => {
    expect(businessView({ ...site, plan: null }, [a]).plan).toBeNull();
  });
});

describe("channelView: a range the forecast covers only in part", () => {
  // February 2027 has a forecast (28,000, so 1,000 a day) and planned ad spend; March has neither. Sales run 1,000 a day through 15 March.
  const feb = spreadMonth(28000, "2027-02-01", null);
  const days = new Map<string, ChannelDay>();
  for (const d of eachDay("2027-02-01", "2027-03-15")) days.set(d, day(1000, 100));
  const v = channelView({ channel: amazon, days, forecast: feb, lines: { "2027-02": { forecast: 28000, created: 0, capped: false, adSpend: 2800, halo: 0 } }, from: "2027-02-01", to: "2027-03-15" });
  it("keeps every day in the totals", () => {
    expect(v.revenue).toBe(43000);
    expect(v.adSpend).toBe(4300);
  });
  it("compares only the days that have a forecast, so a month with none does not look like a win", () => {
    expect(v.forecastToDate).toBeCloseTo(28000, 6);
    expect(v.comparable!.revenue).toBe(28000);
    expect(v.comparable!.adSpend).toBe(2800);
    expect(v.comparable!.contribution).toBeCloseTo(28000 * 0.35 - 2800, 6);
    expect(v.pctToForecast).toBeCloseTo(1, 8);
  });
  it("says how many days with sales have no forecast", () => {
    expect(v.uncoveredDays).toBe(15);
  });
  it("has nothing to compare, and every day uncovered, with no forecast at all", () => {
    const none = channelView({ channel: amazon, days, forecast: new Map(), lines: {}, from: "2027-02-01", to: "2027-03-15" });
    expect(none.comparable).toBeNull();
    expect(none.uncoveredDays).toBe(43);
  });
  it("compares everything when the forecast covers every day with sales", () => {
    const all = channelView({ channel: amazon, days: tenDays, forecast, lines: { "2027-03": line }, from: "2027-03-01", to: "2027-03-31" });
    expect(all.uncoveredDays).toBe(0);
    expect(all.comparable!.revenue).toBe(all.revenue);
  });
  it("carries into the whole business: the plan is compared with the sales it covers, and the rest is named", () => {
    const b = businessView({ revenue: 80000, spend: 20000, cm: 16000, plan: { revenue: 78000, spend: 19000, cm: 15000 }, amer: 1.9, blendedAmer: null }, [v]);
    expect(b.revenue).toBe(123000);
    expect(b.plan!.revenue).toBeCloseTo(78000 + 28000, 6);
    expect(b.comparable.revenue).toBeCloseTo(80000 + 28000, 6);
    expect(b.comparable.spend).toBeCloseTo(20000 + 2800, 6);
    expect(b.uncoveredRevenue).toBeCloseTo(15000, 6);
  });
});
