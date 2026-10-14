import { describe, expect, it } from "vitest";
import { defaultSettings } from "./defaults";
import { aggregate, aggregatePlan, emptyTotals, METRICS, planAmerSpend } from "./metrics";
import { MER_SPECS } from "./reports/metric-spec";
import type { DailyFact, PlanTargetDay } from "./types";

const settings = { ...defaultSettings("c"), excludeBrandFromAmer: false, excludeMetaReturningFromAmer: false };
const planDay = (over: Partial<PlanTargetDay> = {}): PlanTargetDay => ({
  planId: "p", clientId: "c", date: "2026-10-05", orderRevenue: 900, newRevenue: 600, returningRevenue: 300, orders: 9, newOrders: 6, spend: 300, cm: 100,
  spendByChannel: { google_nonbrand: 150, google_brand: 100, meta_returning: 50 }, ...over,
});
const factWith = (spend: Partial<Record<keyof DailyFact["channels"], number>>): DailyFact => {
  const channels = emptyTotals().channels;
  for (const [k, v] of Object.entries(spend)) channels[k as keyof typeof channels] = { ...channels[k as keyof typeof channels], spend: v as number };
  return { clientId: "c", date: "2026-10-05", grossSales: 0, discounts: 0, netSales: 0, shippingCollected: 0, tax: 0, newOrderRevenue: 600, returningOrderRevenue: 300, newOrders: 6, returningOrders: 3, refunds: 0, cogs: 0, cogsUnmappedSales: 0, emailRevenue: 0, emailCampaignRevenue: 0, emailFlowRevenue: 0, emailOrders: 0, emailSent: 0, channels };
};

describe("plan acquisition spend", () => {
  it("aggregatePlan keeps brand search spend and retention spend apart", () => {
    const p = aggregatePlan([planDay(), planDay({ date: "2026-10-06" })]);
    expect(p.spend).toBe(600);
    expect(p.brandSpend).toBe(200);
    expect(p.retentionSpend).toBe(100);
  });

  it("counts every platform's returning spend as retention", () => {
    const p = aggregatePlan([planDay({ spendByChannel: { meta_returning: 10, pinterest_returning: 20, tiktok_returning: 30, google_nonbrand: 240 } })]);
    expect(p.retentionSpend).toBe(60);
    expect(p.brandSpend).toBe(0);
  });

  it("planAmerSpend leaves out brand and retention exactly as the actuals do, only when the client's settings say so", () => {
    const p = aggregatePlan([planDay()]);
    expect(planAmerSpend(p, settings)).toBe(300);
    expect(planAmerSpend(p, { ...settings, excludeBrandFromAmer: true })).toBe(200);
    expect(planAmerSpend(p, { ...settings, excludeMetaReturningFromAmer: true })).toBe(250);
    expect(planAmerSpend(p, { ...settings, excludeBrandFromAmer: true, excludeMetaReturningFromAmer: true })).toBe(150);
  });
});

describe("the aMER target and the aMER actual use the same spend", () => {
  const spend = { google_nonbrand: 150, google_brand: 100, meta_returning: 50 };
  const p = aggregatePlan([planDay()]);
  const t = aggregate([factWith(spend)]);

  for (const [name, s] of [
    ["no exclusions", settings],
    ["brand excluded", { ...settings, excludeBrandFromAmer: true }],
    ["brand and retention excluded", { ...settings, excludeBrandFromAmer: true, excludeMetaReturningFromAmer: true }],
  ] as const) {
    it(`Home's aMER target equals the actual for the same spend and revenue (${name})`, () => {
      expect(METRICS.amer.target!(p, s)).toBeCloseTo(METRICS.amer.value(t, s)!, 10);
    });
  }

  it("the Marketing Efficiency report's Acquisition Spend and Acquisition MER goals follow the same rule", () => {
    const s = { ...settings, excludeBrandFromAmer: true };
    const acqSpend = MER_SPECS.find((m) => m.key === "acqSpend")!;
    const amer = MER_SPECS.find((m) => m.key === "amer")!;
    expect(acqSpend.goal!(p, s)).toBe(acqSpend.value(t, s));
    expect(amer.goal!(p, s)).toBeCloseTo(amer.value(t, s)!, 10);
  });

  it("MER and weighted CAC keep using total spend", () => {
    const s = { ...settings, excludeBrandFromAmer: true };
    expect(METRICS.mer.target!(p, s)).toBeCloseTo(900 / 300, 10);
    expect(METRICS.weightedCac.target!(p, s)).toBeCloseTo(300 / 6, 10);
  });
});
