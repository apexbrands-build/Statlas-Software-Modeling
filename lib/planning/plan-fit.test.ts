import { describe, expect, it } from "vitest";
import { defaultSettings } from "../defaults";
import { addDays } from "../dates";
import { emptyTotals } from "../metrics";
import type { DailyFact } from "../types";
import { BEYOND_GAMMA } from "./models";
import { curveAmer, fitNewCustomerModel, type Curve, type DayPoint } from "./new-customer";
import { aboveModelPct, dayPoints, fitPlanModel, isStretchMonth, seasonIndex } from "./plan-fit";

const settings = { ...defaultSettings("c"), excludeBrandFromAmer: false, excludeMetaReturningFromAmer: false };
const flat = [0, 0, 0, 0, 0, 0, 0];
const truth: Curve = { kind: "power", a: 40, b: -0.5, r2: 1 };
const noise = (i: number) => Math.sin(i * 12.9898) * 0.5;

function points(days: number): DayPoint[] {
  return Array.from({ length: days }, (_, i) => {
    const spend = 2000 + ((i * 37) % 60) * 100;
    return { date: addDays("2025-01-01", i), spend, newRevenue: spend * curveAmer(truth, spend) * (1 + noise(i) * 0.1) };
  });
}
const factOf = (p: DayPoint): DailyFact => {
  const channels = emptyTotals().channels;
  channels.meta_acquisition = { ...channels.meta_acquisition, spend: p.spend };
  return { clientId: "c", date: p.date, grossSales: 0, discounts: 0, netSales: 0, shippingCollected: 0, tax: 0, newOrderRevenue: p.newRevenue, returningOrderRevenue: 0, newOrders: 0, returningOrders: 0, refunds: 0, cogs: 0, cogsUnmappedSales: 0, emailRevenue: 0, emailCampaignRevenue: 0, emailFlowRevenue: 0, emailOrders: 0, emailSent: 0, channels };
};
const facts = points(500).map(factOf);
const S = { fitKind: "revenue" as const, beyondHistory: undefined, actualizeFrom: null, recentWeight: 20 };

describe("fitPlanModel", () => {
  it("builds the day points the model screen builds: aMER spend and new order revenue", () => {
    const p = dayPoints(facts, settings);
    expect(p[3]).toEqual({ date: facts[3].date, spend: facts[3].channels.meta_acquisition.spend, newRevenue: facts[3].newOrderRevenue });
  });

  it("fits exactly as fitNewCustomerModel does with the same options", () => {
    const direct = fitNewCustomerModel(points(500).map((p, i) => ({ ...p, newRevenue: facts[i].newOrderRevenue })), flat, { kind: "revenue", recent: null, guard: BEYOND_GAMMA.standard });
    const viaPlan = fitPlanModel(facts, settings, flat, S);
    expect(viaPlan!.curve).toEqual(direct!.curve);
  });

  it("applies actualization when the model has an actualize date", () => {
    const from = facts[440].date;
    const direct = fitNewCustomerModel(dayPoints(facts, settings), flat, { kind: "revenue", recent: { from, weight: 20 }, guard: BEYOND_GAMMA.standard });
    expect(fitPlanModel(facts, settings, flat, { ...S, actualizeFrom: from })!.curve).toEqual(direct!.curve);
  });

  it("returns null with too little history", () => {
    expect(fitPlanModel(facts.slice(0, 30), settings, flat, S)).toBeNull();
  });
});

describe("above the model", () => {
  const curve: Curve = { kind: "power", a: 40, b: -0.5, r2: 1 };
  const days = 30;
  const monthly = 150000; // 5,000 a day
  const modelAmer = curveAmer(curve, monthly / days);

  it("is zero when the plan aMER is the model's, and the percentage above it otherwise", () => {
    expect(aboveModelPct(modelAmer, monthly, days, curve, 1)).toBeCloseTo(0, 6);
    expect(aboveModelPct(modelAmer * 1.1, monthly, days, curve, 1)).toBeCloseTo(10, 6);
  });

  it("compares against the model at the month's own seasonality index", () => {
    expect(aboveModelPct(modelAmer * 1.2, monthly, days, curve, 1.2)).toBeCloseTo(0, 6);
  });

  it("is null without spend or without a plan aMER", () => {
    expect(aboveModelPct(2, 0, days, curve, 1)).toBeNull();
    expect(aboveModelPct(null, monthly, days, curve, 1)).toBeNull();
    expect(aboveModelPct(0, monthly, days, curve, 1)).toBeNull();
  });

  it("flags a month only when it sits above the over-model the strategist chose for it", () => {
    expect(isStretchMonth(12, 11.8)).toBe(true);
    expect(isStretchMonth(11.8, 11.8)).toBe(false);
    expect(isStretchMonth(null, 5)).toBe(false);
  });
});

describe("seasonIndex", () => {
  it("is 1 when the fit has no seasonal data", () => {
    expect(seasonIndex({ curve: truth, used: [] }, "2026-03-01")).toBe(1);
  });

  it("reads the month's index from the fit's own days", () => {
    const fit = fitPlanModel(facts, settings, flat, S)!;
    const idx = seasonIndex(fit, "2026-03-01");
    expect(idx).toBeGreaterThan(0.5);
    expect(idx).toBeLessThan(2);
  });
});
