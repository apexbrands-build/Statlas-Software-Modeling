import { describe, expect, it } from "vitest";
import { applyPreset, DEFAULT_VIEW, readViewState } from "./calendar-view";
import { CALENDAR_SPECS } from "./calendar-specs";

describe("applyPreset", () => {
  it("basic selects cm, rev, spend, mer and shows goals", () => {
    const s = applyPreset({ ...DEFAULT_VIEW, goals: "hide" }, "basic");
    expect(s.cols).toEqual(["cm", "rev", "spend", "mer"]);
    expect(s.goals).toBe("show");
  });

  it("onlyGoals keeps the columns and sets goals to only; hideGoals sets goals to hide", () => {
    const cols = ["cm", "rev"];
    expect(applyPreset({ ...DEFAULT_VIEW, cols }, "onlyGoals")).toMatchObject({ cols, goals: "only" });
    expect(applyPreset({ ...DEFAULT_VIEW, cols }, "hideGoals")).toMatchObject({ cols, goals: "hide" });
  });

  it("all selects every column", () => {
    expect(applyPreset({ ...DEFAULT_VIEW, cols: ["cm"] }, "all").cols).toHaveLength(CALENDAR_SPECS.length);
  });
});

describe("readViewState", () => {
  it("returns null for nothing or damaged JSON", () => {
    expect(readViewState(null)).toBeNull();
    expect(readViewState("{not json")).toBeNull();
    expect(readViewState("42")).toBeNull();
  });

  it("drops unknown column and graph keys and fills missing fields from the defaults", () => {
    const s = readViewState(JSON.stringify({ cols: ["cm", "gone"], graph: ["rev", "nope"], heat: false }))!;
    expect(s.cols).toEqual(["cm"]);
    expect(s.graph).toEqual(["rev"]);
    expect(s.heat).toBe(false);
    expect(s.chart).toBe(DEFAULT_VIEW.chart);
    expect(s.goals).toBe("show");
  });

  it("falls back to the default columns when none of the saved ones exist any more", () => {
    expect(readViewState(JSON.stringify({ cols: ["gone"] }))!.cols).toEqual(DEFAULT_VIEW.cols);
  });
});
