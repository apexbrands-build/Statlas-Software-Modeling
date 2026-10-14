import { describe, expect, it } from "vitest";
import { EMPTY_HISTORY, FIXTURE_ACTIVE_ADS, FIXTURE_ADS, FIXTURE_AS_OF, FIXTURE_DAYS, FIXTURE_HISTORY, FIXTURE_SCORE_ADS, launchedAd, scoreAd } from "./fixtures";
import { adConcentration, evergreenShare, roasDegradation, scoreMetrics, spendDegradation, zeroSpendRate } from "./metrics";

describe("zero-spend rate", () => {
  it("3 of the 10 active ads had no spend in the window", () => {
    expect(zeroSpendRate(FIXTURE_ACTIVE_ADS)).toBe(0.3);
  });
  it("only spend counts: an ad that spent a little is delivering", () => {
    expect(zeroSpendRate([{ adId: "x", spend30: 0.01 }, { adId: "y", spend30: 0 }])).toBe(0.5);
  });
  it("no active ads gives null, not 0", () => {
    expect(zeroSpendRate([])).toBeNull();
  });
});

describe("ad concentration", () => {
  it("top 5 spend / spend, zero-spend ads ignored", () => {
    expect(adConcentration(FIXTURE_SCORE_ADS)).toBeCloseTo(1500 / 1600, 10);
  });
  it("fewer than 5 spenders is 1; no spend is null", () => {
    expect(adConcentration([scoreAd("x", "2026-09-01", 10, 0)])).toBe(1);
    expect(adConcentration([scoreAd("x", "2026-09-01", 0, 0)])).toBeNull();
  });
});

describe("evergreen share", () => {
  it("30 days before asOf is new, 31 days is evergreen", () => {
    expect(evergreenShare([scoreAd("n", "2026-08-31", 10, 0)], FIXTURE_AS_OF)).toBe(0);
    expect(evergreenShare([scoreAd("e", "2026-08-30", 10, 0)], FIXTURE_AS_OF)).toBe(1);
  });
  it("counts only spenders", () => {
    expect(evergreenShare(FIXTURE_SCORE_ADS, FIXTURE_AS_OF)).toBe(0.5);
    expect(evergreenShare([scoreAd("e", "2026-01-01", 0, 0)], FIXTURE_AS_OF)).toBeNull();
  });
});

describe("spend degradation", () => {
  it("week pairs with spend in both; an ad live only in week 4 is ignored", () => {
    const ads = [scoreAd("a", "2026-08-01", 300, 0, [100, 80, 60, 60]), scoreAd("b", "2026-09-25", 50, 0, [0, 0, 0, 50])];
    expect(spendDegradation(ads)).toBeCloseTo((-20 - 20 + 0) / 240, 10);
    expect(spendDegradation(FIXTURE_SCORE_ADS)).toBeCloseTo(-40 / 240, 10);
  });
  it("growth is positive; no pairs is null", () => {
    expect(spendDegradation([scoreAd("a", "2026-08-01", 0, 0, [100, 120, 0, 0])])).toBeCloseTo(0.2, 10);
    expect(spendDegradation([scoreAd("b", "2026-09-25", 50, 0, [0, 0, 0, 50])])).toBeNull();
  });
});

describe("ROAS degradation", () => {
  it("one batch: 3.0 before, 2.4 after is -0.2", () => {
    expect(roasDegradation(FIXTURE_DAYS, [FIXTURE_ADS[0]], FIXTURE_AS_OF)).toBeCloseTo(-0.2, 10);
  });
  it("second batch weighted 3x at -0.1 gives -0.125; catalog, too recent, too old and no-before batches skipped", () => {
    expect(roasDegradation(FIXTURE_DAYS, FIXTURE_ADS, FIXTURE_AS_OF)).toBeCloseTo(-0.125, 10);
  });
  it("no batches gives null", () => {
    expect(roasDegradation(FIXTURE_DAYS, [], FIXTURE_AS_OF)).toBeNull();
    expect(roasDegradation(FIXTURE_DAYS, [launchedAd({ adId: "r", launchDate: "2026-09-28", spend7: 10 })], FIXTURE_AS_OF)).toBeNull();
  });
  it("a batch with zero weight is skipped", () => {
    expect(roasDegradation(FIXTURE_DAYS, [launchedAd({ adId: "z", launchDate: "2026-09-10", spend7: 0 })], FIXTURE_AS_OF)).toBeNull();
  });
});

describe("scoreMetrics", () => {
  it("fixture history gives all five", () => {
    const m = scoreMetrics(FIXTURE_HISTORY);
    expect(m.zeroSpend).toBe(0.3);
    expect(m.concentration).toBeCloseTo(1500 / 1600, 10);
    expect(m.evergreenShare).toBe(0.5);
    expect(m.spendDegradation).toBeCloseTo(-40 / 240, 10);
    expect(m.roasDegradation).toBeCloseTo(-0.125, 10);
  });
  it("an empty history makes every metric null", () => {
    expect(scoreMetrics(EMPTY_HISTORY)).toEqual({
      zeroSpend: null,
      concentration: null,
      roasDegradation: null,
      spendDegradation: null,
      evergreenShare: null,
    });
  });
});
