import { describe, expect, it } from "vitest";
import { METRIC_KEYS, bandScore, creativeScore, percentileScore, scoreLabel, type MetricKey } from "./score";

const slide: Record<MetricKey, number | null> = {
  zeroRevenue: 0.37,
  concentration: 0.31,
  roasDegradation: -0.12,
  spendDegradation: -0.34,
  evergreenShare: 0.33,
};

describe("bandScore", () => {
  it("zero-revenue anchors", () => {
    expect(bandScore("zeroRevenue", 0.37)).toBe(90);
    expect(bandScore("zeroRevenue", 0.25)).toBe(100);
    expect(bandScore("zeroRevenue", 0.2)).toBe(100);
    expect(bandScore("zeroRevenue", 0.7)).toBe(0);
    expect(bandScore("zeroRevenue", 0.9)).toBe(0);
    expect(bandScore("zeroRevenue", 0.5)).toBe(55);
  });
  it("concentration anchors", () => {
    expect(bandScore("concentration", 0.31)).toBe(41);
    expect(bandScore("concentration", 0.15)).toBe(100);
    expect(bandScore("concentration", 0.42)).toBe(0);
    expect(bandScore("concentration", 0.5)).toBe(0);
  });
  it("ROAS degradation is graded, improvements score higher", () => {
    expect(bandScore("roasDegradation", -0.12)).toBe(18);
    expect(bandScore("roasDegradation", -0.15)).toBe(0);
    expect(bandScore("roasDegradation", -0.3)).toBe(0);
    expect(bandScore("roasDegradation", 0)).toBe(80);
    expect(bandScore("roasDegradation", 0.05)).toBe(90);
    expect(bandScore("roasDegradation", 0.1)).toBe(100);
    expect(bandScore("roasDegradation", 0.4)).toBe(100);
  });
  it("spend degradation is graded", () => {
    expect(bandScore("spendDegradation", -0.34)).toBe(80);
    expect(bandScore("spendDegradation", -1)).toBe(0);
    expect(bandScore("spendDegradation", -0.67)).toBe(40);
    expect(bandScore("spendDegradation", 0)).toBe(90);
    expect(bandScore("spendDegradation", 0.2)).toBe(100);
    expect(bandScore("spendDegradation", 0.5)).toBe(100);
  });
  it("evergreen share anchors", () => {
    expect(bandScore("evergreenShare", 0.33)).toBe(76);
    expect(bandScore("evergreenShare", 0.5)).toBe(100);
    expect(bandScore("evergreenShare", 0.8)).toBe(100);
    expect(bandScore("evergreenShare", 0)).toBe(0);
  });
  it("null stays null", () => {
    for (const k of METRIC_KEYS) expect(bandScore(k, null)).toBeNull();
  });
});

describe("reference slide", () => {
  it("gives parts [90, 41, 18, 80, 76] and an equal-weight 61 (slide shows 56, weights unknown)", () => {
    const r = creativeScore(slide);
    expect(METRIC_KEYS.map((k) => r.parts[k])).toEqual([90, 41, 18, 80, 76]);
    expect(r.score).toBe(61);
    expect(r.mode).toBe("provisional");
  });
});

describe("percentileScore", () => {
  it("lower is better", () => {
    expect(percentileScore(0.2, [0.1, 0.3, 0.5, 0.7], "lower")).toBe(75);
  });
  it("higher mirrors it", () => {
    expect(percentileScore(0.2, [0.1, 0.3, 0.5, 0.7], "higher")).toBe(25);
  });
  it("ties count half", () => {
    expect(percentileScore(0.3, [0.1, 0.3, 0.5, 0.7], "lower")).toBe(62.5);
  });
  it("closerToZero ranks by absolute value", () => {
    expect(percentileScore(-0.1, [0.05, -0.2, 0.3, -0.4], "closerToZero")).toBe(75);
  });
});

describe("creativeScore", () => {
  it("averages the non-null parts", () => {
    const r = creativeScore({ ...slide, roasDegradation: null });
    expect(r.parts.roasDegradation).toBeNull();
    expect(r.score).toBe(Math.round((90 + 41 + 80 + 76) / 4));
  });
  it("all null gives a null score", () => {
    const r = creativeScore({ zeroRevenue: null, concentration: null, roasDegradation: null, spendDegradation: null, evergreenShare: null });
    expect(r.score).toBeNull();
  });
  it("switches to percentile only with 10 portfolio values for every metric", () => {
    const nine = Object.fromEntries(METRIC_KEYS.map((k) => [k, Array.from({ length: 9 }, (_, i) => i / 10)]));
    expect(creativeScore(slide, nine).mode).toBe("provisional");
    const ten = Object.fromEntries(METRIC_KEYS.map((k) => [k, Array.from({ length: 10 }, (_, i) => i / 10)]));
    const r = creativeScore(slide, ten);
    expect(r.mode).toBe("percentile");
    // zero-revenue 0.37 beats 0.4..0.9 (6 of 10), lower is better
    expect(r.parts.zeroRevenue).toBe(60);
    const partial = { ...ten, evergreenShare: [0.1] };
    expect(creativeScore(slide, partial).mode).toBe("provisional");
    expect(creativeScore(slide, null).mode).toBe("provisional");
  });
});

describe("scoreLabel", () => {
  it("bands", () => {
    expect(scoreLabel(49)).toBe("Poor");
    expect(scoreLabel(50)).toBe("Average");
    expect(scoreLabel(74)).toBe("Average");
    expect(scoreLabel(75)).toBe("Great");
  });
});
