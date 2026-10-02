import { describe, expect, it } from "vitest";
import { cohortMultipliers, recentNewAov } from "./models";
import type { DailyFact } from "../types";

const fact = (date: string, newRev: number, newOrders: number): DailyFact =>
  ({ clientId: "c", date, grossSales: 0, discounts: 0, netSales: 0, shippingCollected: 0, tax: 0, newOrderRevenue: newRev, returningOrderRevenue: 0, newOrders, returningOrders: 0, refunds: 0, cogs: 0, cogsUnmappedSales: 0, emailRevenue: 0, emailCampaignRevenue: 0, emailFlowRevenue: 0, emailOrders: 0, emailSent: 0, channels: {} as DailyFact["channels"] }) as DailyFact;

describe("model inputs", () => {
  it("AOV of new customers over the last N days only", () => {
    const facts = [fact("2026-01-01", 1000, 10), fact("2026-09-30", 900, 10), fact("2026-10-01", 1100, 10)];
    expect(recentNewAov(facts, "2026-10-01", 30)).toBe(100);
    expect(recentNewAov(facts, "2026-10-01", 365)).toBeCloseTo(3000 / 30, 6);
    expect(recentNewAov([], "2026-10-01", 30)).toBeNull();
  });

  it("LTV multipliers only use cohorts that have had the full time", () => {
    const stats = [
      { month: "2025-01-01", customers: 100, firstRevenue: 10000, rev60d: 1000, rev365d: 2500 },
      { month: "2025-02-01", customers: 100, firstRevenue: 10000, rev60d: 1400, rev365d: 3500 },
      { month: "2026-08-01", customers: 100, firstRevenue: 10000, rev60d: 500, rev365d: 500 }, // too young for 365, 60-day not complete either at 2026-09-30
    ];
    const m = cohortMultipliers(stats, "2026-09-30");
    expect(m.ltv365).toBeCloseTo(1 + 6000 / 20000, 4); // Jan + Feb only
    expect(m.ltv60).toBeCloseTo(1 + 2400 / 20000, 4);
    expect(cohortMultipliers([], "2026-09-30")).toEqual({ ltv60: null, ltv365: null });
  });
});
