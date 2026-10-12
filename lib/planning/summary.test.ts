import { describe, expect, it } from "vitest";
import { defaultSettings } from "../defaults";
import { eachDay } from "../dates";
import { aggregate, amerSpend, cmParts, emptyTotals } from "../metrics";
import type { DailyFact, PlanTargetDay } from "../types";
import { FLAT_SEASONALITY, generateMonth } from "./generate";
import { buildSummaryGrid, actualFigures, forecastFigures, formatChange, goalCheck, monthFlags, planFigures, type MonthFigures } from "./summary";
import { blankInputs, type PlanMonth } from "./types";

const settings = { ...defaultSettings("c"), otherVariablePct: 5, deliveryCostPerOrder: 1, monthlyFixedCosts: 1000, excludeBrandFromAmer: false, excludeMetaReturningFromAmer: false };

const monthRows = (month: string, fixedCosts?: number) =>
  generateMonth({
    planId: "p",
    clientId: "c",
    month,
    inputs: { ...blankInputs(), spend: 30000, amer: 2, returningRevenue: 60000, platformPct: { meta: 100 }, fixedCosts, rates: { discountPct: 10, shippingPct: 5, taxPct: 20, refundPct: 4, cogsPct: 30, otherVarPct: 8, newAov: 100, returningAov: 120 } },
    seasonality: FLAT_SEASONALITY,
    deliveryCostPerOrder: 2,
    excludeBrandFromAmer: false,
    excludeMetaReturningFromAmer: false,
  });
const planMonth = (month: string, fixedCosts?: number): PlanMonth => ({ month, status: "in_progress", locked: false, inputs: { ...blankInputs(), spend: 30000, amer: 2, returningRevenue: 60000, fixedCosts } });

const sepRows = monthRows("2026-09-01", 4000);
const octRows = monthRows("2026-10-01");
const rows = [...sepRows, ...octRows];
const months = [planMonth("2026-09-01", 4000), planMonth("2026-10-01")];

describe("planFigures", () => {
  const f = planFigures(rows, months, 2026, settings);

  it("returns twelve months, January first, and marks months with no plan", () => {
    expect(f).toHaveLength(12);
    expect(f[0].hasData).toBe(false);
    expect(f[8].hasData).toBe(true);
  });

  it("sums the month's daily rows", () => {
    const sum = (k: "newRevenue" | "returningRevenue" | "cm") => sepRows.reduce((a, r) => a + r[k], 0);
    expect(f[8].spend).toBeCloseTo(30000, 4);
    expect(f[8].newRevenue).toBeCloseTo(sum("newRevenue"), 4);
    expect(f[8].returningRevenue).toBeCloseTo(sum("returningRevenue"), 4);
    expect(f[8].totalRevenue).toBeCloseTo(sum("newRevenue") + sum("returningRevenue"), 4);
    expect(f[8].cm).toBeCloseTo(sum("cm"), 4);
  });

  it("takes opex from the month's plan fixed costs, else the client setting, and EBITDA is CM less opex", () => {
    expect(f[8].opex).toBe(4000);
    expect(f[9].opex).toBe(1000);
    expect(f[8].ebitda).toBeCloseTo(f[8].cm - 4000, 4);
  });

  it("aMER is new revenue over acquisition spend; the exclusions change aMER but never total spend", () => {
    const day = (spendByChannel: PlanTargetDay["spendByChannel"]): PlanTargetDay => ({
      planId: "p", clientId: "c", date: "2026-03-05", orderRevenue: 300, newRevenue: 200, returningRevenue: 100, orders: 3, newOrders: 2, spend: 100, cm: 50, spendByChannel,
    });
    const r = [day({ google_nonbrand: 60, google_brand: 25, meta_returning: 15 })];
    const m = [planMonth("2026-03-01")];
    const none = planFigures(r, m, 2026, settings)[2];
    const noBrand = planFigures(r, m, 2026, { ...settings, excludeBrandFromAmer: true })[2];
    const both = planFigures(r, m, 2026, { ...settings, excludeBrandFromAmer: true, excludeMetaReturningFromAmer: true })[2];
    expect([none.acqSpend, noBrand.acqSpend, both.acqSpend]).toEqual([100, 75, 60]);
    expect(none.amer).toBeCloseTo(2, 6);
    expect(both.amer).toBeCloseTo(200 / 60, 6);
    expect([none.spend, noBrand.spend, both.spend]).toEqual([100, 100, 100]);
  });

  it("aMER is null when there is no acquisition spend", () => {
    const r: PlanTargetDay[] = [{ planId: "p", clientId: "c", date: "2026-03-05", orderRevenue: 0, newRevenue: 0, returningRevenue: 0, orders: 0, newOrders: 0, spend: 0, cm: 0, spendByChannel: {} }];
    expect(planFigures(r, [planMonth("2026-03-01")], 2026, settings)[2].amer).toBeNull();
  });
});

