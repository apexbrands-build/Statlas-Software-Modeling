import { describe, expect, it } from "vitest";
import { defaultSettings } from "../defaults";
import { emptyTotals } from "../metrics";
import { buildPnl } from "./pnl";

describe("buildPnl", () => {
  const s = { ...defaultSettings("t"), otherVariablePct: 10, deliveryCostPerOrder: 0, cogsFlatRate: false, cogsFallbackPct: 0, monthlyFixedCosts: 1000 };
  const t = { ...emptyTotals(), days: 30, grossSales: 13000, discounts: 2200, tax: 1200, netSales: 10000, shippingCollected: 500, refunds: 800, cogs: 3000, newOrders: 80, returningOrders: 20, newOrderRevenue: 9000, returningOrderRevenue: 3500 };
  t.channels.meta_acquisition.spend = 2000;
  t.channels.google_nonbrand.spend = 500;
  const months = [...Array(12).fill(null), t];
  months[8] = t;
  const get = (key: string, by: "simplified" | "newReturning" | "paidOrganic" = "simplified") => buildPnl(months, s, by).flatMap((x) => x.rows).find((r) => r.key === key)!;

  it("contribution margin = net sales + shipping - cogs - ads - cost of delivery", () => {
    // 10,500 - 3,000 - 2,500 - 1,050
    expect(get("cm").values[8]).toBeCloseTo(3950);
    expect(get("cm").values[0]).toBeNull();
  });
  it("profit takes fixed costs off CM", () => expect(get("profit").values[8]).toBeCloseTo(2950));
  it("splits ad spend into search and social", () => {
    expect(get("search").values[8]).toBe(-500);
    expect(get("social").values[8]).toBe(-2000);
  });
  it("repeat rate = returning / total orders", () => expect(get("repeat").values[8]).toBeCloseTo(0.2));
  it("gross - discounts + shipping - refunds = operating revenue", () => {
    expect(get("gross").values[8]! + get("discounts").values[8]! + get("shipping").values[8]! + get("refunds").values[8]!).toBeCloseTo(get("opRev").values[8]!);
  });
  it("every revenue view ends at the same operating revenue", () => {
    for (const by of ["newReturning", "paidOrganic"] as const) {
      const rows = buildPnl(months, s, by)[0].rows;
      expect(rows.find((r) => r.key === "opRev")!.values[8]).toBeCloseTo(10500);
      const orderRev = rows.find((r) => r.key === "orderRevTotal")!.values[8]!;
      expect(orderRev).toBeCloseTo(12500); // gross - discounts + shipping + tax
      expect(orderRev + rows.find((r) => r.key === "tax")!.values[8]! + rows.find((r) => r.key === "refunds")!.values[8]!).toBeCloseTo(10500);
    }
  });
});
