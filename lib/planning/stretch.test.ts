import { describe, expect, it } from "vitest";
import { defaultSettings } from "../defaults";
import type { StretchGoal } from "../types";
import { evaluateSpend, type Curve, type ModelSettings } from "./new-customer";
import { buildStretch, spendForRevenue, stretchPlanMonths, type StretchMonth, type StretchMonthInput, type StretchRequest } from "./stretch";
import { blankInputs, type PlanMonth } from "./types";

// Revenue = 2 x spend, so aMER is 2 at any spend and the arithmetic is easy to check by hand.
const linear: Curve = { kind: "revenue", a: 0, b: 2, r2: 1 };
const model: ModelSettings = { newCostPct: 30, returningCostPct: 30, aov: 50, ltv60Multiplier: 1.2, ltv365Multiplier: 1.5, overModelPct: 0, minCm: 0, minCm60: 0, minCm365: 0 };
const rel = (a: number, b: number) => Math.abs(a / b - 1);

describe("spendForRevenue", () => {
  it("finds the spend that gives the target revenue", () => {
    const r = spendForRevenue(linear, model, 100000, 30, 1, 1e9);
    expect(r.reached).toBe(true);
    expect(rel(r.spend, 50000)).toBeLessThan(1e-4);
  });

  it("reports a target beyond the cap as not reached and stops at the cap", () => {
    const r = spendForRevenue(linear, model, 400000, 30, 1, 100000);
    expect(r.reached).toBe(false);
    expect(r.spend).toBeCloseTo(100000, 0);
  });

  it("stops at the spend that earns the most when revenue turns down before the cap", () => {
    const bending: Curve = { kind: "linear", a: 5, b: -0.0004, r2: 1 }; // revenue per day peaks at 6,250 spend
    const cap = 600000; // monthly, 20,000 a day: far past the peak
    const r = spendForRevenue(bending, model, 1e9, 30, 1, cap);
    expect(r.reached).toBe(false);
    const peak = (5 / (2 * 0.0004)) * 30;
    expect(rel(r.spend, peak)).toBeLessThan(0.01);
    expect(evaluateSpend(bending, model, r.spend, 30).newRevenue).toBeGreaterThan(evaluateSpend(bending, model, cap, 30).newRevenue);
  });

  it("needs no spend for no revenue", () => {
    expect(spendForRevenue(linear, model, 0, 30, 1, 1e6)).toEqual({ spend: 0, reached: true });
  });
});

function monthsOf(baseline: number[], o: Partial<StretchMonthInput> = {}): StretchMonthInput[] {
  return baseline.map((b, i) => ({ month: `2026-${String(i + 1).padStart(2, "0")}-01`, days: 30, locked: false, seasonIdx: 1, model, baselineNewRevenue: b, ...o }));
}
function request(o: Partial<StretchRequest> & { goal: StretchGoal }): StretchRequest {
  return {
    months: monthsOf([8000, 8000, 8000, 8000, 8000, 8000, 8000, 8000, 8000, 8000, 16000, 24000]),
    lastYearNewRevenue: 110000,
    lastYearTotalRevenue: 200000,
    curve: linear,
    maxMonthlySpend: 1e9,
    returningFor: (n) => Object.fromEntries(Object.keys(n).map((k) => [k, 0])),
    cmFor: () => 100,
    ...o,
  };
}
const BASE = 120000;

describe("buildStretch: new revenue growth", () => {
  const r = buildStretch(request({ goal: { metric: "newRevenueGrowth", value: 20 } }));

  it("sets the year's new revenue from last year and follows the baseline's month shape", () => {
    expect(rel(r.annualNewRevenue, 132000)).toBeLessThan(1e-4);
    expect(r.months).toHaveLength(12);
    expect(rel(r.months[10].newRevenue, (132000 * 16000) / BASE)).toBeLessThan(1e-4);
    expect(rel(r.months[11].newRevenue, (132000 * 24000) / BASE)).toBeLessThan(1e-4);
  });

  it("solves spend on the model (here aMER 2, so spend is half the revenue)", () => {
    expect(rel(r.months[0].acqSpend, r.months[0].newRevenue / 2)).toBeLessThan(1e-4);
    expect(r.months[0].amer).toBeCloseTo(2, 4);
  });

  it("is reachable and above the baseline, and says so", () => {
    expect(r.reachable).toBe(true);
    expect(r.aboveBaseline).toBe(true);
    expect(r.message).toMatch(/above the baseline/i);
    expect(r.months.every((m) => m.flags.length === 0)).toBe(true);
  });
});

describe("buildStretch: total revenue goals", () => {
  const returningFor = (n: Record<string, number>) => Object.fromEntries(Object.entries(n).map(([k, v]) => [k, v * 0.5]));

  it("iterates until total revenue lands within half a percent of the goal, in at most 40 steps", () => {
    const r = buildStretch(request({ goal: { metric: "totalRevenueGrowth", value: 20 }, returningFor }));
    const total = r.months.reduce((a, m) => a + m.newRevenue + m.returningRevenue, 0);
    expect(rel(total, 240000)).toBeLessThan(0.005);
    expect(r.iterations).toBeLessThanOrEqual(40);
    expect(r.reachable).toBe(true);
  });

  it("accepts an amount as the goal", () => {
    const r = buildStretch(request({ goal: { metric: "totalRevenue", value: 300000 }, returningFor }));
    const total = r.months.reduce((a, m) => a + m.newRevenue + m.returningRevenue, 0);
    expect(rel(total, 300000)).toBeLessThan(0.005);
  });
});

