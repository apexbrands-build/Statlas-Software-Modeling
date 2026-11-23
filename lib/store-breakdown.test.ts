import { describe, expect, it } from "vitest";
import { breakdown, presetRange, PRESETS } from "./store-breakdown";

describe("store breakdown (laid out like Shopify's Total sales breakdown)", () => {
  const rows = [
    { date: "2026-11-20", gross_sales: "100", discounts: "10", refunds: "0", net_sales: "90", shipping_collected: "5", tax: "9", new_orders: 1, returning_orders: 0, new_order_revenue: "104", returning_order_revenue: "0" },
    { date: "2026-11-21", gross_sales: "200.5", discounts: "0", refunds: "20", net_sales: "180.5", shipping_collected: "0", tax: "18.05", new_orders: 1, returning_orders: 2, new_order_revenue: "50", returning_order_revenue: "168.55" },
  ];
  it("adds the days up and derives total sales = net sales + shipping + taxes", () => {
    const b = breakdown(rows);
    expect(b.grossSales).toBeCloseTo(300.5);
    expect(b.discounts).toBeCloseTo(10);
    expect(b.returns).toBeCloseTo(20);
    expect(b.netSales).toBeCloseTo(270.5);
    expect(b.shipping).toBeCloseTo(5);
    expect(b.taxes).toBeCloseTo(27.05);
    expect(b.totalSales).toBeCloseTo(302.55);
    expect(b.orders).toBe(4);
    expect(b.newOrders).toBe(2);
    expect(b.returningOrders).toBe(2);
    expect(b.newRevenue).toBeCloseTo(154);
    expect(b.returningRevenue).toBeCloseTo(168.55);
  });
  it("is all zeros for no rows", () => {
    expect(breakdown([]).totalSales).toBe(0);
    expect(breakdown([]).orders).toBe(0);
  });
  it("treats nulls as zero", () => {
    expect(breakdown([{ date: "2026-11-20", gross_sales: null, discounts: null, refunds: null, net_sales: null, shipping_collected: null, tax: null, new_orders: null, returning_orders: null, new_order_revenue: null, returning_order_revenue: null }]).totalSales).toBe(0);
  });
});

describe("date presets, in the store's own calendar", () => {
  const today = "2026-11-23";
  it("today and yesterday", () => {
    expect(presetRange("today", today)).toEqual({ from: "2026-11-23", to: "2026-11-23" });
    expect(presetRange("yesterday", today)).toEqual({ from: "2026-11-22", to: "2026-11-22" });
  });
  it("last 7 and last 30 days include today", () => {
    expect(presetRange("last7", today)).toEqual({ from: "2026-11-17", to: "2026-11-23" });
    expect(presetRange("last30", today)).toEqual({ from: "2026-10-25", to: "2026-11-23" });
  });
  it("month to date", () => {
    expect(presetRange("mtd", today)).toEqual({ from: "2026-11-01", to: "2026-11-23" });
  });
  it("falls back to the last 30 days for an unknown preset", () => {
    expect(presetRange("nonsense", today)).toEqual(presetRange("last30", today));
    expect(PRESETS.map((p) => p.key)).toContain("last30");
  });
});
