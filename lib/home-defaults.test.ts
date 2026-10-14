import { describe, expect, it } from "vitest";
import { defaultCompareMode } from "./dashboard-data";
import { defaultHomeRange } from "./dates";

describe("defaultHomeRange", () => {
  it("is the month so far: the 1st to yesterday, so a year-over-year or previous-period comparison covers the same days", () => {
    expect(defaultHomeRange("2026-10-14")).toEqual({ from: "2026-10-01", to: "2026-10-13" });
    expect(defaultHomeRange("2026-10-02")).toEqual({ from: "2026-10-01", to: "2026-10-01" });
  });
  it("is the whole of last month on the 1st, when this month has no finished day yet", () => {
    expect(defaultHomeRange("2026-10-01")).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(defaultHomeRange("2026-01-01")).toEqual({ from: "2025-12-01", to: "2025-12-31" });
  });
});

describe("defaultCompareMode", () => {
  it("opens on Plan when the client has a plan for the range, so Home tracks each day against its target", () => {
    expect(defaultCompareMode(null, true)).toBe("plan");
  });
  it("opens on last year when there is no plan to compare with", () => {
    expect(defaultCompareMode(null, false)).toBe("yoy");
  });
  it("keeps whatever the strategist chose, even Plan on a client with no plan", () => {
    expect(defaultCompareMode("prev", true)).toBe("prev");
    expect(defaultCompareMode("yoy", true)).toBe("yoy");
    expect(defaultCompareMode("plan", false)).toBe("plan");
  });
});
