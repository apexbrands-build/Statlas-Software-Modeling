import { describe, expect, it } from "vitest";
import { driftedMonths } from "./drift";
import type { PlanTargetDay } from "../types";

const day = (date: string, over: Partial<PlanTargetDay> = {}): PlanTargetDay => ({
  planId: "p", clientId: "c", date, orderRevenue: 1000, newRevenue: 600, returningRevenue: 400, orders: 10, newOrders: 6, spend: 300, cm: 200, spendByChannel: { meta_acquisition: 300 }, ...over,
});
const month = (m: string, n = 3, over: Partial<PlanTargetDay> = {}) => Array.from({ length: n }, (_, i) => day(`${m}-${String(i + 1).padStart(2, "0")}`, over));

describe("driftedMonths", () => {
  it("is empty when the saved targets are what the editor would generate now", () => {
    expect(driftedMonths([...month("2026-11"), ...month("2026-12")], { "2026-11": month("2026-11"), "2026-12": month("2026-12") })).toEqual([]);
  });

  it("flags a month whose days were reshaped, for example by a Calendar event added on the Calendar page after the last save", () => {
    const saved = month("2026-11");
    const generated = month("2026-11");
    generated[1] = day("2026-11-02", { spend: 450, newRevenue: 900 });
    expect(driftedMonths(saved, { "2026-11": generated })).toEqual(["2026-11"]);
  });

  it("flags a month when a cost setting changed contribution margin, even though revenue and spend did not move", () => {
    expect(driftedMonths(month("2026-11"), { "2026-11": month("2026-11", 3, { cm: 150 }) })).toEqual(["2026-11"]);
  });

  it("ignores rounding and the small shifts of a refreshed event measurement", () => {
    expect(driftedMonths(month("2026-11"), { "2026-11": month("2026-11", 3, { spend: 300.4, newRevenue: 603, returningRevenue: 399.2, orderRevenue: 1002, cm: 202 }) })).toEqual([]);
  });

  it("flags a planned month that has no saved targets at all, or a day that is missing", () => {
    expect(driftedMonths([], { "2026-11": month("2026-11") })).toEqual(["2026-11"]);
    expect(driftedMonths(month("2026-11", 2), { "2026-11": month("2026-11", 3) })).toEqual(["2026-11"]);
  });

  it("only looks at planned months and lists the drifted ones in month order", () => {
    const saved = [...month("2026-10"), ...month("2026-11"), ...month("2026-12")];
    const gen = { "2026-12": month("2026-12", 3, { spend: 900 }), "2026-10": month("2026-10", 3, { spend: 900 }), "2026-11": month("2026-11") };
    expect(driftedMonths(saved, gen)).toEqual(["2026-10", "2026-12"]);
    expect(driftedMonths(saved, {})).toEqual([]);
  });

  it("does not flag a zero that stays zero", () => {
    expect(driftedMonths(month("2026-11", 3, { cm: 0 }), { "2026-11": month("2026-11", 3, { cm: 0 }) })).toEqual([]);
  });
});
