import { describe, expect, it } from "vitest";
import { addDays } from "../dates";
import { fitChannelModel, modelRevenue, trustOf } from "./model";

/** `n` days up to 30 June 2027 on the line revenue = 2,000 + 1.8 x ad spend, with spend moving between 300 and 1,250 a day. */
const series = (n: number, spendOf: (i: number) => number = (i) => 300 + ((i * 37) % 20) * 50) => {
  const m = new Map<string, { revenue: number; adSpend: number }>();
  for (let i = 0; i < n; i++) {
    const spend = spendOf(i);
    m.set(addDays("2027-06-30", -i), { adSpend: spend, revenue: 2000 + 1.8 * spend });
  }
  return m;
};

describe("fitChannelModel: the New Customer regression on a channel's own ad spend and revenue", () => {
  const m = fitChannelModel(series(200), "2027-06-30")!;
  it("finds the line the days sit on", () => {
    expect(m).not.toBeNull();
    expect(m.fit.curve.kind).toBe("revenue");
    expect(m.fit.curve.a).toBeGreaterThan(1700);
    expect(m.fit.curve.a).toBeLessThan(2300);
    expect(m.fit.curve.b).toBeGreaterThan(1.65);
    expect(m.fit.curve.b).toBeLessThan(1.95);
  });
  it("says how far to trust it and what it was fitted on", () => {
    expect(m.trust).toBe("Good");
    expect(m.daysUsed).toBeGreaterThan(40);
    expect(m.daysUsed + m.removed.outlier + m.removed.bfcm).toBe(200);
    expect(m.from <= m.to).toBe(true);
    expect(m.dow).toHaveLength(7);
  });
  it("forecasts a month's revenue from its planned ad spend", () => {
    const rev = modelRevenue(m, 30000, "2027-09-01");
    expect(rev).toBeGreaterThan(114000 * 0.96);
    expect(rev).toBeLessThan(114000 * 1.04);
  });
  it("forecasts the base, not zero, for a month with no ad spend planned", () => {
    const base = modelRevenue(m, 0, "2027-09-01");
    expect(base).toBeGreaterThan(30 * 1700);
    expect(base).toBeLessThan(30 * 2300);
  });
});

describe("fitChannelModel: when there is not enough to fit", () => {
  it("needs 60 days with ad spend and revenue", () => {
    expect(fitChannelModel(series(59), "2027-06-30")).toBeNull();
  });
  it("ignores days with no ad spend, so a channel that never advertised has no model", () => {
    expect(fitChannelModel(series(200, () => 0), "2027-06-30")).toBeNull();
  });
  it("ignores days after the day asked", () => {
    // 400 days reach back to May 2026, so there is enough before the day asked.
    const early = fitChannelModel(series(400), "2027-01-01");
    expect(early).not.toBeNull();
    expect(early!.to <= "2027-01-01").toBe(true);
    expect(early!.removed.bfcm).toBeGreaterThan(0);
  });
});

describe("trustOf", () => {
  it("labels R² as the New Customer model does", () => {
    expect(trustOf(0.5)).toBe("Good");
    expect(trustOf(0.25)).toBe("Fair");
    expect(trustOf(0.1)).toBe("Low");
  });
});
