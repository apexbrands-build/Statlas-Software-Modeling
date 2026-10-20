import { describe, expect, it } from "vitest";
import type { PlanMonthInputs } from "../planning/types";
import { blankInputs } from "../planning/types";
import {
  DEFAULT_CARRY,
  DEFAULT_SPEND_PER_AD,
  carryRate,
  catalogShare,
  currentSpend,
  metaSpendOf,
  monthsWithData,
  neededAds,
  spendPerNewAd,
  ctcRecommendation,
  healthMultiplier,
} from "./demand";
import { launchedAd, monthAgg } from "./fixtures";

const OPEN = "2026-10-01";

describe("carryRate", () => {
  it("median of the last 3 complete months", () => {
    const months = [
      monthAgg("2026-06-01", 1000, 0),
      monthAgg("2026-07-01", 1000, 600),
      monthAgg("2026-08-01", 1000, 800),
      monthAgg("2026-09-01", 1000, 700),
      monthAgg("2026-10-01", 1000, 2000), // open month: not complete, ignored
    ];
    const r = carryRate(months, OPEN);
    expect(r.value).toBeCloseTo(0.7, 10);
    expect(r.source).toBe("account");
    expect(r.samples.map((x) => +x.toFixed(4))).toEqual([0.6, 0.8, 0.7]);
  });
  it("clamps to 0.5 and 1.1", () => {
    const low = [monthAgg("2026-06-01", 1000, 0), monthAgg("2026-07-01", 1000, 300), monthAgg("2026-08-01", 1000, 400), monthAgg("2026-09-01", 1000, 450)];
    expect(carryRate(low, OPEN).value).toBe(0.5);
    const high = [monthAgg("2026-06-01", 1000, 0), monthAgg("2026-07-01", 1000, 1400), monthAgg("2026-08-01", 1000, 1400), monthAgg("2026-09-01", 1000, 1400)];
    expect(carryRate(high, OPEN).value).toBe(1.1);
  });
  it("two months of data use the Canon default", () => {
    const r = carryRate([monthAgg("2026-08-01", 1000, 0), monthAgg("2026-09-01", 1000, 700)], OPEN);
    expect(r.value).toBe(DEFAULT_CARRY);
    expect(r.source).toBe("defaults");
  });
  it("skips a month whose previous month had no spend", () => {
    const months = [
      monthAgg("2026-05-01", 1000, 0),
      monthAgg("2026-06-01", 1000, 500),
      monthAgg("2026-07-01", 0, 0),
      monthAgg("2026-08-01", 1000, 0),
      monthAgg("2026-09-01", 1000, 900),
    ];
    const r = carryRate(months, OPEN);
    expect(r.samples).toEqual([0.5, 0.9]);
    expect(r.value).toBeCloseTo(0.7, 10);
    expect(r.source).toBe("account");
    expect(Number.isFinite(r.value)).toBe(true);
  });
  it("monthsWithData counts months with any spend", () => {
    expect(monthsWithData([monthAgg("2026-07-01", 0, 0), monthAgg("2026-08-01", 0, 0, 50), monthAgg("2026-09-01", 10, 0)])).toBe(2);
  });
});

describe("spendPerNewAd", () => {
  const asOf = "2026-09-30";
  const ads = [
    launchedAd({ adId: "z", launchDate: "2026-06-01", spend30: 0 }),
    launchedAd({ adId: "a", launchDate: "2026-07-01", spend30: 100 }),
    launchedAd({ adId: "b", launchDate: "2026-08-31", spend30: 500 }),
    launchedAd({ adId: "young", launchDate: "2026-09-10", spend30: 9999 }),
    launchedAd({ adId: "cat", launchDate: "2026-07-01", spend30: 9999, isCatalog: true }),
    launchedAd({ adId: "old", launchDate: "2026-01-01", spend30: 9999 }),
  ];
  it("mean first-30-day spend, zero-spend ads count, young / catalog / old excluded", () => {
    const r = spendPerNewAd(ads, asOf, 6);
    expect(r).toEqual({ value: 200, source: "account", count: 3, outsideRange: false });
  });
  it("under 3 months of data uses 295", () => {
    expect(spendPerNewAd(ads, asOf, 2)).toEqual({ value: DEFAULT_SPEND_PER_AD, source: "defaults", count: 3, outsideRange: false });
  });
  it("no ads uses 295", () => {
    expect(spendPerNewAd([], asOf, 6).source).toBe("defaults");
  });
  it("150 is flagged, not changed", () => {
    const r = spendPerNewAd([launchedAd({ adId: "a", launchDate: "2026-07-01", spend30: 150 })], asOf, 6);
    expect(r.value).toBe(150);
    expect(r.outsideRange).toBe(true);
  });
});

