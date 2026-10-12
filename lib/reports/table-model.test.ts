import { describe, expect, it } from "vitest";
import { columnTones } from "./table-model";

describe("columnTones", () => {
  it("colours each value against the column average, higher is better", () => {
    expect(columnTones([100, 100, 100, 200], "up")).toEqual(["bad", "bad", "bad", "good"]);
  });

  it("flips the colours when lower is better", () => {
    expect(columnTones([100, 100, 100, 200], "down")).toEqual(["good", "good", "good", "bad"]);
  });

  it("keeps values within 10% of the average neutral", () => {
    expect(columnTones([100, 105, 95], "up")).toEqual(["neutral", "neutral", "neutral"]);
  });

  it("ignores null values in the average and leaves them neutral", () => {
    expect(columnTones([100, null, 100, 200], "up")).toEqual(["bad", "neutral", "bad", "good"]);
  });

  it("never colours a column marked none", () => {
    expect(columnTones([1, 100, 10000], "none")).toEqual(["neutral", "neutral", "neutral"]);
  });

  it("handles an empty column and a zero average", () => {
    expect(columnTones([], "up")).toEqual([]);
    expect(columnTones([0, 0, 0], "up")).toEqual(["neutral", "neutral", "neutral"]);
  });
});
