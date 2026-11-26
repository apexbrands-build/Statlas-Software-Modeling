import { describe, expect, it } from "vitest";
import { demoHours, SeedRepository } from "./seed";

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe("the demo store's orders by hour", () => {
  // Northwind is on London time: on 2026-11-26 at 15:20 UTC its clock says 15:20 too.
  const now = new Date("2026-11-26T15:20:00Z");

  it("a finished day's hours add up to that day's fact", async () => {
    const [fact] = await new SeedRepository().getFacts("northwind", "2025-11-28", "2025-11-28");
    const hours = demoHours("northwind", "2025-11-28", "2025-11-28", now);
    expect(sum(hours.map((h) => h.newOrders))).toBe(fact.newOrders);
    expect(sum(hours.map((h) => h.returningOrders))).toBe(fact.returningOrders);
    expect(sum(hours.map((h) => h.newRevenue))).toBeCloseTo(fact.newOrderRevenue, 6);
    expect(sum(hours.map((h) => h.returningRevenue))).toBeCloseTo(fact.returningOrderRevenue, 6);
    expect(sum(hours.map((h) => h.grossSales))).toBeCloseTo(fact.grossSales, 6);
    expect(sum(hours.map((h) => h.discounts))).toBeCloseTo(fact.discounts, 6);
    expect(sum(hours.map((h) => h.shipping))).toBeCloseTo(fact.shippingCollected, 6);
    expect(sum(hours.map((h) => h.tax))).toBeCloseTo(fact.tax, 6);
  });

  it("is the same on every call, and a range returns its days in order", () => {
    const a = demoHours("northwind", "2026-11-20", "2026-11-22", now);
    expect(a).toEqual(demoHours("northwind", "2026-11-20", "2026-11-22", now));
    expect([...new Set(a.map((h) => h.date))]).toEqual(["2026-11-20", "2026-11-21", "2026-11-22"]);
  });

  it("today stops at the store's clock and later days have nothing", () => {
    const today = demoHours("northwind", "2026-11-26", "2026-11-27", now);
    expect(today.length).toBeGreaterThan(0);
    expect(today.every((h) => h.date === "2026-11-26" && h.hour <= 15)).toBe(true);
    expect(demoHours("northwind", "2026-11-27", "2026-11-28", now)).toEqual([]);
  });

  it("the repository gives the same hours for a finished day", async () => {
    expect(await new SeedRepository().getOrderHours("northwind", "2025-11-28", "2025-11-28")).toEqual(demoHours("northwind", "2025-11-28", "2025-11-28", now));
  });
});
