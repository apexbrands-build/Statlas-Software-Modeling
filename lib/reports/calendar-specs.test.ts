import { describe, expect, it } from "vitest";
import { defaultSettings } from "../defaults";
import { aggregatePlan, emptyTotals } from "../metrics";
import { CALENDAR_PRESETS, CALENDAR_SPECS } from "./calendar-specs";

const spec = (key: string) => CALENDAR_SPECS.find((s) => s.key === key)!;
const settings = defaultSettings("c1");

describe("CALENDAR_SPECS", () => {
  it("has unique keys and every preset key exists", () => {
    const keys = CALENDAR_SPECS.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const p of CALENDAR_PRESETS) for (const k of p.keys ?? []) expect(keys).toContain(k);
  });

  it("starts with the thirteen business columns in the reference order", () => {
    expect(CALENDAR_SPECS.slice(0, 13).map((s) => s.key)).toEqual(["cm", "rev", "spend", "mer", "acqRev", "acqSpend", "amer", "retRev", "aov", "cac", "email", "sms", "organic"]);
  });

  it("the basic preset is cm, rev, spend, mer", () => {
    expect(CALENDAR_PRESETS.find((p) => p.id === "basic")!.keys).toEqual(["cm", "rev", "spend", "mer"]);
  });

  it("acquisition revenue is new-customer order revenue and its goal is the plan's new revenue", () => {
    const t = emptyTotals();
    t.newOrderRevenue = 3000;
    const p = aggregatePlan([]);
    p.newRevenue = 2500;
    expect(spec("acqRev").value(t, settings)).toBe(3000);
    expect(spec("acqRev").goal!(p, settings)).toBe(2500);
  });

  it("Facebook total adds the acquisition and the returning Meta channels; ROAS is revenue over spend", () => {
    const t = emptyTotals();
    t.channels.meta_acquisition = { spend: 100, platformRevenue: 300, platformPurchases: 5 };
    t.channels.meta_returning = { spend: 50, platformRevenue: 60, platformPurchases: 2 };
    expect(spec("fbSpend").value(t, settings)).toBe(150);
    expect(spec("fbRev").value(t, settings)).toBe(360);
    expect(spec("fbAcqRoas").value(t, settings)).toBeCloseTo(3, 10);
    expect(spec("fbNonAcqSpend").value(t, settings)).toBe(50);
    expect(spec("fbRoas").value(t, settings)).toBeCloseTo(360 / 150, 10);
  });

  it("platform spend has a plan goal from the planned channel spend; platform revenue has none", () => {
    const p = aggregatePlan([]);
    p.spendByChannel = { meta_acquisition: 40, meta_returning: 10 };
    expect(spec("fbSpend").goal!(p, settings)).toBe(50);
    expect(spec("fbRev").goal).toBeUndefined();
  });

  it("only CAC is lower-is-better", () => {
    expect(CALENDAR_SPECS.filter((s) => s.direction === "down").map((s) => s.key)).toEqual(["cac"]);
  });
});
