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

describe("platform blocks: goals from the plan's ROAS targets", () => {
  const plan = () => {
    const p = aggregatePlan([]);
    p.spendByChannel = { meta_acquisition: 800, meta_returning: 200, google_nonbrand: 700, google_brand: 300 };
    p.platformRoasPlan = { meta_acquisition: { spend: 800, expectedRevenue: 1600 }, google_nonbrand: { spend: 700, expectedRevenue: 2450 }, google_brand: { spend: 300, expectedRevenue: 4500 } };
    return p;
  };
  it("a block of one type gets the platform revenue its planned spend should bring, and its ROAS target", () => {
    expect(spec("fbAcqRev").goal!(plan(), settings)).toBe(1600);
    expect(spec("fbAcqRoas").goal!(plan(), settings)).toBeCloseTo(2);
    expect(spec("gAcqRoas").goal!(plan(), settings)).toBeCloseTo(3.5);
    expect(spec("gBrandRev").goal!(plan(), settings)).toBe(4500);
    expect(spec("gBrandRoas").goal!(plan(), settings)).toBeCloseTo(15);
  });
  it("gives no goal column to a block whose type the plan sets no ROAS target for", () => {
    expect(spec("fbNonAcqRev").goal).toBeUndefined();
    expect(spec("fbNonAcqRoas").goal).toBeUndefined();
    expect(spec("fbRev").goal).toBeUndefined();
    expect(spec("fbRoas").goal).toBeUndefined();
  });
  it("a block that mixes types gets a revenue goal when all its planned spend has a target, and never a blended ROAS goal", () => {
    expect(spec("gRev").goal!(plan(), settings)).toBe(6950);
    // The mix that is spent differs from the mix that was planned: ROAS is read type by type.
    expect(spec("gRoas").goal).toBeUndefined();
    const part = plan();
    part.spendByChannel.google_nonbrand_returning = 50;
    expect(spec("gRev").goal!(part, settings)).toBeNull();
  });
  it("has no goal when the plan holds no ROAS target for the block", () => {
    expect(spec("fbAcqRev").goal!(aggregatePlan([]), settings)).toBeNull();
    expect(spec("fbAcqRoas").goal!(aggregatePlan([]), settings)).toBeNull();
  });
});
