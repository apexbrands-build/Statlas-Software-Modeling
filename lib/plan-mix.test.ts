import { describe, expect, it } from "vitest";
import { defaultSettings } from "./defaults";
import { aggregatePlan, METRICS } from "./metrics";
import type { MixOf } from "./planning/mix";
import type { PlanTargetDay } from "./types";

const settings = defaultSettings("c");
const day = (date: string, orderRevenue: number): PlanTargetDay => ({
  planId: "p", clientId: "c", date, orderRevenue, newRevenue: orderRevenue * 0.6, returningRevenue: orderRevenue * 0.4, orders: 10, newOrders: 6, spend: 100, cm: 50, spendByChannel: {},
});
/** November: email 10% and organic 25% of order revenue; December plans organic only (40%). */
const mixOf: MixOf = (date, key) => {
  if (date.startsWith("2026-11")) return key === "email" ? 0.1 : key === "organic" ? 0.25 : null;
  if (date.startsWith("2026-12")) return key === "organic" ? 0.4 : null;
  return null;
};

describe("aggregatePlan with planned revenue mix", () => {
  it("adds each day's order revenue times its month's share", () => {
    const p = aggregatePlan([day("2026-11-10", 1000), day("2026-11-11", 3000)], undefined, mixOf);
    expect(p.mixRevenue.email).toBeCloseTo(400, 8);
    expect(p.mixRevenue.organic).toBeCloseTo(1000, 8);
  });

  it("weights months by their own revenue across a range", () => {
    const p = aggregatePlan([day("2026-11-30", 1000), day("2026-12-01", 3000)], undefined, mixOf);
    expect(p.mixRevenue.organic).toBeCloseTo(1000 * 0.25 + 3000 * 0.4, 8);
  });

  it("gives no figure for a line that some of the range's days do not plan, rather than a total that covers only part of the revenue", () => {
    const p = aggregatePlan([day("2026-11-30", 1000), day("2026-12-01", 3000)], undefined, mixOf);
    expect(p.mixRevenue.email).toBeUndefined();
  });

  it("has nothing without a plan for the mix, or without revenue", () => {
    expect(aggregatePlan([day("2026-11-10", 1000)]).mixRevenue).toEqual({});
    expect(aggregatePlan([day("2026-11-10", 0)], undefined, mixOf).mixRevenue).toEqual({});
  });
});

describe("Home targets for email and organic revenue", () => {
  const p = aggregatePlan([day("2026-11-10", 1000)], undefined, mixOf);
  it("the email and organic tiles compare with the planned revenue", () => {
    expect(METRICS.emailRevenue.target!(p, settings)).toBeCloseTo(100, 8);
    expect(METRICS.organicRevenue.target!(p, settings)).toBeCloseTo(250, 8);
  });
  it("show no target when the plan does not plan the line", () => {
    const none = aggregatePlan([day("2026-12-10", 1000)], undefined, mixOf);
    expect(METRICS.emailRevenue.target!(none, settings)).toBeNull();
    expect(METRICS.organicRevenue.target!(none, settings)).toBeCloseTo(400, 8);
  });
  it("both are additive, so Home can show their period target and pace", () => {
    expect(METRICS.emailRevenue.additive).toBe(true);
    expect(METRICS.organicRevenue.additive).toBe(true);
  });
});
