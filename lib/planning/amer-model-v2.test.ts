import { describe, expect, it } from "vitest";
import fixture from "./amer-model-v2.fixture.json";
import { buildSpendTable, evaluateSpend, fitNewCustomerModel, type DayPoint, type ModelSettings } from "./new-customer";

/**
 * The fixture is a generated daily_raw / dowe_raw pair and the table that Jack's C pipeline (aMER_ModelV2, src/main.c and
 * html_report.c, compiled and run unchanged) produced from it. Our TypeScript must give the same fit and table.
 */
const DAY_INDEX: Record<string, number> = { Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6 };

function jackPoints(): DayPoint[] {
  // compute_and_apply_dowe: multiplier = 1 - (share - 1/7) / (1/7); adjusted aMER = aMER × multiplier.
  const total = Object.values(fixture.dow).reduce((a, b) => a + b, 0);
  const mult = new Array<number>(7).fill(1);
  for (const [name, v] of Object.entries(fixture.dow)) mult[DAY_INDEX[name]] = 1 - ((v / total - 1 / 7) / (1 / 7));
  return (fixture.rows as [string, number, number][]).map(([date, spend, amer]) => {
    const adj = amer * mult[new Date(`${date}T00:00:00Z`).getUTCDay()];
    return { date, spend, newRevenue: spend * adj }; // weekday offsets are 0 below, so the points already carry Jack's adjustment
  });
}

const settings: ModelSettings = { newCostPct: 20, returningCostPct: 20, aov: 1, ltv60Multiplier: 1.3, ltv365Multiplier: 2, overModelPct: 0, minCm: 0, minCm60: 0, minCm365: 0 };

describe("aMER_ModelV2 (C code) vs our New Customer model", () => {
  const fit = fitNewCustomerModel(jackPoints(), [0, 0, 0, 0, 0, 0, 0])!;

  it("fits revenue vs spend as a line by default", () => {
    expect(fit.curve.kind).toBe("revenue");
    expect(fit.curve.b).toBeGreaterThan(0);
  });

  it("reproduces the C table row by row (aMER, new revenue, CM0, CM60, CM1Yr)", () => {
    const table = fixture.table;
    expect(table.length).toBe(Math.floor(fit.maxObservedSpend / 500));
    table.forEach((row) => {
      const p = evaluateSpend(fit.curve, settings, row.D * 30, 30);
      expect(Math.abs(p.amer - row.aMER)).toBeLessThanOrEqual(0.0051);
      expect(Math.abs(p.newRevenue - row.nRev)).toBeLessThanOrEqual(1.01);
      expect(Math.abs(p.cm - row.cm0)).toBeLessThanOrEqual(1.5);
      expect(Math.abs(p.ltv60Cm - row.cm60)).toBeLessThanOrEqual(1.5);
      expect(Math.abs(p.ltv365Cm - row.cm1y)).toBeLessThanOrEqual(1.5);
    });
  });

  it("flags the same Max Revenue at break-even row", () => {
    const t = buildSpendTable(fit.curve, settings, 30, fixture.table.length * 500 * 30, 500 * 30);
    const flagged = fixture.table.findIndex((r) => r.flag === "Max nRev B/E");
    expect(t.best.revenue).toBe(flagged);
  });
});
