import { describe, expect, it } from "vitest";
import { dayWeights, FLAT_SEASONALITY, generateMonth, plOfRevenue } from "./generate";
import { blankInputs, type PlanMonthInputs } from "./types";

const inputs = (over: Partial<PlanMonthInputs> = {}): PlanMonthInputs => ({
  ...blankInputs(),
  spend: 30000,
  amer: 2,
  returningRevenue: 60000,
  platformPct: { google: 30, meta: 70 },
  altPct: { google: 10 },
  rates: { discountPct: 10, shippingPct: 5, taxPct: 20, refundPct: 4, cogsPct: 30, otherVarPct: 10, newAov: 100, returningAov: 120 },
  ...over,
});
const gen = (i: PlanMonthInputs, dow = [0, 0, 0, 0, 0, 0, 0], extra = {}) =>
  generateMonth({ planId: "p", clientId: "c", month: "2026-09-01", inputs: i, seasonality: { dow, effectPct: 100 }, deliveryCostPerOrder: 0, excludeBrandFromAmer: false, excludeMetaReturningFromAmer: false, ...extra });
const sum = (rows: ReturnType<typeof gen>, k: "spend" | "newRevenue" | "returningRevenue" | "cm" | "orderRevenue") => rows.reduce((a, r) => a + r[k], 0);

describe("generateMonth", () => {
  it("makes one row per day and hits the monthly totals", () => {
    const rows = gen(inputs());
    expect(rows).toHaveLength(30);
    expect(sum(rows, "spend")).toBeCloseTo(30000);
    expect(sum(rows, "newRevenue")).toBeCloseTo(60000);
    expect(sum(rows, "returningRevenue")).toBeCloseTo(60000);
  });
  it("follows the weekday weights", () => {
    const dow = [24.55, 2.66, -13.07, -12.3, -9.54, 3.52, 4.17]; // Sun..Sat
    const rows = gen(inputs(), dow);
    const sun = rows.find((r) => r.date === "2026-09-06")!;
    const tue = rows.find((r) => r.date === "2026-09-01")!;
    expect(sun.spend / tue.spend).toBeCloseTo(1.2455 / 0.8693, 3);
    expect(sum(rows, "spend")).toBeCloseTo(30000);
  });
  it("keeps aMER constant across days", () => {
    for (const r of gen(inputs(), [20, 0, -10, 0, 0, 5, 0])) expect(r.newRevenue / r.spend).toBeCloseTo(2);
  });
  it("splits platforms and brand", () => {
    const r = gen(inputs())[0];
    expect(r.spendByChannel.meta_acquisition).toBeCloseTo(r.spend * 0.7);
    expect(r.spendByChannel.google_brand).toBeCloseTo(r.spend * 0.03);
    expect(r.spendByChannel.google_nonbrand).toBeCloseTo(r.spend * 0.27);
  });
  it("excludes brand from the aMER base when the client setting says so", () => {
    const r = gen(inputs(), undefined, { excludeBrandFromAmer: true })[0];
    expect(r.newRevenue).toBeCloseTo((r.spend - r.spend * 0.03) * 2);
  });
  it("a fixed day keeps its value and the rest of the month absorbs the difference", () => {
    const rows = gen(inputs({ overrides: { "2026-09-10": { spend: 5000 } } }));
    expect(rows.find((r) => r.date === "2026-09-10")!.spend).toBe(5000);
    expect(sum(rows, "spend")).toBeCloseTo(30000);
    expect(rows[0].spend).toBeCloseTo(25000 / 29);
  });
  it("derives the P&L and CM with the confirmed formula", () => {
    const rows = gen(inputs());
    const r = rows[0];
    const pl = plOfRevenue(r.orderRevenue, inputs().rates, r.orders, 0);
    expect(r.orderRevenue).toBeCloseTo(r.grossSales! - r.discounts! + r.shipping! + r.tax!);
    expect(pl.netSales).toBeCloseTo(r.grossSales! - r.discounts! - r.refunds!);
    expect(r.cm).toBeCloseTo(pl.netSales + r.shipping! - r.cogs! - r.spend - r.costOfDelivery!);
  });
  it("adds the per-order delivery cost to cost of delivery", () => {
    const a = gen(inputs())[0];
    const b = gen(inputs(), undefined, { deliveryCostPerOrder: 2 })[0];
    expect(b.costOfDelivery! - a.costOfDelivery!).toBeCloseTo(2 * a.orders);
  });
  it("splits nothing by platform when no split is set, but keeps total spend", () => {
    const rows = gen(inputs({ platformPct: {} }));
    expect(rows[0].spendByChannel).toEqual({});
    expect(sum(rows, "spend")).toBeCloseTo(30000);
  });
});

describe("dayWeights", () => {
  it("scales the pattern by the effect strength", () => {
    const half = dayWeights(["2026-09-06"], { dow: [20, 0, 0, 0, 0, 0, 0], effectPct: 50 });
    expect(half[0]).toBeCloseTo(1.1);
    expect(dayWeights(["2026-09-06"], FLAT_SEASONALITY)[0]).toBe(1);
  });
});
