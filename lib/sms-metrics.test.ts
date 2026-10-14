import { describe, expect, it } from "vitest";
import { defaultSettings } from "./defaults";
import { aggregate, aggregatePlan, METRICS } from "./metrics";
import { inputsFromFacts } from "./planning/history";
import type { MixOf } from "./planning/mix";
import { CHANNEL_KEYS, type DailyFact, type PlanTargetDay } from "./types";

const settings = defaultSettings("c");
const channels = Object.fromEntries(CHANNEL_KEYS.map((k) => [k, { spend: 0, platformRevenue: 0, platformPurchases: 0 }])) as DailyFact["channels"];
function fact(over: Partial<DailyFact> = {}): DailyFact {
  return {
    clientId: "c", date: "2026-09-01", grossSales: 1000, discounts: 0, netSales: 1000, shippingCollected: 0, tax: 0,
    newOrderRevenue: 600, returningOrderRevenue: 400, newOrders: 6, returningOrders: 4, refunds: 0, cogs: 0, cogsUnmappedSales: 0,
    emailRevenue: 100, emailCampaignRevenue: 60, emailFlowRevenue: 40, emailOrders: 2, emailSent: 5000, channels, ...over,
  };
}
const sms = { smsRevenue: 80, smsCampaignRevenue: 50, smsFlowRevenue: 30, smsOrders: 2, smsSent: 4000 };

describe("SMS totals", () => {
  it("add up across days, and a day without SMS data counts as zero", () => {
    const t = aggregate([fact(sms), fact(sms), fact()]);
    expect(t.smsRevenue).toBe(160);
    expect(t.smsCampaignRevenue).toBe(100);
    expect(t.smsFlowRevenue).toBe(60);
    expect(t.smsOrders).toBe(4);
    expect(t.smsSent).toBe(8000);
  });
});

describe("SMS metrics on Home", () => {
  const t = aggregate([fact(sms)]);
  it("show revenue, orders, campaign and flow revenue and revenue per 1K sent", () => {
    expect(METRICS.smsRevenue.value(t, settings)).toBe(80);
    expect(METRICS.smsOrders.value(t, settings)).toBe(2);
    expect(METRICS.smsCampaignRevenue.value(t, settings)).toBe(50);
    expect(METRICS.smsFlowRevenue.value(t, settings)).toBe(30);
    expect(METRICS.smsRevPer1k.value(t, settings)).toBeCloseTo(20, 8); // 80 / (4000 / 1000)
  });
  it("revenue per 1K has no value when nothing was sent", () => {
    expect(METRICS.smsRevPer1k.value(aggregate([fact()]), settings)).toBeNull();
  });
  it("the revenue tile is additive and compares with the planned SMS revenue", () => {
    const day: PlanTargetDay = { planId: "p", clientId: "c", date: "2026-11-10", orderRevenue: 1000, newRevenue: 600, returningRevenue: 400, orders: 10, newOrders: 6, spend: 100, cm: 50, spendByChannel: {} };
    const mixOf: MixOf = (_d, key) => (key === "sms" ? 0.05 : null);
    expect(METRICS.smsRevenue.additive).toBe(true);
    expect(METRICS.smsRevenue.target!(aggregatePlan([day], undefined, mixOf), settings)).toBeCloseTo(50, 8);
    expect(METRICS.smsRevenue.target!(aggregatePlan([day]), settings)).toBeNull();
  });
});

describe("organic revenue with SMS", () => {
  it("leaves out SMS revenue and SMS orders next to email, as the default definition says", () => {
    const t = aggregate([fact(sms)]);
    expect(METRICS.organicRevenue.value(t, settings)).toBe(1000 - 100 - 80);
    expect(METRICS.organicOrders.value(t, settings)).toBe(10 - 2 - 2);
    expect(METRICS.organicAov.value(t, settings)).toBeCloseTo(820 / 6, 8);
  });
});

describe("organic as a percentage of total revenue", () => {
  const t = aggregate([fact(sms)]);
  const day = (date: string, revenue: number): PlanTargetDay => ({ planId: "p", clientId: "c", date, orderRevenue: revenue, newRevenue: revenue * 0.6, returningRevenue: revenue * 0.4, orders: 10, newOrders: 6, spend: 100, cm: 50, spendByChannel: {} });
  const mixOf: MixOf = (date, key) => (date.startsWith("2026-11") && key === "organic" ? 0.25 : null);

  it("divides organic revenue by order revenue", () => {
    expect(METRICS.organicPctOfRevenue.value(t, settings)).toBeCloseTo(0.82, 8);
  });
  it("has no value on a day without revenue", () => {
    expect(METRICS.organicPctOfRevenue.value(aggregate([fact({ grossSales: 0, netSales: 0, newOrderRevenue: 0, returningOrderRevenue: 0, emailRevenue: 0 })]), settings)).toBeNull();
  });
  it("targets the planned organic share, and nothing when the plan does not set one", () => {
    expect(METRICS.organicPctOfRevenue.target!(aggregatePlan([day("2026-11-10", 1000), day("2026-11-11", 3000)], undefined, mixOf), settings)).toBeCloseTo(0.25, 8);
    expect(METRICS.organicPctOfRevenue.target!(aggregatePlan([day("2026-12-10", 1000)], undefined, mixOf), settings)).toBeNull();
  });
  it("replaces the old organic-to-paid ratio", () => {
    expect((METRICS as Record<string, unknown>).organicPctOfPaid).toBeUndefined();
  });
});

describe("the plan's starting mix from history", () => {
  const f = (over: Partial<DailyFact> = {}) => fact({ date: "2025-09-01", ...over });
  it("carries SMS as a share of order revenue and takes it out of organic", () => {
    // order revenue 1000: email 100 (10%), SMS 80 (8%), organic 820 (82%)
    const i = inputsFromFacts([f(sms)], 1, settings, "last_year")!;
    expect(i.mix?.emailPct).toBeCloseTo(10, 2);
    expect(i.mix?.smsPct).toBeCloseTo(8, 2);
    expect(i.mix?.organicPct).toBeCloseTo(82, 2);
  });
  it("leaves SMS out when the client has no SMS revenue (no data is not 0%)", () => {
    expect(inputsFromFacts([f()], 1, settings, "last_year")!.mix?.smsPct).toBeUndefined();
  });
});
