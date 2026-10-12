import { describe, expect, it } from "vitest";
import { addDays } from "../dates";
import { aggregate, emptyTotals, orderRevenue } from "../metrics";
import type { DailyFact } from "../types";
import { buildRevenueOverview, REVENUE_COLUMNS } from "./revenue-overview";

const day = (date: string, over: Partial<DailyFact> = {}): DailyFact => ({
  clientId: "c", date, grossSales: 1000, discounts: 100, netSales: 860, shippingCollected: 50, tax: 180, newOrderRevenue: 800, returningOrderRevenue: 330, newOrders: 8, returningOrders: 3, refunds: 40, cogs: 250, cogsUnmappedSales: 0, emailRevenue: 0, emailCampaignRevenue: 0, emailFlowRevenue: 0, emailOrders: 0, emailSent: 0, channels: emptyTotals().channels, ...over,
});
const second = (date: string) => day(date, { grossSales: 500, discounts: 50, netSales: 440, shippingCollected: 20, tax: 90, newOrderRevenue: 400, returningOrderRevenue: 160, newOrders: 4, returningOrders: 2, refunds: 10 });

describe("buildRevenueOverview", () => {
  it("builds every line for one day", () => {
    const t = buildRevenueOverview([day("2026-09-01")], "daily");
    expect(t.rows[0].v).toMatchObject({ orders: 11, grossSales: 1000, discounts: -100, discountedSales: 900, returns: -40, netSales: 860, shipping: 50, tax: 180, totalSales: 1090, orderRevenue: 1130 });
  });

  it("keeps the identities between lines on a grouped range", () => {
    const facts = [day("2026-09-07"), second("2026-09-08")];
    const t = buildRevenueOverview(facts, "weekly");
    const v = t.rows[0].v;
    expect(v.discountedSales! + v.returns!).toBeCloseTo(v.netSales!, 6);
    expect(v.netSales! + v.shipping! + v.tax!).toBeCloseTo(v.totalSales!, 6);
    expect(t.total.v.orderRevenue).toBeCloseTo(orderRevenue(aggregate(facts)), 6);
    expect(t.total.v.orders).toBe(17);
  });

  it("returns no rows and a zero total for an empty range", () => {
    const t = buildRevenueOverview([], "daily");
    expect(t.rows).toEqual([]);
    for (const value of Object.values(t.total.v)) expect(value).toBe(0);
  });

  it("groups by month", () => {
    const facts = Array.from({ length: 40 }, (_, i) => day(addDays("2026-09-01", i)));
    const t = buildRevenueOverview(facts, "monthly");
    expect(t.rows.map((r) => r.label)).toEqual(["2026-09", "2026-10"]);
    expect(t.rows[0].v.grossSales).toBe(30000);
  });

  it("lists the columns in order and never colours shipping or tax", () => {
    expect(REVENUE_COLUMNS.map((c) => c.key)).toEqual(["orders", "grossSales", "discounts", "discountedSales", "returns", "netSales", "shipping", "tax", "totalSales", "orderRevenue"]);
    for (const k of ["shipping", "tax"]) expect(REVENUE_COLUMNS.find((c) => c.key === k)!.direction).toBe("none");
    expect(REVENUE_COLUMNS.find((c) => c.key === "orderRevenue")!.direction).toBe("up");
  });
});
