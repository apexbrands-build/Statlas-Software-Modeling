import { describe, expect, it } from "vitest";
import { defaultSettings } from "../defaults";
import { emptyTotals } from "../metrics";
import { defaultExtra } from "../defaults";
import { adMetrics, attributionCaption, benchmark, CREATIVE_METRICS, daysLive, metricTone, storeMargin, sumFormats, trendLabel, wowChange, wowWindows, type AdAgg, type CreativeTotals, type FormatTotals } from "./best-creatives";

const win = (spend = 0, revenue = 0) => ({ spend, revenue });
const ad = (over: Partial<AdAgg> = {}): AdAgg => ({
  adId: "a1", name: "UGC 01", campaignName: "Prospecting", format: "video", isCatalog: false, status: "ACTIVE", launched: "2026-09-01", firstSpend: "2026-09-01", lastSpend: "2026-09-30",
  activeDays: 30, spend: 200, revenue: 600, purchases: 4, impressions: 10000, clicks: 150, cur: win(), prev: win(), ...over,
});
const totals = (over: Partial<CreativeTotals> = {}): CreativeTotals => ({ ads: 4, spend: 1000, revenue: 2500, purchases: 25, impressions: 50000, clicks: 500, cur: win(), prev: win(), ...over });

describe("adMetrics", () => {
  it("computes ROAS, CPA, CTR, CPM, estimated CM and share of spend", () => {
    const m = adMetrics(ad(), totals(), 0.5);
    expect(m.roas).toBe(3);
    expect(m.cpa).toBe(50);
    expect(m.ctr).toBeCloseTo(0.015, 10);
    expect(m.cpm).toBe(20);
    expect(m.estCm).toBe(100);
    expect(m.share).toBeCloseTo(0.2, 10);
    expect([m.spend, m.revenue, m.purchases]).toEqual([200, 600, 4]);
  });

  it("shows a dash (null), never 0 or infinity, where a ratio has nothing to divide by", () => {
    expect(adMetrics(ad({ purchases: 0 }), totals(), 0.5).cpa).toBeNull();
    expect(adMetrics(ad({ impressions: 0 }), totals(), 0.5)).toMatchObject({ ctr: null, cpm: null });
    expect(adMetrics(ad(), totals(), null).estCm).toBeNull();
  });

  it("ROAS is 0.00 when it spent and earned nothing, and null when it did not spend", () => {
    expect(adMetrics(ad({ revenue: 0 }), totals(), 0.5).roas).toBe(0);
    const none = adMetrics(ad({ spend: 0, revenue: 0, purchases: 0 }), totals(), 0.5);
    expect(none.roas).toBeNull();
    expect(none.cpa).toBeNull();
    expect(none.share).toBe(0);
  });

  it("share is 0 when the account has no spend at all", () => {
    expect(adMetrics(ad(), totals({ spend: 0 }), 0.5).share).toBe(0);
  });
});

describe("benchmark (the whole account for the period)", () => {
  it("uses account ratios and per-ad averages over the ads that spent", () => {
    const b = benchmark(totals(), 0.4);
    expect(b.roas).toBe(2.5);
    expect(b.cpa).toBe(40);
    expect(b.ctr).toBeCloseTo(0.01, 10);
    expect(b.cpm).toBe(20);
    expect([b.spend, b.revenue, b.purchases]).toEqual([250, 625, 6.25]);
    expect(b.estCm).toBeCloseTo(0, 10);
    expect(b.share).toBeNull();
  });

  it("is all null for an account with no ads that spent", () => {
    const b = benchmark(totals({ ads: 0, spend: 0, revenue: 0, purchases: 0, impressions: 0, clicks: 0 }), 0.4);
    expect(Object.values(b).every((v) => v === null)).toBe(true);
  });
});

describe("metricTone", () => {
  const bench = benchmark(totals(), 0.4);
  it("within 10% of the benchmark is neutral, beyond it good or bad by direction", () => {
    expect(metricTone("spend", 270, bench)).toBe("neutral");
    expect(metricTone("spend", 300, bench)).toBe("good");
    expect(metricTone("spend", 100, bench)).toBe("bad");
    expect(metricTone("cpa", 50, bench)).toBe("bad");
    expect(metricTone("cpa", 30, bench)).toBe("good");
  });
  it("share has no colour, and a missing value or benchmark is neutral", () => {
    expect(metricTone("share", 0.9, bench)).toBe("neutral");
    expect(metricTone("roas", null, bench)).toBe("neutral");
    expect(metricTone("roas", 3, benchmark(totals({ ads: 0 }), 0.4))).toBe("neutral");
  });
  it("lists CPA and CPM as lower-is-better and share as uncoloured", () => {
    expect(CREATIVE_METRICS.cpa.direction).toBe("down");
    expect(CREATIVE_METRICS.cpm.direction).toBe("down");
    expect(CREATIVE_METRICS.share.direction).toBe("none");
    expect(CREATIVE_METRICS.roas.direction).toBe("up");
  });
});