describe("actualFigures", () => {
  const spendDay = (date: string): DailyFact => {
    const channels = emptyTotals().channels;
    channels.meta_acquisition = { ...channels.meta_acquisition, spend: 400 };
    channels.google_brand = { ...channels.google_brand, spend: 100 };
    return { clientId: "c", date, grossSales: 1000, discounts: 100, netSales: 860, shippingCollected: 50, tax: 180, newOrderRevenue: 700, returningOrderRevenue: 300, newOrders: 7, returningOrders: 3, refunds: 40, cogs: 250, cogsUnmappedSales: 0, emailRevenue: 0, emailCampaignRevenue: 0, emailFlowRevenue: 0, emailOrders: 0, emailSent: 0, channels };
  };
  const facts = eachDay("2025-05-01", "2025-05-31").map(spendDay);

  it("agrees with the dashboard's contribution margin and aMER spend for the month", () => {
    const s = { ...settings, excludeBrandFromAmer: true };
    const f = actualFigures(facts, 2025, s)[4];
    const t = aggregate(facts);
    expect(f.hasData).toBe(true);
    expect(f.cm).toBeCloseTo(cmParts(t, s).cm, 6);
    expect(f.acqSpend).toBeCloseTo(amerSpend(t, s), 6);
    expect(f.opex).toBe(1000);
    expect(f.ebitda).toBeCloseTo(f.cm - 1000, 6);
  });

  it("leaves months without facts empty", () => {
    expect(actualFigures(facts, 2025, settings)[0].hasData).toBe(false);
  });
});

function fig(i: number, o: Partial<MonthFigures> = {}): MonthFigures {
  const base: MonthFigures = {
    month: `2026-${String(i + 1).padStart(2, "0")}-01`, hasData: true, spend: 100, acqSpend: 100, amer: 2, newRevenue: 200, returningRevenue: 100, totalRevenue: 300, cm: 60, opex: 20, ebitda: 40,
  };
  return { ...base, ...o };
}
const empty = (i: number): MonthFigures => ({ month: `2026-${String(i + 1).padStart(2, "0")}-01`, hasData: false, spend: 0, acqSpend: 0, amer: null, newRevenue: 0, returningRevenue: 0, totalRevenue: 0, cm: 0, opex: 0, ebitda: 0 });

