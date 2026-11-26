import { describe, expect, it } from "vitest";
import type { ChannelSaleInput } from "../omni/import-kinds";
import type { ChannelSale } from "../omni/types";
import { mergeRows, pulledInput, toInput } from "./channel-merge";

const have = (date: string, over: Partial<ChannelSale> = {}): ChannelSale => ({ date, channel: "amazon", retailer: "", revenue: 100, orders: 4, units: 5, adSpend: 10, source: "import", ...over });
const give = (date: string, over: Partial<ChannelSaleInput> = {}): ChannelSaleInput => ({ date, channel: "amazon", retailer: "", revenue: null, orders: null, units: null, adSpend: null, metrics: {}, source: "import", ...over });

describe("mergeRows", () => {
  it("changes only what the new row gives and keeps the rest of the day", () => {
    const out = mergeRows([have("2026-11-20", { metrics: { sessions: 40 } })], "amazon", [give("2026-11-20", { metrics: { sp_spend: 7, sp_sales: 30 } })]);
    expect(out).toEqual([have("2026-11-20", { metrics: { sessions: 40, sp_spend: 7, sp_sales: 30 } })]);
  });
  it("replaces a number that is given, including a zero", () => {
    const out = mergeRows([have("2026-11-20", { metrics: { sessions: 40 } })], "amazon", [give("2026-11-20", { revenue: 250, adSpend: 0, metrics: { sessions: 55 } })]);
    expect(out[0]).toMatchObject({ revenue: 250, orders: 4, units: 5, adSpend: 0 });
    expect(out[0].metrics).toEqual({ sessions: 55 });
  });
  it("starts a new day at zero for what was not given", () => {
    const out = mergeRows([], "amazon", [give("2026-11-21", { metrics: { sp_spend: 7 } })]);
    expect(out).toEqual([{ date: "2026-11-21", channel: "amazon", retailer: "", revenue: 0, orders: 0, units: 0, adSpend: 0, metrics: { sp_spend: 7 }, source: "import" }]);
  });
  it("leaves another retailer's row of the same day alone", () => {
    const out = mergeRows([have("2026-11-20", { retailer: "A" }), have("2026-11-20", { retailer: "B" })], "amazon", [give("2026-11-20", { retailer: "A", revenue: 1 })]);
    expect(out.find((r) => r.retailer === "A")?.revenue).toBe(1);
    expect(out.find((r) => r.retailer === "B")?.revenue).toBe(100);
  });
  it("gives the same result when the same rows are merged twice", () => {
    const rows = [give("2026-11-20", { revenue: 250, metrics: { sessions: 55 } }), give("2026-11-21", { metrics: { sp_spend: 7 } })];
    const once = mergeRows([have("2026-11-20")], "amazon", rows);
    expect(mergeRows(once, "amazon", rows)).toEqual(once);
  });
  it("returns the days in order and keeps a week-long row's length", () => {
    const out = mergeRows([have("2026-11-22", { periodDays: 7 })], "amazon", [give("2026-11-20", { revenue: 5 }), give("2026-11-22", { revenue: 9 })]);
    expect(out.map((r) => r.date)).toEqual(["2026-11-20", "2026-11-22"]);
    expect(out[1].periodDays).toBe(7);
  });
});

describe("toInput", () => {
  it("turns a full row into a row that gives every core number", () => {
    expect(toInput(have("2026-11-20", { metrics: { sessions: 1 } }))).toEqual({ date: "2026-11-20", channel: "amazon", retailer: "", revenue: 100, orders: 4, units: 5, adSpend: 10, metrics: { sessions: 1 }, source: "import" });
  });
});

describe("pulledInput", () => {
  it("gives revenue and orders only, so ad spend and units loaded from files survive a pull from the store's orders", () => {
    const pulled = pulledInput({ date: "2026-11-20", channel: "tiktok_shop", retailer: "", revenue: 300, orders: 9, units: 0, adSpend: 0, source: "shopify" });
    expect(pulled).toMatchObject({ revenue: 300, orders: 9, units: null, adSpend: null, metrics: {} });
    const out = mergeRows([have("2026-11-20", { channel: "tiktok_shop", adSpend: 55, units: 12, metrics: { ads_gmv: 200 } })], "tiktok_shop", [pulled]);
    expect(out[0]).toMatchObject({ revenue: 300, orders: 9, units: 12, adSpend: 55 });
    expect(out[0].metrics).toEqual({ ads_gmv: 200 });
  });
});
