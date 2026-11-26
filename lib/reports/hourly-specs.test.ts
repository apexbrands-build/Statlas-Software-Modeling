import { describe, expect, it } from "vitest";
import { defaultSettings } from "../defaults";
import { aggregate, aggregatePlan, emptyTotals, METRICS } from "../metrics";
import type { DailyFact, PlanTargetDay } from "../types";
import { CALENDAR_SPECS } from "./calendar-specs";
import { DEFAULT_HOURLY_COLS, HOURLY_BLOCKS, HOURLY_SPECS, hourlySpec } from "./hourly-specs";

const settings = defaultSettings("c1");
const channels = emptyTotals().channels;
channels.meta_acquisition = { spend: 300, platformRevenue: 600, platformPurchases: 6 };
channels.google_brand = { spend: 50, platformRevenue: 400, platformPurchases: 4 };
const fact: DailyFact = { clientId: "c1", date: "2026-11-27", grossSales: 0, discounts: 0, netSales: 0, shippingCollected: 0, tax: 0, newOrderRevenue: 700, returningOrderRevenue: 500, newOrders: 7, returningOrders: 3, refunds: 0, cogs: 0, cogsUnmappedSales: 0, emailRevenue: 90, emailCampaignRevenue: 0, emailFlowRevenue: 0, emailOrders: 0, emailSent: 0, smsRevenue: 30, channels };
const totals = aggregate([fact]);
const planDay: PlanTargetDay = { planId: "p", clientId: "c1", date: "2026-11-27", orderRevenue: 1000, newRevenue: 600, returningRevenue: 400, orders: 10, newOrders: 6, spend: 300, cm: 300, spendByChannel: { meta_acquisition: 200, meta_returning: 40, google_nonbrand: 40, google_brand: 20 } };
const roas = { meta_acquisition: 2, meta_returning: 4, google_nonbrand: 3, google_brand: 12 } as Record<string, number>;
const plan = aggregatePlan([planDay], (_d, k) => roas[k] ?? null, (_d, k) => (k === "email" ? 0.2 : k === "sms" ? 0.05 : null));
const planNoRetentionTarget = aggregatePlan([planDay], (_d, k) => (k === "meta_returning" ? null : (roas[k] ?? null)));
const value = (key: string) => hourlySpec(key)!.value(totals, settings);
const goal = (key: string, p = plan) => hourlySpec(key)!.goal?.(p, settings) ?? null;