describe("buildSummaryGrid", () => {
  const current = Array.from({ length: 12 }, (_, i) => (i < 3 ? fig(i, { spend: 100 * (i + 1), acqSpend: 100 * (i + 1), newRevenue: 200 * (i + 1) }) : empty(i)));
  const lastYear = Array.from({ length: 12 }, (_, i) => fig(i, { spend: i === 0 ? 0 : 80, newRevenue: 160, amer: 2 }));
  const grid = buildSummaryGrid(current, lastYear);
  const row = (key: string) => grid.find((r) => r.key === key)!;

  it("lists the eight rows in the planning order", () => {
    expect(grid.map((r) => r.key)).toEqual(["spend", "amer", "newRevenue", "returningRevenue", "totalRevenue", "cm", "opex", "ebitda"]);
  });

  it("year over year is value over last year minus one, and a dash (null) when last year is zero", () => {
    expect(row("spend").months[1].yoy).toBeCloseTo(200 / 80 - 1, 6);
    expect(row("spend").months[0].yoy).toBeNull();
  });

  it("month over month compares January with last year's December and later months with the month before", () => {
    expect(row("spend").months[0].mom).toBeCloseTo(100 / 80 - 1, 6);
    expect(row("spend").months[2].mom).toBeCloseTo(300 / 200 - 1, 6);
  });

  it("shares of the year add up to one for the rows that have them, and only those rows have them", () => {
    const shares = row("spend").months.map((m) => m.share ?? 0);
    expect(shares.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
    expect(row("cm").months[0].share).toBeNull();
    expect(row("amer").months[0].share).toBeNull();
  });

  it("a month with no plan shows nulls, never zero or NaN", () => {
    const m = row("spend").months[5];
    expect([m.value, m.yoy, m.mom, m.share]).toEqual([null, null, null, null]);
  });

  it("the year total sums flows and recomputes aMER from total new revenue over total acquisition spend", () => {
    expect(row("spend").total.value).toBe(600);
    expect(row("amer").total.value).toBeCloseTo((200 + 400 + 600) / 600, 6);
  });

  it("a year with no last-year data has null year over year, not Infinity", () => {
    const g = buildSummaryGrid(current, Array.from({ length: 12 }, (_, i) => empty(i)));
    expect(g[0].months[0].yoy).toBeNull();
    expect(g[0].total.yoy).toBeNull();
    expect(g[0].months[0].mom).toBeNull();
  });
});

describe("monthFlags", () => {
  const base = fig(2, { cm: 500, amer: 2, acqSpend: 20000 });
  const guarded = { kind: "revenue" as const, a: 0, b: 2, r2: 1, guard: { s0: 1000, gamma: 1 } };

  it("flags nothing for a healthy month", () => {
    expect(monthFlags(base, { metric: "newRevenueGrowth", value: 20 }, guarded, 30)).toEqual([]);
  });

  it("flags negative CM, CM under the floor and aMER under the floor from the saved figures", () => {
    const goal = { metric: "newRevenueGrowth" as const, value: 20, cmFloor: 1000, amerFloor: 3 };
    expect(monthFlags(base, goal, null, 30)).toEqual(["cm_below_floor", "amer_below_floor"]);
    expect(monthFlags({ ...base, cm: -5 }, goal, null, 30)).toEqual(["cm_negative", "cm_below_floor", "amer_below_floor"]);
  });

  it("flags spend past what the model trusts only when the curve has a guardrail", () => {
    expect(monthFlags({ ...base, acqSpend: 31000 }, null, guarded, 30)).toEqual(["beyond_history"]);
    expect(monthFlags({ ...base, acqSpend: 31000 }, null, { ...guarded, guard: null }, 30)).toEqual([]);
  });

  it("flags nothing for a month with no plan", () => {
    expect(monthFlags(empty(0), { metric: "newRevenueGrowth", value: 20, cmFloor: 1000 }, guarded, 30)).toEqual([]);
  });
});

describe("formatChange", () => {
  it("shows a dash for nothing, whole percents with a sign, and never a minus on zero", () => {
    expect(formatChange(null)).toBe("–");
    expect(formatChange(0.126)).toBe("+13%");
    expect(formatChange(-0.1)).toBe("-10%");
    expect(formatChange(0.0004)).toBe("0%");
    expect(formatChange(-0.0004)).toBe("0%");
  });
});

describe("forecastFigures", () => {
  const plan = [fig(0, { cm: 100, opex: 30, ebitda: 70 }), fig(1, { cm: 100, opex: 30, ebitda: 70 }), empty(2), fig(3, { cm: 100, opex: 30, ebitda: 70 })];
  const actual = [fig(0, { cm: 80, opex: 10, ebitda: 70 }), fig(1, { cm: 90, opex: 10, ebitda: 80 }), fig(2, { cm: 50, opex: 10, ebitda: 40 }), empty(3)];
  const ended = [true, true, true, false];

  it("takes actuals for ended months but keeps the plan's own opex, so EBITDA is on the same footing as the plan basis", () => {
    const f = forecastFigures(plan, actual, ended);
    expect(f[0].cm).toBe(80);
    expect(f[0].opex).toBe(30);
    expect(f[0].ebitda).toBe(50);
  });

  it("keeps an ended month's own opex when the plan has nothing for it, and the plan for months still to come", () => {
    const f = forecastFigures(plan, actual, ended);
    expect(f[2]).toEqual(actual[2]);
    expect(f[3]).toEqual(plan[3]);
  });

  it("falls back to the plan when an ended month has no actuals", () => {
    expect(forecastFigures(plan, [empty(0), actual[1], actual[2], empty(3)], ended)[0]).toEqual(plan[0]);
  });
});

describe("goalCheck", () => {
  const lastYear = Array.from({ length: 12 }, (_, i) => fig(i, { newRevenue: 100, returningRevenue: 50, totalRevenue: 150 }));
  const year = (newRev: number) => Array.from({ length: 12 }, (_, i) => fig(i, { newRevenue: newRev, returningRevenue: 60, totalRevenue: newRev + 60 }));

  it("sets the year's figure against what the goal asks for", () => {
    const a = goalCheck({ metric: "newRevenueGrowth", value: 20 }, year(110), lastYear)!;
    expect([a.target, a.actual, a.label]).toEqual([1440, 1320, "New revenue"]);
    const b = goalCheck({ metric: "totalRevenueGrowth", value: 10 }, year(110), lastYear)!;
    expect(b.target).toBeCloseTo(1980, 6);
    expect([b.actual, b.label]).toEqual([2040, "Total revenue"]);
    expect(goalCheck({ metric: "totalRevenue", value: 3000 }, year(110), lastYear)).toEqual({ target: 3000, actual: 2040, label: "Total revenue" });
  });

  it("has no check for a growth goal when last year is empty", () => {
    expect(goalCheck({ metric: "newRevenueGrowth", value: 20 }, year(110), Array.from({ length: 12 }, (_, i) => empty(i)))).toBeNull();
  });
});
