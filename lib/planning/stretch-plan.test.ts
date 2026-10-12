import { describe, expect, it } from "vitest";
import { addDays } from "../dates";
import { DEFAULT_NEW_CUSTOMER, DEFAULT_RETURNING } from "./models";
import { FLAT_SEASONALITY } from "./generate";
import { baseMonths, baseRows, cohortsFor, factsFrom, lastData, settings } from "./stretch-fixtures";
import { planStretch, preflightStretch, type StretchPlanInput } from "./stretch-plan";

function input(over: Partial<StretchPlanInput> = {}): StretchPlanInput {
  return {
    planId: "stretch",
    clientId: "c",
    year: 2026,
    settings,
    facts: factsFrom("2024-01-01", lastData),
    lastData,
    seasonality: FLAT_SEASONALITY,
    eventMults: {},
    newSettings: { ...DEFAULT_NEW_CUSTOMER, months: {} },
    retSettings: DEFAULT_RETURNING,
    cohort: { available: true, stats: [], cohorts: cohortsFor() },
    baseline: { months: baseMonths, rows: baseRows },
    goal: { metric: "newRevenueGrowth", value: 20 },
    ...over,
  };
}

describe("planStretch: what stops it", () => {
  it("explains a client with too little history instead of failing", () => {
    const out = planStretch(input({ facts: factsFrom(addDays(lastData, -20), lastData) }));
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toMatch(/not enough history/i);
  });

  it("asks for the cohorts when they are not built", () => {
    const out = planStretch(input({ cohort: { available: false, stats: [], cohorts: [] } }));
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toMatch(/cohorts/i);
  });

  it("needs planned months in the baseline", () => {
    const out = planStretch(input({ baseline: { months: baseMonths.map((m) => ({ ...m, inputs: null })), rows: {} } }));
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toMatch(/no planned months/i);
  });
});

describe("planStretch: a stretch for the rest of the year", () => {
  const out = planStretch(input());
  if (!out.ok) throw new Error(out.reason);
  const byKey = new Map(out.months.map((m) => [m.month, m]));
  const baseOf = (k: string) => baseMonths.find((m) => m.month === k)!;

  it("keeps closed months and locked months exactly as the baseline has them", () => {
    for (const k of ["2026-01-01", "2026-03-01", "2026-06-01", "2026-09-01"]) expect(byKey.get(k)).toEqual(baseOf(k));
  });

  it("changes the open, unlocked months: more spend, the model's returning revenue, no override", () => {
    for (const k of ["2026-07-01", "2026-08-01", "2026-10-01", "2026-11-01", "2026-12-01"]) {
      const m = byKey.get(k)!;
      expect(m.inputs!.spend).toBeGreaterThan(150000);
      expect(m.inputs!.returningOverride).toBeNull();
      expect(m.inputs!.returningModel).toBe(m.inputs!.returningRevenue);
      expect(m.status).toBe("in_progress");
      expect(m.inputs!.fixedCosts).toBe(baseOf(k).inputs!.fixedCosts);
    }
  });

  it("lands the year's new revenue on last year's plus the goal", () => {
    const ly = factsFrom("2024-01-01", lastData).filter((f) => f.date.startsWith("2025")).reduce((a, f) => a + f.newOrderRevenue, 0);
    expect(out.result.reachable).toBe(true);
    expect(out.result.aboveBaseline).toBe(true);
    expect(Math.abs(out.result.annualNewRevenue / (ly * 1.2) - 1)).toBeLessThan(0.01);
  });

  it("gives daily rows for every planned month under the stretch's plan id, matching the month's new revenue", () => {
    expect(Object.keys(out.rows)).toHaveLength(12);
    const oct = out.rows["2026-10-01"];
    expect(oct).toHaveLength(31);
    expect(oct.every((r) => r.planId === "stretch")).toBe(true);
    const planned = out.result.months.find((m) => m.month === "2026-10-01")!;
    expect(Math.abs(oct.reduce((a, r) => a + r.newRevenue, 0) / planned.newRevenue - 1)).toBeLessThan(0.001);
  });
});

