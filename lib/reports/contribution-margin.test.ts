import { describe, expect, it } from "vitest";
import { defaultSettings } from "../defaults";
import { addDays } from "../dates";
import { aggregate, cmParts, emptyTotals } from "../metrics";
import type { DailyFact } from "../types";
import { buildCmTable, CM_COLUMNS } from "./contribution-margin";
import type { NumTable } from "./table-model";

const settings = { ...defaultSettings("c"), otherVariablePct: 5, deliveryCostPerOrder: 1, cogsFlatRate: false, cogsFallbackPct: 0 };

const day = (date: string, over: Partial<DailyFact> = {}): DailyFact => ({
  clientId: "c",
  date,
  grossSales: 1000,
  discounts: 100,
  netSales: 860,
  shippingCollected: 50,
  tax: 180,
  newOrderRevenue: 800,
  returningOrderRevenue: 330,
  newOrders: 8,
  returningOrders: 3,
  refunds: 40,
  cogs: 250,
  cogsUnmappedSales: 0,
  emailRevenue: 0,
  emailCampaignRevenue: 0,
  emailFlowRevenue: 0,
  emailOrders: 0,
  emailSent: 0,
  channels: { ...emptyTotals().channels, meta_acquisition: { spend: 200, platformRevenue: 0, platformPurchases: 0 } },
  ...over,
});
const emptyDay = (date: string) =>
  day(date, { grossSales: 0, discounts: 0, netSales: 0, shippingCollected: 0, tax: 0, newOrderRevenue: 0, returningOrderRevenue: 0, newOrders: 0, returningOrders: 0, refunds: 0, cogs: 0, channels: emptyTotals().channels });
const week = (from: string) => Array.from({ length: 7 }, (_, i) => day(addDays(from, i)));
const at = (t: NumTable, key: string, row = 0) => t.rows[row].v[key];

describe("buildCmTable", () => {
  const one = buildCmTable([day("2026-09-01")], settings, "daily");

  it("builds the revenue and product lines for one day", () => {
    expect(at(one, "grossSales")).toBe(1000);
    expect(at(one, "discounts")).toBe(100);
    expect(at(one, "shipping")).toBe(50);
    expect(at(one, "taxes")).toBe(180);
    expect(at(one, "orderRevenue")).toBe(1130);
    expect(at(one, "taxesOut")).toBe(180);
    expect(at(one, "refunds")).toBe(40);
    expect(at(one, "cogs")).toBeCloseTo(250, 6);
    expect(at(one, "productMargin")).toBeCloseTo(660, 6);
  });

  it("builds the cost and result lines for one day", () => {
    expect(at(one, "variableCost")).toBeCloseTo(56.5, 6);
    expect(at(one, "adSpend")).toBeCloseTo(200, 6);
    expect(at(one, "cm")).toBeCloseTo(403.5, 6);
  });

  it("uses the stated percentage bases", () => {
    expect(at(one, "discountsPct")).toBeCloseTo(0.1, 6);
    expect(at(one, "refundsPct")).toBeCloseTo(40 / 1130, 6);
    expect(at(one, "cogsPct")).toBeCloseTo(0.25, 6);
    expect(at(one, "productMarginPct")).toBeCloseTo(660 / 1130, 6);
    expect(at(one, "costPct")).toBeCloseTo(0.05, 6);
    expect(at(one, "adSpendPct")).toBeCloseTo(200 / 1130, 6);
    expect(at(one, "cmPct")).toBeCloseTo(403.5 / 1130, 6);
  });

  it("labels the daily row with the date", () => {
    expect(one.rows).toHaveLength(1);
    expect(one.rows[0].label.startsWith("2026-09-01")).toBe(true);
    expect(one.total.key).toBe("total");
    expect(one.total.label).toBe("Total");
  });

  it("equals the Home contribution margin for the same facts, weekly grouped", () => {
    const facts = week("2026-09-07");
    const t = buildCmTable(facts, settings, "weekly");
    expect(t.rows).toHaveLength(1);
    expect(t.total.v.cm).toBeCloseTo(cmParts(aggregate(facts), settings).cm, 6);
    expect(at(t, "cm")).toBeCloseTo(7 * 403.5, 6);
    expect(at(t, "grossSales")).toBe(7000);
  });

  it("shows no percentage when the base is zero", () => {
    const t = buildCmTable([emptyDay("2026-09-01")], settings, "daily");
    for (const key of ["discountsPct", "refundsPct", "cogsPct", "productMarginPct", "costPct", "adSpendPct", "cmPct"]) expect(at(t, key)).toBeNull();
  });

  it("handles an empty range without NaN", () => {
    const t = buildCmTable([], settings, "daily");
    expect(t.rows).toEqual([]);
    expect(t.total.v.orderRevenue).toBe(0);
    expect(t.total.v.cmPct).toBeNull();
    for (const value of Object.values(t.total.v)) expect(Number.isNaN(value)).toBe(false);
  });

  it("lists the columns in order with their groups", () => {
    expect(CM_COLUMNS.map((c) => c.key)).toEqual([
      "grossSales", "discounts", "discountsPct", "shipping", "taxes", "orderRevenue",
      "taxesOut", "refunds", "refundsPct", "cogs", "cogsPct", "productMargin", "productMarginPct",
      "variableCost", "costPct", "adSpend", "adSpendPct",
      "cm", "cmPct",
    ]);
    const groups = CM_COLUMNS.map((c) => c.group);
    expect(groups.slice(0, 6).every((g) => g === "Revenue")).toBe(true);
    expect(groups.slice(6, 13).every((g) => g === "Product")).toBe(true);
    expect(groups.slice(13, 17).every((g) => g === "Costs")).toBe(true);
    expect(groups.slice(17).every((g) => g === "Result")).toBe(true);
  });

  it("marks lower-is-better columns down and shipping and taxes as never coloured", () => {
    const dir = (k: string) => CM_COLUMNS.find((c) => c.key === k)!.direction;
    for (const k of ["discountsPct", "refundsPct", "cogsPct", "costPct", "adSpendPct"]) expect(dir(k)).toBe("down");
    for (const k of ["shipping", "taxes", "taxesOut"]) expect(dir(k)).toBe("none");
    for (const k of ["grossSales", "orderRevenue", "productMargin", "productMarginPct", "cm", "cmPct"]) expect(dir(k)).toBe("up");
  });
});
