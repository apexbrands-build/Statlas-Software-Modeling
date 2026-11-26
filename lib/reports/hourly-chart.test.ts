import { describe, expect, it } from "vitest";
import { defaultSettings } from "../defaults";
import type { OrderHour } from "../repository/order-hours";
import { chartSeries } from "./calendar-chart";
import { buildHourly, toChartRows } from "./hourly";
import { EVEN_SHARES } from "./hourly-shape";
import { HOURLY_SPECS } from "./hourly-specs";

const DAY = "2026-11-18";
const oh = (hour: number, rev: number): OrderHour => ({ date: DAY, hour, orderRevenue: rev, newRevenue: rev, returningRevenue: 0, orders: 1, newOrders: 1, returningOrders: 0, grossSales: rev, discounts: 0, shipping: 0, tax: 0, lastOrderAt: null });

describe("the hourly chart reuses the Calendar Report's series", () => {
  const r = buildHourly({ clientId: "c1", day: DAY, clock: { date: "2026-11-20", hour: 9, minute: 0 }, asOf: null, hours: [oh(9, 150), oh(10, 80)], specs: HOURLY_SPECS, settings: defaultSettings("c1"), compare: "plan", plan: { planId: "p", clientId: "c1", date: DAY, orderRevenue: 2400, newRevenue: 1200, returningRevenue: 1200, orders: 24, newOrders: 12, spend: 600, cm: 500, spendByChannel: {} }, roasOf: null, mixOf: null, shares: EVEN_SHARES, reference: [], cumulative: false, markers: [] });
  const rows = toChartRows(DAY, r.rows);

  it("builds a series from the hourly columns when they are passed in", () => {
    const [rev, orders] = chartSeries(rows, ["rev", "orders", "unknown"], HOURLY_SPECS);
    expect(rev).toMatchObject({ key: "rev", label: "Revenue", format: "currency0" });
    expect(rev.values[9]).toBe(150);
    expect(rev.goals[9]).toBeCloseTo(100, 9);
    expect(rev.max).toBe(150);
    expect(orders.label).toBe("Orders");
  });

  it("still reads the Calendar Report's own columns when none are passed", () => {
    // "rev" exists in both sets; "orders" only in the hourly one.
    expect(chartSeries(rows, ["rev", "orders"]).map((s) => s.label)).toEqual(["ECommerce Revenue"]);
  });
});
