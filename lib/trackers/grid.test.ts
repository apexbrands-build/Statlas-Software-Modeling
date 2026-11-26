import { describe, expect, it } from "vitest";
import { soFar, standing } from "./grid";

describe("standing: above or below a reference by more than 10%", () => {
  it("reads the app's neutral band", () => {
    expect(standing(111, 100)).toBe("above");
    expect(standing(89, 100)).toBe("below");
    expect(standing(105, 100)).toBe("on");
    expect(standing(95, 100)).toBe("on");
  });
  it("is empty when either number is missing or the reference is zero", () => {
    expect(standing(null, 100)).toBeNull();
    expect(standing(100, null)).toBeNull();
    expect(standing(100, 0)).toBeNull();
  });
});

describe("soFar: a block's spend and target on the days that have data", () => {
  const cell = (actual: number | null, target: number | null) => ({ target, projected: actual, actual, delta: null, roas: null, iRoas: null, roasTarget: null, iRoasTarget: null, launches: 0 });
  it("adds up the past days only", () => {
    expect(soFar([cell(90, 100), cell(110, 100), cell(null, 100)])).toEqual({ actual: 200, target: 200, pace: 1 });
  });
  it("has no pace without a target", () => {
    expect(soFar([cell(90, null), cell(null, null)])).toEqual({ actual: 90, target: null, pace: null });
    expect(soFar([cell(90, 0)])).toEqual({ actual: 90, target: 0, pace: null });
    expect(soFar([])).toEqual({ actual: 0, target: null, pace: null });
  });
});