describe("hourly report columns", () => {
  it("lists the blocks in reading order, with no awareness block and no contribution margin", () => {
    expect(HOURLY_BLOCKS.map((b) => b.label)).toEqual(["Business", "Paid total", "Meta: acquisition", "Meta: retention", "Google: non-brand", "Google: brand", "Email", "SMS"]);
    expect(HOURLY_SPECS.filter((s) => s.block === "business").map((s) => s.key)).toEqual(["rev", "orders", "aov", "newRev", "newOrders", "newAov", "retRev", "spend", "mer", "amer", "cac"]);
    expect(HOURLY_SPECS.some((s) => /awareness/i.test(`${s.label} ${s.block}`))).toBe(false);
    expect(hourlySpec("cm")).toBeUndefined();
    expect(new Set(HOURLY_SPECS.map((s) => s.key)).size).toBe(HOURLY_SPECS.length);
    expect(HOURLY_SPECS.every((s) => HOURLY_BLOCKS.some((b) => b.id === s.block))).toBe(true);
  });

  it("only the order numbers have hourly actuals, and only they are on by default", () => {
    const withActuals = HOURLY_SPECS.filter((s) => !s.noHourly).map((s) => s.key);
    expect(withActuals).toEqual(["rev", "orders", "aov", "newRev", "newOrders", "newAov", "retRev"]);
    expect(DEFAULT_HOURLY_COLS).toEqual(withActuals);
    for (const key of ["spend", "mer", "amer", "cac", "paidSpend", "paidRev", "paidRoas", "metaAcqSpend", "metaRetRoas", "gNonBrandRev", "gBrandRoas", "email", "sms"]) expect(hourlySpec(key)?.noHourly).toBe(true);
  });

  it("each platform block is spend, platform revenue and ROAS", () => {
    for (const block of ["paid", "metaAcq", "metaRet", "gNonBrand", "gBrand"]) {
      expect(HOURLY_SPECS.filter((s) => s.block === block).map((s) => s.short)).toEqual(["Spend", "Platform revenue", "ROAS"]);
    }
  });

  it("uses Home's definitions for the business numbers", () => {
    expect(value("rev")).toBe(METRICS.orderRevenue.value(totals, settings));
    expect(value("orders")).toBe(10);
    expect(value("aov")).toBe(120);
    expect(value("newAov")).toBe(100);
    expect(value("retRev")).toBe(500);
    expect(value("spend")).toBe(350);
    expect(value("mer")).toBeCloseTo(1200 / 350, 10);
    expect(value("amer")).toBe(METRICS.amer.value(totals, settings));
    expect(value("cac")).toBe(50);
    expect(hourlySpec("cac")!.direction).toBe("down");
    expect(value("email")).toBe(90);
    expect(value("sms")).toBe(30);
  });

  it("knows which columns add up over the hours and which are ratios", () => {
    expect(HOURLY_SPECS.filter((s) => !s.additive).map((s) => s.key)).toEqual(["aov", "newAov", "mer", "amer", "cac", "paidRoas", "metaAcqRoas", "metaRetRoas", "gNonBrandRoas", "gBrandRoas"]);
  });

  it("takes the business goals from the plan like Home does", () => {
    expect(goal("rev")).toBe(1000);
    expect(goal("orders")).toBe(10);
    expect(goal("aov")).toBe(100);
    expect(goal("newRev")).toBe(600);
    expect(goal("newOrders")).toBe(6);
    expect(goal("newAov")).toBe(100);
    expect(goal("retRev")).toBe(400);
    expect(goal("spend")).toBe(300);
    expect(goal("mer")).toBeCloseTo(1000 / 300, 10);
    expect(goal("cac")).toBe(50);
    expect(goal("email")).toBe(200);
    expect(goal("sms")).toBe(50);
  });

  it("gives each type the Calendar report's goals: planned spend, revenue at the ROAS target, and the target", () => {
    expect(value("metaAcqSpend")).toBe(300);
    expect(value("metaAcqRoas")).toBe(2);
    expect(goal("metaAcqSpend")).toBe(200);
    expect(goal("metaAcqRev")).toBe(400);
    expect(goal("metaAcqRoas")).toBe(2);
    expect(goal("gNonBrandRoas")).toBe(3);
    expect(goal("gBrandRev")).toBe(240);
    expect(goal("gBrandRoas")).toBe(12);
    const cal = (key: string) => CALENDAR_SPECS.find((s) => s.key === key)!;
    expect(goal("metaAcqRev")).toBe(cal("fbAcqRev").goal!(plan, settings));
    expect(goal("gBrandRoas")).toBe(cal("gBrandRoas").goal!(plan, settings));
  });

  it("Meta retention has a ROAS target only when the plan's targets include the returning type", () => {
    expect(goal("metaRetSpend")).toBe(40);
    expect(goal("metaRetRev")).toBe(160);
    expect(goal("metaRetRoas")).toBe(4);
    expect(goal("metaRetSpend", planNoRetentionTarget)).toBe(40);
    expect(goal("metaRetRev", planNoRetentionTarget)).toBeNull();
    expect(goal("metaRetRoas", planNoRetentionTarget)).toBeNull();
  });

  it("the paid total adds the types up: spend, revenue at target when every spending type has one, and no blended ROAS goal", () => {
    expect(value("paidSpend")).toBe(350);
    expect(value("paidRev")).toBe(1000);
    expect(goal("paidSpend")).toBe(300);
    expect(goal("paidRev")).toBe(400 + 160 + 120 + 240);
    expect(goal("paidRev", planNoRetentionTarget)).toBeNull();
    expect(hourlySpec("paidRoas")!.goal).toBeUndefined();
  });
});
