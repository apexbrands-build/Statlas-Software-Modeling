import { describe, expect, it } from "vitest";
import type { PlanTargetDay } from "../types";
import { dailySpendColumns, defaultSpendMonth } from "./spend-columns";
import type { PlanMonth } from "./types";

const day = (spendByChannel: PlanTargetDay["spendByChannel"]): PlanTargetDay => ({
  planId: "p", clientId: "c", date: "2026-10-01", orderRevenue: 1000, newRevenue: 600, returningRevenue: 400, orders: 10, newOrders: 6, spend: 0, cm: 0, spendByChannel,
});

describe("dailySpendColumns", () => {
  it("lists Meta new, Meta returning, Google non-brand and Google brand first, then the other platforms, with the plain names the strategists use", () => {
    const rows = [day({ pinterest: 5, google_brand: 10, google_nonbrand: 20, meta_returning: 30, meta_acquisition: 40, tiktok_returning: 1 })];
    expect(dailySpendColumns(rows)).toEqual([
      { key: "meta_acquisition", label: "Meta new" },
      { key: "meta_returning", label: "Meta returning" },
      { key: "google_nonbrand", label: "Google non-brand" },
      { key: "google_brand", label: "Google brand" },
      { key: "pinterest", label: "Pinterest" },
      { key: "tiktok_returning", label: "TikTok returning" },
    ]);
  });
  it("leaves out a channel that has no spend on any day of the month", () => {
    const rows = [day({ meta_acquisition: 100, meta_returning: 0 }), day({ meta_acquisition: 50 })];
    expect(dailySpendColumns(rows).map((c) => c.key)).toEqual(["meta_acquisition"]);
  });
  it("keeps a channel that spends on only one day", () => {
    const rows = [day({ meta_acquisition: 100 }), day({ meta_acquisition: 100, google_brand: 7 })];
    expect(dailySpendColumns(rows).map((c) => c.key)).toEqual(["meta_acquisition", "google_brand"]);
  });
  it("is empty for a month with no per-platform spend", () => {
    expect(dailySpendColumns([day({})])).toEqual([]);
    expect(dailySpendColumns([])).toEqual([]);
  });
});

describe("defaultSpendMonth", () => {
  const month = (m: string, planned: boolean): PlanMonth => ({ month: m, locked: false, inputs: planned ? ({} as PlanMonth["inputs"]) : null }) as PlanMonth;
  const year = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"].map((m) => month(`2026-${m}-01`, m >= "03"));
  it("opens on the current month", () => {
    expect(defaultSpendMonth(year, "2026-10-14")).toBe("2026-10-01");
  });
  it("opens on the current month even when it has no plan yet, so the strategist can start it", () => {
    expect(defaultSpendMonth(year, "2026-02-10")).toBe("2026-02-01");
  });
  it("falls back to the first planned month when the plan is for another year", () => {
    expect(defaultSpendMonth(year, "2027-01-05")).toBe("2026-03-01");
  });
  it("falls back to the first month when nothing is planned and the year is another", () => {
    const empty = year.map((m) => ({ ...m, inputs: null }));
    expect(defaultSpendMonth(empty, "2025-06-01")).toBe("2026-01-01");
  });
});