describe("buildStretch: goals the model cannot or need not stretch to", () => {
  it("still builds a stretch for a goal at or below the baseline and says it is not above it", () => {
    const r = buildStretch(request({ goal: { metric: "newRevenueGrowth", value: 5 } })); // 115,500 < 120,000
    expect(r.aboveBaseline).toBe(false);
    expect(r.message).toMatch(/not above the baseline/i);
    expect(r.months).toHaveLength(12);
  });

  it("flags months it cannot reach and never spends past the cap", () => {
    const r = buildStretch(request({ goal: { metric: "newRevenueGrowth", value: 20 }, maxMonthlySpend: 10000 }));
    const capped = r.months.filter((m) => m.flags.includes("unreachable"));
    expect(capped.length).toBeGreaterThan(0);
    expect(r.reachable).toBe(false);
    expect(r.message).toMatch(/cannot reach/i);
    for (const m of r.months) expect(m.acqSpend).toBeLessThanOrEqual(10000.01);
    for (const m of capped) expect(m.newRevenue).toBeCloseTo(20000, 0);
  });
});

describe("buildStretch: flags", () => {
  it("flags negative CM and CM below the floor from the caller's CM", () => {
    const r = buildStretch(request({ goal: { metric: "newRevenueGrowth", value: 20, cmFloor: 50 }, cmFor: (m) => (m.month === "2026-02-01" ? -10 : m.month === "2026-03-01" ? 20 : 100) }));
    expect(r.months[1].flags).toEqual(expect.arrayContaining(["cm_negative", "cm_below_floor"]));
    expect(r.months[2].flags).toEqual(["cm_below_floor"]);
    expect(r.months[0].flags).toEqual([]);
  });

  it("flags aMER below the floor", () => {
    const r = buildStretch(request({ goal: { metric: "newRevenueGrowth", value: 20, amerFloor: 3 } }));
    expect(r.months.every((m) => m.flags.includes("amer_below_floor"))).toBe(true);
  });

  it("flags spend beyond the history the model trusts, only when the curve has a guardrail", () => {
    const guarded: Curve = { ...linear, guard: { s0: 1000, gamma: 1 } }; // trusted up to 30,000 a month
    const two = monthsOf([1000, 9000]);
    const goal: StretchGoal = { metric: "newRevenueGrowth", value: 0 };
    const req = { goal, months: two, lastYearNewRevenue: 100000 };
    const withGuard = buildStretch(request({ ...req, curve: guarded }));
    expect(withGuard.months[0].flags).not.toContain("beyond_history");
    expect(withGuard.months[1].flags).toContain("beyond_history");
    const noGuard = buildStretch(request({ ...req, curve: linear }));
    expect(noGuard.months.every((m) => !m.flags.includes("beyond_history"))).toBe(true);
  });
});

describe("buildStretch: locked months", () => {
  it("keeps a locked month out of the solve and shares the rest of the year among the free months", () => {
    const months = monthsOf([100000, 100000, 100000]).map((m, i) => ({ ...m, locked: i === 1 }));
    const r = buildStretch(request({ goal: { metric: "newRevenueGrowth", value: 20 }, months, lastYearNewRevenue: 300000 }));
    expect(r.months.map((m) => m.month)).toEqual(["2026-01-01", "2026-03-01"]);
    expect(rel(r.months[0].newRevenue, 130000)).toBeLessThan(1e-4); // (360,000 - 100,000 locked) / 2
    expect(rel(r.annualNewRevenue, 360000)).toBeLessThan(1e-4);
  });
});

describe("stretchPlanMonths", () => {
  const settings = { ...defaultSettings("c"), excludeBrandFromAmer: false, excludeMetaReturningFromAmer: false };
  const inputs = { ...blankInputs(), spend: 1000, amer: 1.5, returningRevenue: 700, platformPct: { meta: 100 }, altPct: { meta: 0 }, fixedCosts: 4000 };
  const base: PlanMonth[] = [
    { month: "2026-01-01", status: "final", locked: true, inputs },
    { month: "2026-02-01", status: "final", locked: false, inputs },
    { month: "2026-03-01", status: "in_progress", locked: false, inputs: null },
  ];
  const result = (month: string, over: Partial<StretchMonth> = {}): StretchMonth => ({ month, newRevenue: 9000, acqSpend: 4000.4, amer: 2.25, returningRevenue: 1234.6, flags: [], ...over });

  it("copies a locked month exactly, even when the stretch has a result for it", () => {
    const out = stretchPlanMonths(base, [result("2026-01-01")], settings);
    expect(out[0]).toEqual(base[0]);
    expect(out[0].inputs).not.toBe(base[0].inputs);
  });

  it("writes the solved spend, aMER and returning revenue into an unlocked month and clears the override", () => {
    const out = stretchPlanMonths(base, [result("2026-02-01")], settings);
    expect(out[1].inputs).toMatchObject({ spend: 4000, amer: 2.25, returningRevenue: 1235, returningModel: 1235, returningOverride: null, fixedCosts: 4000 });
    expect(out[1].status).toBe("in_progress");
  });

  it("turns acquisition spend back into total spend with the month's acquisition share", () => {
    const withAlt = { ...inputs, altPct: { meta: 20 } };
    const out = stretchPlanMonths([{ month: "2026-02-01", status: "final", locked: false, inputs: withAlt }], [result("2026-02-01", { acqSpend: 4000 })], { ...settings, excludeMetaReturningFromAmer: true });
    expect(out[0].inputs!.spend).toBe(5000); // 4,000 / 0.8
  });

  it("leaves months with no inputs or no result as they were", () => {
    const out = stretchPlanMonths(base, [result("2026-03-01")], settings);
    expect(out[2]).toEqual(base[2]);
    expect(out[1]).toEqual(base[1]);
  });
});
