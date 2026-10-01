import { describe, expect, it } from "vitest";
import { eachDay } from "../dates";
import { groupDates } from "./grouping";

describe("groupDates", () => {
  const sep = eachDay("2026-09-01", "2026-09-30");
  it("daily keeps one bucket per day", () => expect(groupDates(sep, "daily")).toHaveLength(30));
  it("weekly starts on Monday", () => {
    const w = groupDates(sep, "weekly");
    expect(w[0].key).toBe("2026-08-31");
    expect(w[0].dates).toHaveLength(6); // Tue 1 .. Sun 6
    expect(w).toHaveLength(5);
  });
  it("bi-weekly pairs weeks", () => expect(groupDates(sep, "biweekly")).toHaveLength(3));
  it("monthly / quarterly / yearly", () => {
    expect(groupDates(sep, "monthly")).toHaveLength(1);
    expect(groupDates(sep, "quarterly")[0].label).toBe("2026 Q3");
    expect(groupDates(sep, "yearly")[0].label).toBe("2026");
  });
  it("day of week gives 7 rows, Monday first", () => {
    const d = groupDates(sep, "dow");
    expect(d).toHaveLength(7);
    expect(d[0].label).toBe("Monday");
  });
});
