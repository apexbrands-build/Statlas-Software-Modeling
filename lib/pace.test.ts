import { describe, expect, it } from "vitest";
import { defaultSettings } from "./defaults";
import { tilePace, type DashData } from "./dashboard-data";
import { aggregatePlan, emptyTotals, METRICS } from "./metrics";
import { eachDay } from "./dates";
import type { PlanTargetDay } from "./types";

const planDay = (date: string, over: Partial<PlanTargetDay> = {}): PlanTargetDay => ({
  planId: "p", clientId: "c", date, orderRevenue: 1000, newRevenue: 600, returningRevenue: 400, orders: 10, newOrders: 6, spend: 300, cm: 200, spendByChannel: { meta_acquisition: 300 }, ...over,
});

/** October with a plan row for every day; actuals through the 13th. */
function october(over: { effTo?: string; actualDays?: number; planOver?: Partial<PlanTargetDay> } = {}): DashData {
  const rows = eachDay("2026-10-01", "2026-10-31").map((d) => planDay(d, over.planOver));
  const effTo = over.effTo ?? "2026-10-13";
  const elapsed = rows.filter((r) => r.date <= effTo);
  return {
    settings: defaultSettings("c"),
    effTo,
    plan: new Map(rows.map((r) => [r.date, r])),
    planTotals: aggregatePlan(elapsed),
    cur: { ...emptyTotals(), days: over.actualDays ?? 13, newOrderRevenue: 6000, returningOrderRevenue: 4000, orders: 90, newOrders: 55 },
    roasOf: null,
  } as unknown as DashData;
}

describe("tilePace: how far the month so far is from the whole period's target", () => {
  it("shows the share of the full target reached and where the period ends if the rest of the plan happens", () => {
    const p = tilePace(METRICS.orderRevenue, october(), "plan")!;
    expect(p.fullTarget).toBe(31000);
    expect(p.pct).toBeCloseTo(10000 / 31000, 10);
    expect(p.projected).toBe(10000 + (31000 - 13000));
    expect(p.remainingDays).toBe(18);
  });

  it("works for contribution margin and for ad spend, which are additive too", () => {
    const cmPace = tilePace(METRICS.cm, october({ planOver: { cm: 150 } }), "plan");
    expect(cmPace).not.toBeNull();
    expect(cmPace!.fullTarget).toBe(150 * 31);
    expect(tilePace(METRICS.adSpend, october(), "plan")!.fullTarget).toBe(300 * 31);
  });

  it("has nothing for a ratio such as MER or aMER (a month-end projection of a ratio would mislead)", () => {
    expect(tilePace(METRICS.mer, october(), "plan")).toBeNull();
    expect(tilePace(METRICS.amer, october(), "plan")).toBeNull();
    expect(tilePace(METRICS.aov, october(), "plan")).toBeNull();
  });

  it("has nothing outside the Plan comparison", () => {
    for (const mode of ["yoy", "prev", "custom"] as const) expect(tilePace(METRICS.orderRevenue, october(), mode)).toBeNull();
  });

  it("has nothing once the period is complete (no days left to project)", () => {
    expect(tilePace(METRICS.orderRevenue, october({ effTo: "2026-10-31" }), "plan")).toBeNull();
  });

  it("has nothing without actuals yet, or when the plan's full target is zero", () => {
    expect(tilePace(METRICS.orderRevenue, october({ actualDays: 0 }), "plan")).toBeNull();
    expect(tilePace(METRICS.orderRevenue, october({ planOver: { orderRevenue: 0 } }), "plan")).toBeNull();
  });

  it("marks the additive Home metrics and leaves the ratios alone", () => {
    for (const k of ["cm", "orderRevenue", "adSpend", "orders", "returningRevenue", "returningOrders", "newRevenue", "newOrders"]) expect(METRICS[k].additive, k).toBe(true);
    for (const k of ["mer", "aov", "returningAov", "repeatRate", "newAov", "weightedCac", "amer"]) expect(METRICS[k].additive ?? false, k).toBe(false);
  });
});
