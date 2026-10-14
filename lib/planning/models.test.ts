import { describe, expect, it } from "vitest";
import { acqShare, cohortMultipliers, DEFAULT_RETURNING, recentNewAov, recentReturningAov, resolveReturningAov } from "./models";
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
    expect(cohortMultipliers([], "2026-09-30")).toEqual({ ltv60: null, ltv90: null, ltv365: null });
  });
});

describe("90-day LTV multiplier", () => {
  const stats = [
    { month: "2025-01-01", customers: 100, firstRevenue: 10000, rev60d: 1000, rev90d: 1500, rev365d: 2500 },
    { month: "2025-02-01", customers: 100, firstRevenue: 10000, rev60d: 1400, rev90d: 2100, rev365d: 3500 },
    { month: "2026-08-01", customers: 100, firstRevenue: 10000, rev60d: 100, rev90d: 150, rev365d: 150 },
  ];

  it("uses cohorts that have had 90 days after their month ended", () => {
    expect(cohortMultipliers(stats, "2026-09-30").ltv90).toBeCloseTo(1 + 3600 / 20000, 4); // the August 2026 cohort is too young
    expect(cohortMultipliers(stats, "2026-12-15").ltv90).toBeCloseTo(1 + 3750 / 30000, 4); // 2026-08-31 + 90 days = 2026-11-29, so it counts
  });

  it("gives no 90-day multiplier for cohorts stored before the 90-day figure existed", () => {
    const old = stats.map((c) => ({ month: c.month, customers: c.customers, firstRevenue: c.firstRevenue, rev60d: c.rev60d, rev365d: c.rev365d }));
    expect(cohortMultipliers(old, "2026-09-30").ltv90).toBeNull();
  });
});

describe("acqShare", () => {
  it("removes every platform's non-acquisition spend when the retention setting is on", () => {
    const inputs = { platformPct: { meta: 50, pinterest: 50 }, altPct: { meta: 20, pinterest: 40 } };
    expect(acqShare(inputs, { excludeBrandFromAmer: false, excludeMetaReturningFromAmer: true })).toBeCloseTo(0.7, 9);
    expect(acqShare(inputs, { excludeBrandFromAmer: false, excludeMetaReturningFromAmer: false })).toBe(1);
  });

  it("treats Google's alternative share as brand, controlled only by the brand setting", () => {
    const inputs = { platformPct: { google: 50, meta: 50 }, altPct: { google: 40, meta: 0 } };
    expect(acqShare(inputs, { excludeBrandFromAmer: false, excludeMetaReturningFromAmer: true })).toBe(1);
    expect(acqShare(inputs, { excludeBrandFromAmer: true, excludeMetaReturningFromAmer: false })).toBeCloseTo(0.8, 9);
  });
});

const ret = (date: string, rev: number, orders: number): DailyFact => ({ ...fact(date, 0, 0), returningOrderRevenue: rev, returningOrders: orders });

describe("returning customer AOV", () => {
  const facts = [ret("2026-01-01", 900, 10), ret("2026-09-30", 1200, 10), ret("2026-10-01", 1800, 10)];

  it("is returning revenue over returning orders in the last N days only", () => {
    expect(recentReturningAov(facts, "2026-10-01", 30)).toBe(150);
    expect(recentReturningAov(facts, "2026-10-01", 365)).toBeCloseTo(3900 / 30, 6);
  });

  it("is null when there were no returning orders in the window", () => {
    expect(recentReturningAov([fact("2026-10-01", 1000, 10)], "2026-10-01", 30)).toBeNull();
    expect(recentReturningAov([], "2026-10-01", 30)).toBeNull();
  });

  it("defaults to the last 30 days and follows the chosen window", () => {
    expect(DEFAULT_RETURNING.aovSource).toBe("last30");
    expect(resolveReturningAov({ aovSource: "last30" }, facts, "2026-10-01")).toBe(150);
    expect(resolveReturningAov({ aovSource: "last365" }, facts, "2026-10-01")).toBeCloseTo(130, 6);
    expect(resolveReturningAov({}, facts, "2026-10-01")).toBe(150);
  });

  it("uses the typed value when Manual, and falls back when the window is empty", () => {
    expect(resolveReturningAov({ aovSource: "manual", aov: 99 }, facts, "2026-10-01")).toBe(99);
    expect(resolveReturningAov({ aovSource: "last30", aov: 80 }, [], "2026-10-01", 70)).toBe(80);
    expect(resolveReturningAov({ aovSource: "last30" }, [], "2026-10-01", 70)).toBe(70);
    expect(resolveReturningAov({ aovSource: "manual" }, facts, "2026-10-01", 70)).toBe(70);
  });
});
