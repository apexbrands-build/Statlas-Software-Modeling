import { describe, expect, it } from "vitest";
import { defaultSettings } from "../defaults";
import { addDays, dayOfWeek, eachDay } from "../dates";
import { emptyTotals } from "../metrics";
import type { DailyFact } from "../types";
import { dowFromHistory, inputsFromFacts, isBfcm, sourceRange } from "./history";

const fact = (date: string, over: Partial<DailyFact> = {}): DailyFact => ({
  clientId: "c", date, grossSales: 0, discounts: 0, netSales: 0, shippingCollected: 0, tax: 0, newOrderRevenue: 0, returningOrderRevenue: 0, newOrders: 0, returningOrders: 0, refunds: 0, cogs: 0, cogsUnmappedSales: 0, emailRevenue: 0, emailCampaignRevenue: 0, emailFlowRevenue: 0, emailOrders: 0, emailSent: 0, channels: emptyTotals().channels, ...over,
});

describe("dowFromHistory", () => {
  const asOf = "2026-09-30";
  const days = eachDay(addDays(asOf, -364), asOf);
  it("finds a Sunday peak and offsets that sum to ~0", () => {
    const facts = days.map((d) => fact(d, { newOrderRevenue: dayOfWeek(d) === 0 ? 1500 : 1000 }));
    const s = dowFromHistory(facts, asOf)!;
    expect(s.dow[0]).toBeGreaterThan(30);
    expect(s.dow.reduce((a, b) => a + b, 0)).toBeCloseTo(0, 0);
  });
  it("ignores a one-off spike", () => {
    const facts = days.map((d) => fact(d, { newOrderRevenue: d === "2026-03-03" ? 100000 : 1000 }));
    expect(Math.abs(dowFromHistory(facts, asOf)!.dow[2])).toBeLessThan(1);
  });
  it("knows the Black Friday week", () => {
    expect(isBfcm("2025-11-28")).toBe(true);
    expect(isBfcm("2025-11-10")).toBe(false);
  });
  it("returns null with too little data", () => expect(dowFromHistory(days.slice(-20).map((d) => fact(d, { newOrderRevenue: 10 })), asOf)).toBeNull());
});

describe("inputsFromFacts", () => {
  const s = { ...defaultSettings("c"), otherVariablePct: 8 };
  const facts = eachDay("2025-09-01", "2025-09-30").map((d) => {
    const f = fact(d, { grossSales: 1100, discounts: 100, netSales: 960, refunds: 40, shippingCollected: 50, tax: 200, newOrderRevenue: 800, returningOrderRevenue: 400, newOrders: 10, returningOrders: 4, cogs: 300 });
    f.channels = { ...f.channels, meta_acquisition: { spend: 300, platformRevenue: 0, platformPurchases: 0 }, google_nonbrand: { spend: 90, platformRevenue: 0, platformPurchases: 0 }, google_brand: { spend: 10, platformRevenue: 0, platformPurchases: 0 } };
    return f;
  });
  it("derives spend, aMER, returning revenue and rates", () => {
    const i = inputsFromFacts(facts, 1, s, "last_year")!;
    expect(i.spend).toBe(12000);
    expect(i.amer).toBe(2);
    expect(i.returningRevenue).toBe(12000);
    expect(i.platformPct).toEqual({ meta: 75, google: 25 });
    expect(i.altPct.google).toBe(10);
    expect(i.rates.discountPct).toBeCloseTo(9.09, 1);
    expect(i.rates.newAov).toBe(80);
    expect(i.rates.otherVarPct).toBe(8);
  });
  it("applies growth to spend and returning only", () => {
    const i = inputsFromFacts(facts, 1, s, "last_year", 10)!;
    expect(i.spend).toBe(13200);
    expect(i.amer).toBe(2);
  });
  it("averages over several months", () => expect(inputsFromFacts(facts, 3, s, "recent")!.spend).toBe(4000));
  it("is null without data", () => expect(inputsFromFacts([], 1, s, "actuals")).toBeNull());
});

describe("sourceRange", () => {
  it("covers the same month last year", () => expect(sourceRange("last_year", "2026-09-01", "2026-10-01")).toEqual({ from: "2025-09-01", to: "2025-09-30", months: 1 }));
  it("covers the 3 complete months before today", () => expect(sourceRange("recent", "2026-11-01", "2026-10-01")).toEqual({ from: "2026-07-01", to: "2026-09-30", months: 3 }));
});
