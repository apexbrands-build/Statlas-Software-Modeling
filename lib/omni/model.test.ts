import { describe, expect, it } from "vitest";
import { addDays } from "../dates";
import { blankInputs, type PlanMonth, type PlanMonthInputs } from "../planning/types";
import { fitChannelModel, modelRevenue, planFill, recentAdSpendPace, trustOf } from "./model";

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

describe("recentAdSpendPace: the channel's own recent ad spend per day", () => {
  const upTo = (last: string, n: number, spend = 1000) => {
    const m = new Map<string, { revenue: number; adSpend: number }>();
    for (let i = 0; i < n; i++) m.set(addDays(last, -i), { revenue: 5000, adSpend: spend });
    return m;
  };
  it("averages over the days that have sales, ending on the channel's own last day", () => {
    // 37 days of data ending 30 September: the pace is 1,000 a day, not 37,000 spread over 90 days.
    expect(recentAdSpendPace(upTo("2026-09-30", 37))).toBeCloseTo(1000, 8);
  });
  it("uses the last 90 days only", () => {
    const days = upTo("2026-09-30", 90, 1000);
    for (let i = 90; i < 200; i++) days.set(addDays("2026-09-30", -i), { revenue: 5000, adSpend: 9999 });
    expect(recentAdSpendPace(days)).toBeCloseTo(1000, 8);
  });
  it("gives no pace on fewer than 28 days, or with no days at all", () => {
    expect(recentAdSpendPace(upTo("2026-09-30", 27))).toBeNull();
    expect(recentAdSpendPace(new Map())).toBeNull();
  });
});

describe("planFill: writing a channel's forecast into the plan from its model", () => {
  const model = fitChannelModel(series(200), "2027-06-30")!;
  const inputs = (over: Partial<PlanMonthInputs> = {}): PlanMonthInputs => ({ ...blankInputs(), spend: 100000, amer: 1.5, ...over });
  const month = (m: string, i: PlanMonthInputs | null, locked = false): PlanMonth => ({ month: `${m}-01`, inputs: i, status: "in_progress", locked });
  const months = [
    month("2027-06", inputs()), // closed: the month ended on the last day with data
    month("2027-07", inputs({ other: { amazon: { revenue: 50000 } } })), // a forecast typed by hand
    month("2027-08", inputs({ other: { amazon: { adSpend: 31000 } } })), // planned ad spend typed
    month("2027-09", inputs()), // nothing typed
    month("2027-10", inputs(), true), // locked
    month("2027-11", null), // not started
  ];
  const base = { months, channel: "amazon", model, lastData: "2027-06-30", siteDaily: 2000, paceDaily: 1000 as number | null, replaceTyped: false };

  it("fills the open months that have no forecast yet, and leaves a typed one alone", () => {
    const r = planFill(base);
    expect(r.filled).toEqual(["2027-08-01", "2027-09-01"]);
    expect(r.keptTyped).toEqual(["2027-07-01"]);
    expect(r.lines["2027-07-01"]).toBeUndefined();
  });
  it("uses the planned ad spend of the month, and the model's revenue at that spend", () => {
    const l = planFill(base).lines["2027-08-01"];
    expect(l.adSpend).toBe(31000);
    expect(l.revenue).toBe(Math.round(modelRevenue(model, 31000, "2027-08-01")));
  });
  it("uses the recent pace for a month with no planned ad spend, and says which", () => {
    const r = planFill(base);
    expect(r.paced).toEqual(["2027-09-01"]);
    expect(r.lines["2027-09-01"].adSpend).toBe(30000);
  });
  it("saves the own-site ad spend of the fitted days as the spend the forecast assumed", () => {
    expect(planFill(base).lines["2027-08-01"].assumedSpend).toBe(62000);
    expect(planFill(base).lines["2027-09-01"].assumedSpend).toBe(60000);
  });
  it("replaces a typed forecast only when asked to", () => {
    const r = planFill({ ...base, replaceTyped: true });
    expect(r.filled).toContain("2027-07-01");
    expect(r.keptTyped).toEqual([]);
    expect(r.lines["2027-07-01"].revenue).not.toBe(50000);
  });
  it("leaves a month empty when there is neither planned ad spend nor a pace", () => {
    const r = planFill({ ...base, paceDaily: null });
    expect(r.filled).toEqual(["2027-08-01"]);
    expect(r.noSpend).toEqual(["2027-09-01"]);
  });
  it("never touches closed, locked or unstarted months", () => {
    const r = planFill({ ...base, replaceTyped: true });
    expect(Object.keys(r.lines).sort()).toEqual(["2027-07-01", "2027-08-01", "2027-09-01"]);
  });
});
