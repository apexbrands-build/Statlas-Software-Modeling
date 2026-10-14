import { describe, expect, it } from "vitest";
import type { MarketingEvent } from "./events";
import { dayHeat, monthEventCounts, monthWeeks, weekdayLabels } from "./calendar-grid";

describe("monthWeeks", () => {
  it("lays October 2026 out in Monday-first rows padded with blanks", () => {
    const w = monthWeeks("2026-10-01", "Monday");
    expect(w).toHaveLength(5);
    expect(w.every((r) => r.length === 7)).toBe(true);
    expect(w[0]).toEqual([null, null, null, "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"]);
    expect(w[4]).toEqual(["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", null]);
  });

  it("starts on Sunday or Saturday when the store does", () => {
    expect(monthWeeks("2026-10-01", "Sunday")[0]).toEqual([null, null, null, null, "2026-10-01", "2026-10-02", "2026-10-03"]);
    expect(monthWeeks("2026-10-01", "Saturday")[0]).toEqual([null, null, null, null, null, "2026-10-01", "2026-10-02"]);
  });

  it("contains every day of the month exactly once, in order, including a month that starts on the first column", () => {
    const flat = monthWeeks("2026-02-01", "Monday").flat().filter(Boolean);
    expect(flat).toHaveLength(28);
    expect(flat[0]).toBe("2026-02-01");
    expect(flat[27]).toBe("2026-02-28");
    expect(monthWeeks("2026-06-01", "Monday")[0][0]).toBe("2026-06-01");
  });

  it("falls back to Monday for an unknown week start", () => {
    expect(monthWeeks("2026-10-01", "Funday")[0]).toEqual(monthWeeks("2026-10-01", "Monday")[0]);
  });
});

describe("weekdayLabels", () => {
  it("lists the weekday names starting on the chosen day", () => {
    expect(weekdayLabels("Monday")).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
    expect(weekdayLabels("Sunday")[0]).toBe("Sun");
    expect(weekdayLabels("Saturday")[0]).toBe("Sat");
  });
});

describe("dayHeat", () => {
  const m = (spend: number, amer: number, returning: number) => ({ spend, amer, returning, label: "x" });
  it("is flat with no multipliers", () => expect(dayHeat(undefined)).toBe("flat"));
  it("is hot when any lift is 25% or more", () => {
    expect(dayHeat(m(1.4, 1, 1))).toBe("hot");
    expect(dayHeat(m(1, 1.25, 1))).toBe("hot");
    expect(dayHeat(m(1, 1, 1.3))).toBe("hot");
  });
  it("is warm between 5% and 25%", () => {
    expect(dayHeat(m(1.1, 1, 1))).toBe("warm");
    expect(dayHeat(m(1.05, 1, 1))).toBe("warm");
  });
  it("is cool when the day only runs below normal, and flat when nothing moves", () => {
    expect(dayHeat(m(0.9, 1, 1))).toBe("cool");
    expect(dayHeat(m(1.02, 1, 1))).toBe("flat");
  });
});

describe("monthEventCounts", () => {
  const ev = (id: string, date: string, endDate: string): MarketingEvent => ({ id, clientId: "c", date, endDate, type: "promotion", name: id, source: "manual" });
  it("counts each event once in every month it touches", () => {
    const counts = monthEventCounts([ev("bf", "2026-11-26", "2026-12-02"), ev("x", "2026-12-10", "2026-12-10"), ev("old", "2025-12-10", "2025-12-10")], 2026);
    expect(counts[10]).toBe(1);
    expect(counts[11]).toBe(2);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(3);
    expect(counts).toHaveLength(12);
  });
});