describe("storeMargin", () => {
  const settings = { ...defaultSettings("c"), otherVariablePct: 10, deliveryCostPerOrder: 0, cogsFlatRate: false, cogsFallbackPct: 0 };
  const t = { ...emptyTotals(), netSales: 800, shippingCollected: 100, newOrderRevenue: 1000, cogs: 300 };
  t.channels.meta_acquisition = { spend: 200, platformRevenue: 0, platformPurchases: 0 };

  it("is the margin before ads: (CM + ad spend) / order revenue", () => {
    expect(storeMargin(t, settings)).toBeCloseTo((800 + 100 - 300 - 90) / 1000, 10);
  });
  it("is null when the store had no order revenue", () => {
    expect(storeMargin(emptyTotals(), settings)).toBeNull();
  });
});

describe("sumFormats", () => {
  const f = (format: FormatTotals["format"], n: number): FormatTotals => ({ format, ads: n, spend: 100 * n, revenue: 300 * n, purchases: 3 * n, impressions: 1000 * n, clicks: 10 * n, cur: win(10 * n, 20 * n), prev: win(5 * n, 8 * n) });
  it("adds every field, including the two windows", () => {
    expect(sumFormats([f("video", 1), f("image", 2)])).toEqual({ ads: 3, spend: 300, revenue: 900, purchases: 9, impressions: 3000, clicks: 30, cur: win(30, 60), prev: win(15, 24) });
  });
  it("is all zero for no rows", () => {
    expect(sumFormats([])).toEqual({ ads: 0, spend: 0, revenue: 0, purchases: 0, impressions: 0, clicks: 0, cur: win(), prev: win() });
  });
});

describe("wowWindows", () => {
  it("two rolling 7-day windows ending on the earlier of the range end and the last day with ad data", () => {
    expect(wowWindows("2026-10-31", "2026-10-12")).toEqual({ cur: { from: "2026-10-06", to: "2026-10-12" }, prev: { from: "2026-09-29", to: "2026-10-05" } });
    expect(wowWindows("2026-10-10", "2026-10-12")).toEqual({ cur: { from: "2026-10-04", to: "2026-10-10" }, prev: { from: "2026-09-27", to: "2026-10-03" } });
  });
  it("is null when there is no ad data at all", () => {
    expect(wowWindows("2026-10-31", null)).toBeNull();
  });
});

describe("trendLabel, wowChange and daysLive", () => {
  const w = wowWindows("2026-10-31", "2026-10-12");
  const spender = (cur: number, prev: number, over: Partial<AdAgg> = {}) => ad({ launched: "2026-08-01", firstSpend: "2026-08-02", lastSpend: "2026-10-12", cur: win(cur), prev: win(prev), ...over });

  it("shows the week-over-week change in spend", () => {
    expect(trendLabel(spender(300, 200), w)).toBe("+50%");
    expect(trendLabel(spender(240, 300), w)).toBe("-20%");
    expect(wowChange(spender(300, 200))).toBeCloseTo(0.5, 10);
  });
  it("says New for an ad launched inside the current window", () => {
    expect(trendLabel(spender(300, 0, { launched: "2026-10-08" }), w)).toBe("New");
  });
  it("says Stopped for an ad that spent before but nothing in the current window", () => {
    expect(trendLabel(spender(0, 600, { lastSpend: "2026-10-04" }), w)).toBe("Stopped");
    expect(trendLabel(spender(0, 0, { lastSpend: "2026-09-10" }), w)).toBe("Stopped");
  });
  it("shows a dash with no base to compare with, and when there are no windows", () => {
    expect(trendLabel(spender(300, 0), w)).toBe("–");
    expect(wowChange(spender(300, 0))).toBeNull();
    expect(trendLabel(spender(300, 200), null)).toBe("–");
  });
  it("counts the days live from the launch (or first spend) to the last spend, and stops there for a paused ad", () => {
    expect(daysLive(ad({ launched: "2026-09-01", lastSpend: "2026-09-10" }))).toBe(10);
    expect(daysLive(ad({ launched: null, firstSpend: "2026-09-05", lastSpend: "2026-09-05" }))).toBe(1);
  });
});

describe("attributionCaption", () => {
  it("names the attribution window the synced numbers use", () => {
    expect(attributionCaption({ ...defaultExtra(), fbAttrClick: "7 Day", fbAttrView: "Disabled" })).toBe("Meta-reported, 7-day click");
    expect(attributionCaption({ ...defaultExtra(), fbAttrClick: "7 Day", fbAttrView: "1 Day" })).toBe("Meta-reported, 7-day click + 1-day view");
    expect(attributionCaption({ ...defaultExtra(), fbAttrClick: "1 Day", fbAttrView: "Disabled" })).toBe("Meta-reported, 1-day click");
  });
});
