import { describe, expect, it } from "vitest";
import { emptyTotals } from "../metrics";
import type { DailyFact } from "../types";
import { buildNewVsReturning, NVR_COLUMNS } from "./new-vs-returning";

const day = (date: string, over: Partial<DailyFact> = {}): DailyFact => ({
  clientId: "c", date, grossSales: 1000, discounts: 100, netSales: 860, shippingCollected: 50, tax: 180, newOrderRevenue: 800, returningOrderRevenue: 330, newOrders: 8, returningOrders: 3, refunds: 40, cogs: 250, cogsUnmappedSales: 0, emailRevenue: 0, emailCampaignRevenue: 0, emailFlowRevenue: 0, emailOrders: 0, emailSent: 0, channels: emptyTotals().channels, ...over,
});
const noOrders = (date: string) => day(date, { newOrderRevenue: 0, returningOrderRevenue: 0, newOrders: 0, returningOrders: 0 });

describe("buildNewVsReturning", () => {
  it("builds the new, returning and total lines for one day", () => {
    const t = buildNewVsReturning([day("2026-09-01")], "daily");
    expect(t.rows[0].v).toMatchObject({ newOrders: 8, newRevenue: 800, newAov: 100, retOrders: 3, retRevenue: 330, retAov: 110, totalOrders: 11, totalRevenue: 1130 });
    expect(t.rows[0].v.totalAov).toBeCloseTo(1130 / 11, 6);
    expect(t.rows[0].v.pctFirstTime).toBeCloseTo(8 / 11, 6);
    expect(t.rows[0].v.pctReturning).toBeCloseTo(3 / 11, 6);
  });

  it("leaves the revenue change empty on the first row and compares later rows with the previous one", () => {
    const t = buildNewVsReturning([day("2026-09-01"), day("2026-09-02", { newOrderRevenue: 880 })], "daily");
    expect(t.rows[0].v.newRevenueChange).toBeNull();
    expect(t.rows[0].v.totalRevenueChange).toBeNull();
    expect(t.rows[1].v.newRevenueChange).toBeCloseTo(0.1, 6);
    expect(t.rows[1].v.retRevenueChange).toBeCloseTo(0, 6);
    expect(t.rows[1].v.totalRevenueChange).toBeCloseTo(1210 / 1130 - 1, 6);
  });

  it("sums the total row, computes AOVs from the sums and leaves the changes empty", () => {
    const t = buildNewVsReturning([day("2026-09-01"), day("2026-09-02")], "daily");
    expect(t.total.v).toMatchObject({ newOrders: 16, newRevenue: 1600, newAov: 100, retOrders: 6, retRevenue: 660, totalOrders: 22, totalRevenue: 2260 });
    expect(t.total.v.newRevenueChange).toBeNull();
    expect(t.total.v.retRevenueChange).toBeNull();
    expect(t.total.v.totalRevenueChange).toBeNull();
  });

  it("shows no AOV or share for a bucket without orders, and no change against a zero previous row", () => {
    const t = buildNewVsReturning([day("2026-09-01"), noOrders("2026-09-02"), day("2026-09-03")], "daily");
    const empty = t.rows[1].v;
    expect(empty.newAov).toBeNull();
    expect(empty.totalAov).toBeNull();
    expect(empty.pctFirstTime).toBeNull();
    expect(empty.pctReturning).toBeNull();
    expect(empty.newRevenueChange).toBeCloseTo(-1, 6);
    expect(t.rows[2].v.newRevenueChange).toBeNull();
  });

  it("makes the two shares add to 100% for every bucket with orders", () => {
    const t = buildNewVsReturning([day("2026-09-01"), day("2026-09-02", { newOrders: 1, newOrderRevenue: 100 })], "daily");
    for (const r of t.rows) expect(r.v.pctFirstTime! + r.v.pctReturning!).toBeCloseTo(1, 9);
  });

  it("returns no rows and a total without NaN for an empty range", () => {
    const t = buildNewVsReturning([], "daily");
    expect(t.rows).toEqual([]);
    expect(t.total.v.totalOrders).toBe(0);
    expect(t.total.v.totalAov).toBeNull();
    for (const value of Object.values(t.total.v)) expect(Number.isNaN(value)).toBe(false);
  });

  it("lists the columns in order and does not colour the two shares", () => {
    expect(NVR_COLUMNS.map((c) => c.key)).toEqual([
      "newOrders", "newRevenue", "newRevenueChange", "newAov",
      "retOrders", "retRevenue", "retRevenueChange", "retAov",
      "totalOrders", "totalRevenue", "totalRevenueChange", "totalAov",
      "pctFirstTime", "pctReturning",
    ]);
    for (const k of ["pctFirstTime", "pctReturning"]) expect(NVR_COLUMNS.find((c) => c.key === k)!.direction).toBe("none");
  });
});
