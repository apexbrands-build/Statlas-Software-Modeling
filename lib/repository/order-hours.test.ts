import { describe, expect, it } from "vitest";
import { emptyTotals } from "../metrics";
import type { DailyFact } from "../types";
import { demoOrderHours, mapOrderHours, zonedInstant } from "./order-hours";

const fact = (date: string, over: Partial<DailyFact> = {}): DailyFact => ({
  clientId: "demo",
  date,
  grossSales: 9000,
  discounts: 1800,
  netSales: 6800,
  shippingCollected: 500,
  tax: 800,
  newOrderRevenue: 5100.37,
  returningOrderRevenue: 3399.63,
  newOrders: 61,
  returningOrders: 37,
  refunds: 400,
  cogs: 1000,
  cogsUnmappedSales: 0,
  emailRevenue: 0,
  emailCampaignRevenue: 0,
  emailFlowRevenue: 0,
  emailOrders: 0,
  emailSent: 0,
  channels: emptyTotals().channels,
  ...over,
});
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe("mapOrderHours", () => {
  it("reads the database rows as numbers, in day and hour order, and drops rows without a usable hour", () => {
    const out = mapOrderHours([
      { order_date: "2026-11-25", hour: 14, order_revenue: "300.50", new_revenue: "200.5", returning_revenue: "100", orders: 4, new_orders: 3, returning_orders: 1, gross_sales: "320", discounts: "40", shipping_collected: "10.5", tax: "10", last_order_at: "2026-11-25T14:52:10+00:00" },
      { order_date: "2026-11-25", hour: 9, order_revenue: 80, new_revenue: 0, returning_revenue: 80, orders: 1, new_orders: 0, returning_orders: 1, gross_sales: 80, discounts: 0, shipping_collected: 0, tax: 0, last_order_at: null },
      { order_date: "2026-11-25", hour: 24, order_revenue: 1 },
      { order_date: null, hour: 3, order_revenue: 1 },
    ]);
    expect(out.map((h) => h.hour)).toEqual([9, 14]);
    expect(out[1]).toEqual({ date: "2026-11-25", hour: 14, orderRevenue: 300.5, newRevenue: 200.5, returningRevenue: 100, orders: 4, newOrders: 3, returningOrders: 1, grossSales: 320, discounts: 40, shipping: 10.5, tax: 10, lastOrderAt: "2026-11-25T14:52:10+00:00" });
    expect(out[0].lastOrderAt).toBeNull();
  });
});

describe("zonedInstant", () => {
  it("gives the instant of a wall-clock time in a time zone", () => {
    expect(zonedInstant("2026-01-06", 19, 30, "America/Los_Angeles").toISOString()).toBe("2026-01-07T03:30:00.000Z");
    expect(zonedInstant("2026-07-01", 9, 0, "Europe/London").toISOString()).toBe("2026-07-01T08:00:00.000Z");
    expect(zonedInstant("2026-01-06", 0, 5, "nowhere/unknown").toISOString()).toBe("2026-01-06T00:05:00.000Z");
  });
});

describe("demoOrderHours", () => {
  const f = fact("2026-11-18");

  it("a finished day's hours add up to the day's fact", () => {
    const hours = demoOrderHours(f, "Europe/London");
    expect(hours.length).toBeGreaterThan(12);
    expect(hours.every((h) => h.date === f.date && h.hour >= 0 && h.hour <= 23 && h.orders > 0)).toBe(true);
    expect(sum(hours.map((h) => h.newOrders))).toBe(61);
    expect(sum(hours.map((h) => h.returningOrders))).toBe(37);
    expect(sum(hours.map((h) => h.orders))).toBe(98);
    expect(sum(hours.map((h) => h.newRevenue))).toBeCloseTo(5100.37, 6);
    expect(sum(hours.map((h) => h.returningRevenue))).toBeCloseTo(3399.63, 6);
    expect(sum(hours.map((h) => h.orderRevenue))).toBeCloseTo(8500, 6);
    expect(sum(hours.map((h) => h.grossSales))).toBeCloseTo(9000, 6);
    expect(sum(hours.map((h) => h.discounts))).toBeCloseTo(1800, 6);
    expect(sum(hours.map((h) => h.shipping))).toBeCloseTo(500, 6);
    expect(sum(hours.map((h) => h.tax))).toBeCloseTo(800, 6);
    for (const h of hours) expect(h.orderRevenue).toBeCloseTo(h.newRevenue + h.returningRevenue, 9);
  });

  it("is the same every time it is asked", () => {
    expect(demoOrderHours(f, "Europe/London")).toEqual(demoOrderHours(f, "Europe/London"));
  });

  it("stamps each hour's last order inside that hour of the store's clock", () => {
    const hours = demoOrderHours(f, "America/Los_Angeles");
    for (const h of hours) {
      const local = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit" }).formatToParts(new Date(h.lastOrderAt!));
      const part = (t: string) => local.find((p) => p.type === t)!.value;
      expect(`${part("year")}-${part("month")}-${part("day")}`).toBe(f.date);
      expect(Number(part("hour"))).toBe(h.hour);
    }
  });

  it("a day in progress stops at the clock: later hours are missing and the open hour holds part of its orders", () => {
    const full = demoOrderHours(f, "Europe/London");
    const part = demoOrderHours(f, "Europe/London", { hour: 14, minute: 30 });
    expect(part.every((h) => h.hour <= 14)).toBe(true);
    expect(part.filter((h) => h.hour < 14)).toEqual(full.filter((h) => h.hour < 14));
    const open = part.find((h) => h.hour === 14);
    const whole = full.find((h) => h.hour === 14)!;
    expect(open).toBeDefined();
    expect(open!.orders).toBeLessThan(whole.orders);
    expect(open!.orders).toBeGreaterThan(0);
    expect(new Date(open!.lastOrderAt!).getTime()).toBeLessThanOrEqual(zonedInstant(f.date, 14, 30, "Europe/London").getTime());
  });

  it("a day with no orders has no hours", () => {
    expect(demoOrderHours(fact("2026-11-18", { newOrders: 0, returningOrders: 0, newOrderRevenue: 0, returningOrderRevenue: 0, grossSales: 0, discounts: 0, shippingCollected: 0, tax: 0 }), "UTC")).toEqual([]);
  });
});
