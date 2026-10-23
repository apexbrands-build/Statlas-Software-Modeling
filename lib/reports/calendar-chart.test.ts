import { describe, expect, it } from "vitest";
import type { CalendarCell, CalendarRow } from "./calendar";
import { chartSeries } from "./calendar-chart";

const cell = (actual: number | null, goal: number | null = null): CalendarCell => ({ actual, goal, tone: "neutral", diff: null });
const row = (date: string, cells: Record<string, CalendarCell>): CalendarRow => ({ date, label: date, projected: false, actions: [], cells });

describe("chartSeries", () => {
  const rows = [row("2026-01-01", { cm: cell(100, 80), rev: cell(1000) }), row("2026-01-02", { cm: cell(300, 90), rev: cell(4000) }), row("2026-01-03", { cm: cell(null, 85), rev: cell(2000) })];

  it("gives each series its own min and max and the label and format of its metric", () => {
    const [cm, rev] = chartSeries(rows, ["cm", "rev"]);
    expect(cm).toMatchObject({ key: "cm", label: "Contribution Margin", format: "currency0", min: 0, max: 300 });
    expect(rev).toMatchObject({ key: "rev", max: 4000 });
    expect(cm.values).toEqual([100, 300, null]);
  });

  it("lines the goals up with the rows", () => {
    expect(chartSeries(rows, ["cm"])[0].goals).toEqual([80, 90, 85]);
  });

  it("a flat or empty series still gets a min below its max", () => {
    const flat = [row("a", { cm: cell(0) }), row("b", { cm: cell(0) })];
    const empty = [row("a", { cm: cell(null) })];
    for (const r of [flat, empty]) {
      const s = chartSeries(r, ["cm"])[0];
      expect(s.max).toBeGreaterThan(s.min);
    }
  });

  it("skips unknown keys and keeps the order asked for", () => {
    expect(chartSeries(rows, ["nope", "rev", "cm"]).map((s) => s.key)).toEqual(["rev", "cm"]);
    expect(chartSeries([], ["cm"])[0].values).toEqual([]);
  });
});
