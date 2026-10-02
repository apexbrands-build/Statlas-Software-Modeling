import { describe, expect, it } from "vitest";
import { forecastReturning, type CohortRow } from "./returning";

const idxToMonth = (i: number) => `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}-01`;
const lift = (p: number) => 0.08 * 0.8 ** (p - 1);

/** 30 monthly cohorts from 2024-01, each F = 100,000, repeat revenue following `lift` (x boost for the newest ones). */
function world(boostFrom = 999, boost = 1) {
  const lastData = "2026-06-30";
  const cohorts: CohortRow[] = [];
  for (let k = 0; k < 30; k++) {
    const month = idxToMonth(2024 * 12 + k);
    const observed = Math.max(0, Math.floor((new Date(`${lastData}T00:00:00Z`).getTime() - new Date(`${month.slice(0, 7)}-28T00:00:00Z`).getTime()) / 86400000 / 30));
    const m = k >= boostFrom ? boost : 1;
    cohorts.push({ month, customers: 1000, firstRevenue: 100000, periods: Array.from({ length: 24 }, (_, p) => (p + 1 <= Math.min(observed, 24) ? 100000 * lift(p + 1) * m : 0)) });
  }
  return { lastData, cohorts };
}

/** Actual monthly returning revenue implied by the cohorts (no pre-cohort). */
function actuals(cohorts: CohortRow[]): Record<string, number> {
  const out = new Map<number, number>();
  for (const c of cohorts) {
    const base = Number(c.month.slice(0, 4)) * 12 + Number(c.month.slice(5, 7)) - 1;
    c.periods.forEach((r, p) => {
      out.set(base + p, (out.get(base + p) ?? 0) + r / 2);
      out.set(base + p + 1, (out.get(base + p + 1) ?? 0) + r / 2);
    });
  }
  const res: Record<string, number> = {};
  for (let i = 2024 * 12; i <= 2026 * 12 + 4; i++) res[idxToMonth(i)] = out.get(i) ?? 0; // through May 2026 (complete months)
  return res;
}

describe("returning customer model", () => {
  it("learns the lift curve from cohorts", () => {
    const { cohorts, lastData } = world();
    const r = forecastReturning({ cohorts, lastData, actualReturning: actuals(cohorts), futureNew: {}, from: "2026-07-01", to: "2026-12-01", seasonality: false })!;
    expect(r).not.toBeNull();
    expect(r.lifts[0]).toBeCloseTo(lift(1), 4);
    expect(r.lifts[5]).toBeCloseTo(lift(6), 4);
    expect(r.matrix.length).toBe(12);
  });

  it("future cohorts add revenue on top of what existing cohorts still deliver", () => {
    const { cohorts, lastData } = world();
    const base = { cohorts, lastData, actualReturning: actuals(cohorts), from: "2026-07-01", to: "2026-12-01", seasonality: false };
    const without = forecastReturning({ ...base, futureNew: {} })!;
    const withNew = forecastReturning({ ...base, futureNew: { "2026-07-01": 100000, "2026-08-01": 100000 } })!;
    const jul = withNew.months.find((m) => m.month === "2026-07-01")!;
    const julWithout = without.months.find((m) => m.month === "2026-07-01")!;
    expect(jul.futureCohorts).toBeCloseTo(100000 * lift(1) * 0.5, 0);
    expect(jul.total).toBeGreaterThan(julWithout.total);
    expect(julWithout.futureCohorts).toBe(0);
    const aug = withNew.months.find((m) => m.month === "2026-08-01")!;
    // July cohort: half of period 1 and half of period 2 land in August; August cohort: half of period 1.
    expect(aug.futureCohorts).toBeCloseTo(100000 * lift(1) + 100000 * lift(2) * 0.5, 0);
  });

  it("actualizing scales the forecast when recent cohorts behave better", () => {
    const { cohorts, lastData } = world(26, 1.5); // the last cohorts retain 50% better
    const base = { cohorts, lastData, actualReturning: actuals(cohorts), futureNew: { "2026-07-01": 100000 }, from: "2026-07-01", to: "2026-09-01", seasonality: false };
    const plain = forecastReturning({ ...base })!;
    const actualized = forecastReturning({ ...base, calibrationMonths: 2 })!;
    expect(actualized.calibration).toBeGreaterThan(1);
    expect(plain.calibration).toBe(1);
    const sum = (r: typeof plain) => r.months.reduce((a, m) => a + m.total, 0);
    expect(sum(actualized)).toBeGreaterThan(sum(plain));
  });

  it("returns null without enough cohorts", () => {
    const { cohorts, lastData } = world();
    expect(forecastReturning({ cohorts: cohorts.slice(0, 2), lastData, actualReturning: {}, futureNew: {}, from: "2026-07-01", to: "2026-08-01" })).toBeNull();
  });
});