describe("metaSpendOf", () => {
  const withPct = (platformPct: Record<string, number>): PlanMonthInputs => ({ ...blankInputs(), spend: 100_000, platformPct });
  it("spend x meta share", () => {
    expect(metaSpendOf(withPct({ meta: 60, google: 40 }))).toBe(60_000);
  });
  it("normalises shares that do not sum to 100", () => {
    expect(metaSpendOf(withPct({ meta: 30, google: 30 }))).toBe(50_000);
  });
  it("0 when no inputs, no shares or no Meta", () => {
    expect(metaSpendOf(null)).toBe(0);
    expect(metaSpendOf(withPct({}))).toBe(0);
    expect(metaSpendOf(withPct({ google: 100 }))).toBe(0);
  });
});

describe("catalogShare", () => {
  it("catalog / total over the last 3 complete months", () => {
    const months = [
      monthAgg("2026-05-01", 100, 0, 900), // older than 3 months: ignored
      monthAgg("2026-07-01", 900, 0, 100),
      monthAgg("2026-08-01", 900, 0, 100),
      monthAgg("2026-09-01", 900, 0, 100),
      monthAgg("2026-10-01", 0, 0, 1000), // open month: ignored
    ];
    expect(catalogShare(months, OPEN)).toBeCloseTo(0.1, 10);
  });
  it("0 when none", () => {
    expect(catalogShare([], OPEN)).toBe(0);
  });
});

describe("currentSpend", () => {
  const a = {
    months: [monthAgg("2026-08-01", 40_000, 0, 5_000), monthAgg("2026-09-01", 50_000, 30_000, 5_000)],
    openMonth: OPEN,
    last30NonCatalog: 52_000,
    planNonCatalog: { "2026-10-01": 55_000, "2026-11-01": 80_000 },
  };
  it("previous month complete: its actual non-catalog spend", () => {
    expect(currentSpend("2026-10-01", a)).toEqual({ value: 50_000, source: "actual" });
  });
  it("previous month is the open month: latest 30 days", () => {
    expect(currentSpend("2026-11-01", a)).toEqual({ value: 52_000, source: "last30" });
  });
  it("previous month in the future: the plan's non-catalog Meta target for it", () => {
    expect(currentSpend("2026-12-01", a)).toEqual({ value: 80_000, source: "plan" });
  });
  it("no plan for the previous month gives 0", () => {
    expect(currentSpend("2027-02-01", a)).toEqual({ value: 0, source: "plan" });
  });
});

describe("neededAds", () => {
  it("Canon formula", () => {
    expect(neededAds(88_000, 50_000, 0.7, 300)).toEqual({ needed: 177, covered: false });
  });
  it("covered by carried spend", () => {
    expect(neededAds(30_000, 50_000, 0.7, 300)).toEqual({ needed: 0, covered: true });
  });
  it("target 0 gives 0, never negative or NaN", () => {
    expect(neededAds(0, 50_000, 0.7, 300).needed).toBe(0);
    expect(neededAds(10_000, 0, 0.7, 0).needed).toBe(0);
  });
});

describe("ctcRecommendation", () => {
  const base = { lastYearAds: 80, lastYearSpend: 40000, targetSpend: 88000, score: 50, evergreenShare: 0, gap: 0 };

  it("multiplies last year's launches by the spend change, the health multiplier and the carry-forward", () => {
    expect(ctcRecommendation(base)!.ads).toBe(176);
    expect(ctcRecommendation({ ...base, score: 0 })!.health).toBeCloseTo(1.5, 10);
    expect(ctcRecommendation({ ...base, score: 100 })!.health).toBeCloseTo(0.5, 10);
    expect(ctcRecommendation({ ...base, evergreenShare: 0.4 })!.carryForward).toBeCloseTo(0.8, 10);
  });

  it("treats a missing score as neutral and limits the spend change to a quarter or four times", () => {
    expect(healthMultiplier(null)).toBe(1);
    expect(ctcRecommendation({ ...base, targetSpend: 1000000 })!.spendRatio).toBe(4);
    expect(ctcRecommendation({ ...base, targetSpend: 100 })!.spendRatio).toBe(0.25);
  });

  it("has nothing to scale without last year's spend or this month's target", () => {
    expect(ctcRecommendation({ ...base, lastYearSpend: 0 })).toBeNull();
    expect(ctcRecommendation({ ...base, targetSpend: 0 })).toBeNull();
  });

  it("is raised to what the spend gap needs at the Canon's highest spend per ad, and reports it", () => {
    const r = ctcRecommendation({ ...base, lastYearAds: 5, gap: 53000 })!;
    expect(r.raisedBySanity).toBe(true);
    expect(r.ads).toBe(Math.ceil(53000 / 397));
    expect(r.fromInputs).toBe(11);
  });
});