describe("planStretch: a year that is partly over", () => {
  const actualNew = (from: string, to: string) => factsFrom("2024-01-01", lastData).filter((f) => f.date >= from && f.date <= to).reduce((a, f) => a + f.newOrderRevenue, 0);
  const lastYearNew = actualNew("2025-01-01", "2025-12-31");

  it("counts every ended month of the year as actuals, even when the baseline never planned it", () => {
    const unplanned = baseMonths.map((m) => (m.month < "2026-04-01" ? { ...m, inputs: null } : m));
    const out = planStretch(input({ baseline: { months: unplanned, rows: Object.fromEntries(Object.entries(baseRows).filter(([k]) => k >= "2026-04-01")) } }));
    if (!out.ok) throw new Error(out.reason);
    const solved = out.result.months.reduce((a, m) => a + m.newRevenue, 0);
    // Jan to Jun are over and September is locked: the goal's year is those months' revenue plus what the other open months make.
    const septemberLocked = baseRows["2026-09-01"].reduce((a, r) => a + r.newRevenue, 0);
    expect(Math.abs((solved + actualNew("2026-01-01", "2026-06-30") + septemberLocked) / (lastYearNew * 1.2) - 1)).toBeLessThan(0.01);
    expect(Math.abs(out.result.annualNewRevenue / (lastYearNew * 1.2) - 1)).toBeLessThan(0.01);
  });

  it("leaves months the baseline never planned unplanned", () => {
    const unplanned = baseMonths.map((m) => (m.month < "2026-04-01" ? { ...m, inputs: null } : m));
    const out = planStretch(input({ baseline: { months: unplanned, rows: Object.fromEntries(Object.entries(baseRows).filter(([k]) => k >= "2026-04-01")) } }));
    if (!out.ok) throw new Error(out.reason);
    expect(out.months.filter((m) => m.month < "2026-04-01").every((m) => m.inputs === null)).toBe(true);
    expect(Object.keys(out.rows).some((k) => k < "2026-04-01")).toBe(false);
  });
});

describe("planStretch: nothing to grow from", () => {
  const thisYearOnly = factsFrom("2026-01-01", lastData);

  it("refuses a growth goal for a client with no revenue last year, and suggests the amount goal", () => {
    for (const goal of [{ metric: "newRevenueGrowth", value: 20 }, { metric: "totalRevenueGrowth", value: 20 }] as const) {
      const out = planStretch(input({ facts: thisYearOnly, goal }));
      expect(out.ok).toBe(false);
      if (!out.ok) expect(out.reason).toMatch(/last year.*total revenue for the year/i);
    }
  });

  it("still builds a stretch for an amount goal", () => {
    const out = planStretch(input({ facts: thisYearOnly, goal: { metric: "totalRevenue", value: 4000000 } }));
    expect(out.ok).toBe(true);
  });
});

describe("preflightStretch", () => {
  const { goal: _goal, planId: _planId, ...base } = input();
  void _goal;
  void _planId;

  it("is ok for a baseline that can be stretched", () => {
    expect(preflightStretch(base)).toEqual({ ok: true });
  });

  it("gives the same reasons as planStretch for what is missing", () => {
    const cases: Partial<StretchPlanInput>[] = [
      { facts: factsFrom(addDays(lastData, -20), lastData) },
      { cohort: { available: false, stats: [], cohorts: [] } },
      { baseline: { months: baseMonths.map((m) => ({ ...m, inputs: null })), rows: {} } },
    ];
    for (const c of cases) {
      const pre = preflightStretch({ ...base, ...c });
      const full = planStretch(input(c));
      expect(pre.ok).toBe(false);
      expect(full.ok).toBe(false);
      if (!pre.ok && !full.ok) expect(pre.reason).toBe(full.reason);
    }
  });

  it("does not refuse a client with no revenue last year: that only matters for a growth goal", () => {
    expect(preflightStretch({ ...base, facts: factsFrom("2026-01-01", lastData) })).toEqual({ ok: true });
  });
});
