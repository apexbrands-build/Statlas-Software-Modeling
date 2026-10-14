import { describe, expect, it } from "vitest";
import { defaultSettings } from "../defaults";
import { eachDay } from "../dates";
import { aggregate, cmParts, emptyTotals } from "../metrics";
import { FLAT_SEASONALITY, generateMonth } from "../planning/generate";
import { blankInputs } from "../planning/types";
import type { DailyFact } from "../types";
import type { RoasOf } from "../planning/roas";
import type { MixOf } from "../planning/mix";
import type { PlanTargetDay } from "../types";
import { blendColumn, planDayToFact, pnlColumns } from "./plan-pnl";
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

describe("plan P&L when a month has spend but no platform split", () => {
  const unsplit = generateMonth({
    planId: "p",
    clientId: "c",
    month: "2026-09-01",
    inputs: { ...blankInputs(), spend: 30000, amer: 2, returningRevenue: 60000, platformPct: {}, rates: { discountPct: 10, shippingPct: 5, taxPct: 20, refundPct: 4, cogsPct: 30, otherVarPct: 8, newAov: 100, returningAov: 120 } },
    seasonality: FLAT_SEASONALITY,
    deliveryCostPerOrder: 2,
    excludeBrandFromAmer: false,
    excludeMetaReturningFromAmer: false,
  });
  const col = blendColumn([], unsplit, settings)!;
  const get = (key: string) => buildPnl([col], settings).flatMap((x) => x.rows).find((r) => r.key === key)!.values[0]!;

  it("the plan rows really carry spend without a channel split (the situation under test)", () => {
    expect(unsplit.reduce((a, r) => a + r.spend, 0)).toBeCloseTo(30000, 4);
    expect(unsplit.every((r) => Object.keys(r.spendByChannel).length === 0)).toBe(true);
  });

  it("a plan day keeps the unsplit part of its spend as unassigned spend, and none when everything is split", () => {
    const day = unsplit[0];
    expect(planDayToFact(day).unassignedSpend).toBeCloseTo(day.spend, 6);
    expect(planDayToFact({ ...day, spendByChannel: { meta_acquisition: day.spend } }).unassignedSpend).toBeCloseTo(0, 6);
    expect(planDayToFact({ ...day, spendByChannel: { meta_acquisition: day.spend / 4 } }).unassignedSpend).toBeCloseTo((day.spend * 3) / 4, 6);
  });

  it("total advertising spend is the plan's spend, not zero", () => {
    expect(get("totalAds")).toBeCloseTo(-30000, 4);
  });

  it("the unsplit spend shows under Other, so Search, Social and Other add up to the total", () => {
    expect(get("otherAds")).toBeCloseTo(-30000, 4);
    expect(get("search") + get("social") + get("otherAds")).toBeCloseTo(get("totalAds"), 4);
  });

  it("CM in the P&L equals the sum of the plan's daily CM, so the P column no longer overstates profit", () => {
    expect(get("cm")).toBeCloseTo(unsplit.reduce((a, r) => a + r.cm, 0), 4);
  });

  it("MER and acquisition spend count the unsplit spend", () => {
    expect(get("acqSpend")).toBeCloseTo(30000, 4);
  });
});

