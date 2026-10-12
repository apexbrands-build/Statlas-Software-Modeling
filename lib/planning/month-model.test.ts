import { describe, expect, it } from "vitest";
import { defaultSettings } from "../defaults";
import { eachDay } from "../dates";
import { emptyTotals } from "../metrics";
import type { DailyFact } from "../types";
import { defaultNewCustomerMonth, monthModelSettings, resolveNewCustomerMonth, type MonthModelCtx } from "./month-model";
import type { NewCustomerMonth } from "./models";
import { interpolate90 } from "./new-customer";
import { blankInputs } from "./types";

const settings = { ...defaultSettings("c"), otherVariablePct: 0, deliveryCostPerOrder: 0, cogsFlatRate: false, cogsFallbackPct: 0, excludeBrandFromAmer: false, excludeMetaReturningFromAmer: false };
const day = (date: string): DailyFact => {
  const channels = emptyTotals().channels;
  channels.meta_acquisition = { ...channels.meta_acquisition, spend: 100 };
  return { clientId: "c", date, grossSales: 1000, discounts: 0, netSales: 800, shippingCollected: 0, tax: 0, newOrderRevenue: 1000, returningOrderRevenue: 0, newOrders: 10, returningOrders: 0, refunds: 0, cogs: 200, cogsUnmappedSales: 0, emailRevenue: 0, emailCampaignRevenue: 0, emailFlowRevenue: 0, emailOrders: 0, emailSent: 0, channels };
};
const facts = eachDay("2026-01-01", "2026-04-30").map(day);
const ctx = (cohortMult: MonthModelCtx["cohortMult"] = { ltv60: 1.2, ltv90: 1.3, ltv365: 1.6 }): MonthModelCtx => ({ facts, lastData: "2026-04-30", settings, cohortMult });
const NONE = { ltv60: null, ltv90: null, ltv365: null };

describe("defaultNewCustomerMonth", () => {
  it("takes AOV and cost % from the last 30 days and the LTV multipliers from cohorts", () => {
    const m = defaultNewCustomerMonth("2026-05-01", null, ctx(), 7);
    expect(m).toMatchObject({ aov: 100, aovSource: "last30", newCostPct: 40, newCostSource: "last30", returningCostPct: 40, ltv60Multiplier: 1.2, ltv90Multiplier: 1.3, ltv365Multiplier: 1.6, ltvSource: "recommended", overModelPct: 7, optimizeFor: "cm" });
  });

  it("falls back to typed LTV values (manual) and an estimated 90-day multiplier when no cohort is mature", () => {
    const m = defaultNewCustomerMonth("2026-05-01", null, ctx(NONE), 0);
    expect(m.ltvSource).toBe("manual");
    expect(m.ltv60Multiplier).toBe(1);
    expect(m.ltv365Multiplier).toBe(1);
    expect(m.ltv90Multiplier).toBeCloseTo(interpolate90(1, 1), 8);
  });

  it("starts spend from the plan month's acquisition spend, else from the last 90 days' pace", () => {
    const planned = { ...blankInputs(), spend: 5000, platformPct: { meta: 100 }, altPct: { meta: 0 } };
    expect(defaultNewCustomerMonth("2026-05-01", planned, ctx(), 0).spend).toBe(5000);
    expect(defaultNewCustomerMonth("2026-05-01", null, ctx(), 0).spend).toBe(3100); // 100 a day x 31 days
  });
});

describe("resolveNewCustomerMonth", () => {
  const month = (o: Partial<NewCustomerMonth> = {}): NewCustomerMonth => ({ ...defaultNewCustomerMonth("2026-05-01", null, ctx(), 0), ...o });

  it("uses typed numbers for Manual sources and recent data otherwise", () => {
    const manual = resolveNewCustomerMonth(month({ aovSource: "manual", aov: 77, newCostSource: "manual", newCostPct: 33, returningCostSource: "manual", returningCostPct: 22 }), ctx());
    expect([manual.aov, manual.nc, manual.rc]).toEqual([77, 33, 22]);
    const recent = resolveNewCustomerMonth(month({ aov: 77, newCostPct: 33 }), ctx());
    expect([recent.aov, recent.nc]).toEqual([100, 40]);
  });

  it("uses the cohort multipliers when Recommended and the typed ones when Manual", () => {
    const rec = resolveNewCustomerMonth(month({ ltv60Multiplier: 9, ltv365Multiplier: 9 }), ctx());
    expect([rec.m60, rec.m90, rec.m365]).toEqual([1.2, 1.3, 1.6]);
    const man = resolveNewCustomerMonth(month({ ltvSource: "manual", ltv60Multiplier: 1.1, ltv365Multiplier: 1.4, ltv90Multiplier: undefined }), ctx());
    expect(man.m60).toBe(1.1);
    expect(man.m365).toBe(1.4);
    expect(man.m90).toBeCloseTo(interpolate90(1.1, 1.4), 8);
  });

  it("falls back to the typed multipliers when Recommended has no mature cohort", () => {
    const r = resolveNewCustomerMonth(month({ ltv60Multiplier: 1.15, ltv365Multiplier: 1.5, ltv90Multiplier: undefined }), ctx(NONE));
    expect([r.m60, r.m365]).toEqual([1.15, 1.5]);
    expect(r.m90).toBeCloseTo(interpolate90(1.15, 1.5), 8);
  });
});

describe("monthModelSettings", () => {
  it("maps the resolved month to the model's settings, with the 90-day CM floor defaulting to 0", () => {
    const m = defaultNewCustomerMonth("2026-05-01", null, ctx(), 4);
    const ms = monthModelSettings(m, resolveNewCustomerMonth(m, ctx()));
    expect(ms).toMatchObject({ newCostPct: 40, returningCostPct: 40, aov: 100, ltv60Multiplier: 1.2, ltv90Multiplier: 1.3, ltv365Multiplier: 1.6, overModelPct: 4, minCm: 0, minCm60: 0, minCm90: 0, minCm365: 0 });
  });
});
