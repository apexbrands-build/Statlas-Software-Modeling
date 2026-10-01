import { describe, expect, it } from "vitest";
import { defaultSettings } from "../defaults";
import { eachDay } from "../dates";
import { aggregate, cmParts, emptyTotals } from "../metrics";
import { FLAT_SEASONALITY, generateMonth } from "../planning/generate";
import { blankInputs } from "../planning/types";
import type { DailyFact } from "../types";
import { blendColumn, pnlColumns } from "./plan-pnl";
import { buildPnl } from "./pnl";

const settings = { ...defaultSettings("c"), otherVariablePct: 5, deliveryCostPerOrder: 1, monthlyFixedCosts: 1000 };
const planFor = (month: string) =>
  generateMonth({
    planId: "p",
    clientId: "c",
    month,
    inputs: { ...blankInputs(), spend: 30000, amer: 2, returningRevenue: 60000, platformPct: { meta: 100 }, rates: { discountPct: 10, shippingPct: 5, taxPct: 20, refundPct: 4, cogsPct: 30, otherVarPct: 8, newAov: 100, returningAov: 120 } },
    seasonality: FLAT_SEASONALITY,
    deliveryCostPerOrder: 2,
    excludeBrandFromAmer: false,
    excludeMetaReturningFromAmer: false,
  });
const factDay = (date: string): DailyFact => ({
  clientId: "c", date, grossSales: 1000, discounts: 100, netSales: 860, shippingCollected: 50, tax: 180, newOrderRevenue: 700, returningOrderRevenue: 300, newOrders: 7, returningOrders: 3, refunds: 40, cogs: 250, cogsUnmappedSales: 0, emailRevenue: 0, emailCampaignRevenue: 0, emailFlowRevenue: 0, emailOrders: 0, emailSent: 0, channels: emptyTotals().channels,
});

describe("plan P&L column", () => {
  const rows = planFor("2026-09-01");
  const col = blendColumn([], rows, settings)!;
  const get = (key: string, c = col) => buildPnl([c], settings).flatMap((x) => x.rows).find((r) => r.key === key)!.values[0]!;
  it("CM in the P&L equals the sum of the plan's daily CM", () => expect(get("cm")).toBeCloseTo(rows.reduce((a, r) => a + r.cm, 0), 4));
  it("revenue lines tie out", () => {
    expect(get("gross") + get("discounts") + get("shipping") + get("refunds")).toBeCloseTo(get("opRev"), 4);
    expect(get("opRev")).toBeCloseTo(cmParts(col, col.cmSettings!).netSales + cmParts(col, col.cmSettings!).shipping, 4);
  });
  it("cost of delivery and ads match the plan rows", () => {
    expect(get("totalCod")).toBeCloseTo(-rows.reduce((a, r) => a + (r.cogs ?? 0) + (r.costOfDelivery ?? 0), 0), 4);
    expect(get("totalAds")).toBeCloseTo(-30000, 4);
    expect(get("social")).toBeCloseTo(-30000, 4);
  });
  it("profit takes the plan's fixed costs off CM", () => {
    const v = buildPnl([col], settings, "simplified", [2500]).flatMap((x) => x.rows).find((r) => r.key === "profit")!.values[0]!;
    expect(v).toBeCloseTo(get("cm") - 2500, 4);
  });
});

describe("pnlColumns", () => {
  const year = 2026;
  const lastData = "2026-09-15";
  const facts = eachDay("2026-09-01", lastData).map(factDay);
  const plan = [...planFor("2026-09-01"), ...planFor("2026-10-01")];
  const fixed = Array(12).fill(null).map((_, i) => (i >= 8 ? 4000 : null));
  const run = (mode: "A" | "P" | "F") => pnlColumns(mode, year, facts, plan, lastData, settings, fixed);

  it("A shows actuals only", () => {
    const c = run("A");
    expect(c.columns[8]!.days).toBe(15);
    expect(c.columns[9]).toBeNull();
    expect(c.status[8]).toBe("Partial");
  });
  it("P shows plan only", () => {
    const c = run("P");
    expect(c.columns[8]!.days).toBe(30);
    expect(c.columns[9]!.days).toBe(31);
    expect(c.columns[0]).toBeNull();
    expect(c.status[9]).toBe("Plan");
    expect(c.fixed![8]).toBe(4000);
  });
  it("F is actual to date plus the rest of the plan", () => {
    const c = run("F");
    const sep = c.columns[8]!;
    expect(sep.days).toBe(30);
    expect(sep.newOrderRevenue).toBeCloseTo(15 * 700 + plan.filter((r) => r.date > lastData && r.date < "2026-10").reduce((a, r) => a + r.newRevenue, 0), 4);
    expect(c.status[8]).toBe("Actual + plan");
    expect(c.status[9]).toBe("Forecast");
    // total CM = actual days (client settings) + plan days (plan costs)
    const actualCm = cmParts(aggregate(facts), settings).cm;
    const planCm = plan.filter((r) => r.date > lastData).reduce((a, r) => a + r.cm, 0);
    const cmRow = buildPnl(c.columns, settings, "simplified", c.fixed).flatMap((x) => x.rows).find((r) => r.key === "cm")!;
    expect(cmRow.values[12]).toBeCloseTo(actualCm + planCm, 3);
  });
});