describe("plan columns carry the channel plan: spend, ROAS targets, email, SMS and organic", () => {
  const day = (date: string, over: Partial<PlanTargetDay> = {}): PlanTargetDay => ({
    planId: "p", clientId: "c", date, orderRevenue: 1000, newRevenue: 600, returningRevenue: 400, orders: 10, newOrders: 6, spend: 200, cm: 0,
    spendByChannel: { meta_acquisition: 100, meta_returning: 40, google_nonbrand: 60 }, ...over,
  });
  const roasOf: RoasOf = (_d, ch) => ({ meta_acquisition: 2, meta_returning: 5, google_nonbrand: 3 } as Record<string, number>)[ch] ?? null;
  const mixOf: MixOf = (_d, key) => ({ email: 0.2, sms: 0.05, organic: 0.3 })[key];
  const row = (cols: ReturnType<typeof buildPnl>, key: string, i = 0) => cols.flatMap((x) => x.rows).find((r) => r.key === key)!.values[i];

  it("a plan day expects the platform revenue its spend brings at the ROAS target, with conversions at the day's new or returning AOV", () => {
    const f = planDayToFact(day("2026-10-05"), { roasOf });
    expect(f.channels.meta_acquisition.platformRevenue).toBeCloseTo(200, 8); // 100 x 2
    expect(f.channels.meta_acquisition.platformPurchases).toBeCloseTo(2, 8); // 200 / new AOV 100
    expect(f.channels.meta_returning.platformRevenue).toBeCloseTo(200, 8); // 40 x 5
    expect(f.channels.meta_returning.platformPurchases).toBeCloseTo(200 / 100, 8); // returning AOV = 400 / 4
    expect(f.channels.google_nonbrand.platformRevenue).toBeCloseTo(180, 8);
  });
  it("without a ROAS target the channel has spend only, as before", () => {
    const f = planDayToFact(day("2026-10-05"), { roasOf: (_d, ch) => (ch === "google_nonbrand" ? null : 2) });
    expect(f.channels.google_nonbrand.spend).toBe(60);
    expect(f.channels.google_nonbrand.platformRevenue).toBe(0);
    expect(planDayToFact(day("2026-10-05")).channels.meta_acquisition.platformRevenue).toBe(0);
  });
  it("email and SMS revenue are the planned shares of the day's order revenue", () => {
    const f = planDayToFact(day("2026-10-05"), { mixOf });
    expect(f.emailRevenue).toBeCloseTo(200, 8);
    expect(f.smsRevenue).toBeCloseTo(50, 8);
  });

  const plan = [day("2026-10-05"), day("2026-10-06")];
  const sections = (src: { roasOf?: RoasOf; mixOf?: MixOf }) => buildPnl([blendColumn([], plan, settings, src)], settings);
  it("the plan P&L shows each publisher's spend, planned revenue, ROAS and CPA", () => {
    const p = sections({ roasOf });
    expect(row(p, "fbSpend")).toBeCloseTo(280, 8); // (100 + 40) x 2 days
    expect(row(p, "fbRev")).toBeCloseTo(800, 8); // (200 + 200) x 2
    expect(row(p, "fbRoas")).toBeCloseTo(800 / 280, 8);
    expect(row(p, "gSpend")).toBeCloseTo(120, 8);
    expect(row(p, "gRoas")).toBeCloseTo(3, 8);
    expect(row(p, "fbCpa")).toBeCloseTo(280 / 8, 8); // conversions (2 + 2) x 2
  });
  it("shows email and SMS revenue from the plan, and organic as the planned share when the plan has one", () => {
    const p = sections({ roasOf, mixOf });
    expect(row(p, "email")).toBeCloseTo(400, 8);
    expect(row(p, "sms")).toBeCloseTo(100, 8);
    expect(row(p, "organic")).toBeCloseTo(600, 8); // 30% of 2000
  });
  it("organic is what is left (the dashboard's definition) when the plan sets no organic share", () => {
    const p = sections({ roasOf, mixOf: (_d, key) => (key === "email" ? 0.2 : null) });
    // order revenue 2000 - paid incremental at the default factors (meta 1.2, meta returning 0.6, google non-brand 0.75) - email 400
    const src = { roasOf, mixOf: (_d: string, key: "email" | "sms" | "organic") => (key === "email" ? 0.2 : null) };
    const t = blendColumn([], plan, settings, src)!;
    const paid = (200 * 1.2 + 200 * 0.6 + 180 * 0.75) * 2;
    expect(row(p, "organic")).toBeCloseTo(2000 - paid - 400, 6);
    expect(t.organicRevenue).toBeUndefined();
  });
  it("a month planning its organic share adds up with one that does not, in the year column", () => {
    const octPlan = [day("2026-10-05")];
    const novPlan = [day("2026-11-05")];
    const src = { roasOf, mixOf: (d: string, key: "email" | "sms" | "organic") => (key === "organic" && d.startsWith("2026-10") ? 0.3 : null) };
    const c = pnlColumns("P", 2026, [], [...octPlan, ...novPlan], "", settings, Array(12).fill(null), src);
    const get = (i: number) => buildPnl([c.columns[i]], settings).flatMap((x) => x.rows).find((r) => r.key === "organic")!.values[0]!;
    expect(get(9)).toBeCloseTo(300, 8);
    expect(get(12)).toBeCloseTo(get(9) + get(10), 6);
  });
  it("actual columns show ROAS and SMS too", () => {
    const f = factDay("2026-09-01");
    f.channels = { ...f.channels, meta_acquisition: { spend: 100, platformRevenue: 250, platformPurchases: 2 } };
    f.smsRevenue = 30;
    const a = buildPnl([aggregate([f])], settings);
    expect(row(a, "fbRoas")).toBeCloseTo(2.5, 8);
    expect(row(a, "sms")).toBe(30);
  });
});

describe("planned ROAS and CPA leave out spend that has no ROAS target", () => {
  // Returning audiences get no target (aMER is an acquisition measure), so their spend must not dilute the publisher's planned ROAS.
  const day = (date: string): PlanTargetDay => ({
    planId: "p", clientId: "c", date, orderRevenue: 1000, newRevenue: 600, returningRevenue: 400, orders: 10, newOrders: 6, spend: 140, cm: 0,
    spendByChannel: { meta_acquisition: 100, meta_returning: 40 },
  });
  const roasOf: RoasOf = (_d, ch) => (ch === "meta_acquisition" ? 2 : null);
  const row = (c: ReturnType<typeof blendColumn>, key: string) => buildPnl([c], settings).flatMap((x) => x.rows).find((r) => r.key === key)!.values[0];

  it("FB spend shows everything planned, ROAS and CPA are on the spend with a target", () => {
    const c = blendColumn([], [day("2026-10-05")], settings, { roasOf });
    expect(row(c, "fbSpend")).toBe(140);
    expect(row(c, "fbRev")).toBeCloseTo(200, 8);
    expect(row(c, "fbRoas")).toBeCloseTo(2, 8); // 200 / 100, not 200 / 140
    expect(row(c, "fbCpa")).toBeCloseTo(100 / 2, 8); // 100 of targeted spend over 2 conversions
  });
  it("with no ROAS targets at all the plan has no ROAS or CPA to show", () => {
    const c = blendColumn([], [day("2026-10-05")], settings);
    expect(row(c, "fbRoas")).toBeNull();
    expect(row(c, "fbCpa")).toBeNull();
  });
  it("actual days keep every dollar of spend in ROAS, also next to plan days", () => {
    const f = factDay("2026-10-01");
    f.channels = { ...f.channels, meta_acquisition: { spend: 100, platformRevenue: 250, platformPurchases: 2 }, meta_returning: { spend: 50, platformRevenue: 100, platformPurchases: 1 } };
    const c = blendColumn([f], [day("2026-10-05")], settings, { roasOf });
    expect(row(c, "fbRoas")).toBeCloseTo((250 + 100 + 200) / (150 + 100), 8);
  });
});
