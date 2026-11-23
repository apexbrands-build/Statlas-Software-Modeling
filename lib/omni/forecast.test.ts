import { describe, expect, it } from "vitest";
import { addDays, dayOfWeek } from "../dates";
import { defaultSettings } from "../defaults";
import { blankInputs, type PlanMonth, type PlanMonthInputs } from "../planning/types";
import type { ClientSettings, OtherChannel } from "../types";
import { dailyForecast, dailyTotals, monthLines, needsCurve, spreadMonth, weekdayShares } from "./forecast";
import type { ChannelSale } from "./types";

const sale = (date: string, revenue: number, over: Partial<ChannelSale> = {}): ChannelSale => ({ date, channel: "amazon", retailer: "", revenue, orders: 0, units: 0, adSpend: 0, source: "import", ...over });
const amazon: OtherChannel = { key: "amazon", label: "Amazon", kind: "marketplace", costPct: 65, aov: 30 };
const settings = (): ClientSettings => {
  const base = defaultSettings("c");
  return { ...base, multipliers: { meta_acquisition: 1.2 }, extra: { ...base.extra, halo: { channels: [amazon], cells: { meta_acquisition: { amazon: { value: 0.2, source: "own_test" } } } } } };
};
const inputs = (over: Partial<PlanMonthInputs> = {}): PlanMonthInputs => ({ ...blankInputs(), spend: 100000, amer: 1.5, platformPct: { meta: 100 }, altPct: {}, ...over });
const month = (m: string, i: PlanMonthInputs | null): PlanMonth => ({ month: `${m}-01`, inputs: i, status: "in_progress", locked: false });

describe("dailyTotals", () => {
  it("adds the retailers of a day together and leaves other channels out", () => {
    const days = dailyTotals(
      [sale("2027-03-01", 100, { channel: "retail", retailer: "Target", units: 5 }), sale("2027-03-01", 40, { channel: "retail", retailer: "H-E-B", units: 2, adSpend: 3 }), sale("2027-03-01", 999)],
      "retail",
    );
    expect(days.size).toBe(1);
    expect(days.get("2027-03-01")).toEqual({ revenue: 140, orders: 0, units: 7, adSpend: 3 });
  });
});

describe("weekdayShares: the channel's own weekday pattern", () => {
  const series = (n: number) => {
    const m = new Map<string, { revenue: number }>();
    for (let i = 0; i < n; i++) {
      const d = addDays("2027-06-30", -i);
      m.set(d, { revenue: dayOfWeek(d) === 0 ? 200 : 100 });
    }
    return m;
  };
  it("gives seven weights that average 1, once there are 8 weeks of sales", () => {
    const s = weekdayShares(series(56), "2027-06-30")!;
    expect(s).toHaveLength(7);
    expect(s.reduce((a, b) => a + b, 0) / 7).toBeCloseTo(1, 10);
    expect(s[0]).toBeCloseTo(1.75, 10);
    expect(s[1]).toBeCloseTo(0.875, 10);
  });
  it("is null under 8 weeks, so the month is spread evenly", () => {
    expect(weekdayShares(series(55), "2027-06-30")).toBeNull();
  });
  it("only looks at the last 12 months up to the day asked", () => {
    expect(weekdayShares(series(56), "2029-01-01")).toBeNull();
  });
});

describe("spreadMonth", () => {
  it("spreads a month evenly with no pattern", () => {
    const d = spreadMonth(31000, "2027-01-01", null);
    expect(d.size).toBe(31);
    expect(d.get("2027-01-15")).toBeCloseTo(1000, 8);
  });
  it("follows the weekday pattern and still adds up to the month", () => {
    const d = spreadMonth(31000, "2027-01-01", [1.75, 0.875, 0.875, 0.875, 0.875, 0.875, 0.875]);
    expect([...d.values()].reduce((a, b) => a + b, 0)).toBeCloseTo(31000, 6);
    expect(d.get("2027-01-03")! / d.get("2027-01-04")!).toBeCloseTo(2, 8); // a Sunday against a Monday
  });
});

describe("monthLines: each channel's month, from the plan", () => {
  it("gives the forecast, what the ads created and the channel's planned ad spend", () => {
    const lines = monthLines([month("2027-03", inputs({ other: { amazon: { revenue: 100000, adSpend: 8000 } } })), month("2027-04", null)], settings(), null);
    expect(Object.keys(lines)).toEqual(["2027-03"]);
    expect(lines["2027-03"].amazon.forecast).toBe(100000);
    expect(lines["2027-03"].amazon.created).toBeCloseTo(25000, 6);
    expect(lines["2027-03"].amazon.halo).toBeCloseTo(25000, 6);
    expect(lines["2027-03"].amazon.capped).toBe(false);
    expect(lines["2027-03"].amazon.adSpend).toBe(8000);
  });
  it("has no forecast for a channel with nothing typed", () => {
    expect(monthLines([month("2027-03", inputs())], settings(), null)["2027-03"].amazon.forecast).toBeNull();
  });
});

describe("needsCurve", () => {
  it("is only needed when a line assumed an ad spend other than the plan's or none", () => {
    expect(needsCurve([month("2027-03", inputs({ other: { amazon: { revenue: 1 } } }))])).toBe(false);
    expect(needsCurve([month("2027-03", inputs({ other: { amazon: { revenue: 1, assumedSpend: 0 } } }))])).toBe(false);
    expect(needsCurve([month("2027-03", inputs({ other: { amazon: { revenue: 1, assumedSpend: 50000 } } }))])).toBe(true);
    expect(needsCurve([month("2027-03", null)])).toBe(false);
  });
});

describe("dailyForecast", () => {
  const lines = monthLines([month("2027-03", inputs({ other: { amazon: { revenue: 31000 } } })), month("2027-04", inputs())], settings(), null);
  it("covers only the days of months that have a forecast", () => {
    const f = dailyForecast(lines, "amazon", "2027-03-15", "2027-04-10", null);
    expect(f.size).toBe(17);
    expect(f.get("2027-03-15")).toBeCloseTo(1000, 8);
    expect(f.has("2027-04-01")).toBe(false);
  });
  it("is empty for a channel the plan does not know", () => {
    expect(dailyForecast(lines, "gone", "2027-03-01", "2027-03-31", null).size).toBe(0);
  });
});
