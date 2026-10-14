import { describe, expect, it } from "vitest";
import { defaultSettings } from "../defaults";
import { emptyTotals } from "../metrics";
import type { ClientSettings, DailyFact } from "../types";
import { inputsFromFacts, recencyRange } from "./history";
import { mixActual, mixGet, mixOf, mixSet, planMixShares } from "./mix";
import { blankInputs, type PlanMonth, type PlanMonthInputs } from "./types";

const settings: ClientSettings = { ...defaultSettings("c"), multipliers: { meta_acquisition: 1.2, google_nonbrand: 0.75 } };
const inputs = (over: Partial<PlanMonthInputs> = {}): PlanMonthInputs => ({ ...blankInputs(), spend: 1000, amer: 2, ...over });
const month = (m: string, i: PlanMonthInputs | null): PlanMonth => ({ month: `${m}-01`, inputs: i, status: "in_progress", locked: false });

describe("mixGet, mixSet and mixActual", () => {
  it("reads and writes one line's share of order revenue without touching the others", () => {
    const i = mixSet(mixSet(inputs(), "email", 12), "organic", 30);
    expect(i.mix).toEqual({ emailPct: 12, organicPct: 30 });
    expect(mixGet(i, "email")).toBe(12);
    expect(mixGet(i, "sms")).toBe(0);
    expect(mixGet(inputs(), "organic")).toBe(0);
    expect(inputs().mix).toBeUndefined();
  });
  it("mixActual is null when the actuals carry no figure for the line", () => {
    expect(mixActual(null, "email")).toBeNull();
    expect(mixActual(inputs(), "email")).toBeNull();
    expect(mixActual(inputs({ mix: { emailPct: 8 } }), "email")).toBe(8);
    expect(mixActual(inputs({ mix: { emailPct: 8 } }), "sms")).toBeNull();
  });
});

describe("inputsFromFacts carries the revenue mix", () => {
  const fact = (over: Partial<DailyFact> = {}, ch: Partial<Record<string, { spend: number; platformRevenue: number }>> = {}): DailyFact => {
    const channels = emptyTotals().channels;
    for (const [k, v] of Object.entries(ch)) (channels as Record<string, unknown>)[k] = { spend: v!.spend, platformRevenue: v!.platformRevenue, platformPurchases: 1 };
    return { clientId: "c", date: "2026-09-01", grossSales: 0, discounts: 0, netSales: 0, shippingCollected: 0, tax: 0, newOrderRevenue: 3000, returningOrderRevenue: 2000, newOrders: 30, returningOrders: 20, refunds: 0, cogs: 0, cogsUnmappedSales: 0, emailRevenue: 500, emailCampaignRevenue: 200, emailFlowRevenue: 300, emailOrders: 5, emailSent: 1000, channels, ...over };
  };

  it("gives email and organic as a share of order revenue: organic = order revenue - paid incremental - email", () => {
    // paid incremental = 1000 x 1.2 = 1200; email 500; organic = 5000 - 1200 - 500 = 3300
    const i = inputsFromFacts([fact({}, { meta_acquisition: { spend: 400, platformRevenue: 1000 } })], 1, settings, "last_year")!;
    expect(i.mix?.emailPct).toBeCloseTo(10, 2);
    expect(i.mix?.organicPct).toBeCloseTo(66, 2);
  });

  it("leaves email out when the client has no email revenue (no data is not 0%), and never invents SMS", () => {
    const i = inputsFromFacts([fact({ emailRevenue: 0, emailCampaignRevenue: 0, emailFlowRevenue: 0 }, { meta_acquisition: { spend: 400, platformRevenue: 1000 } })], 1, settings, "last_year")!;
    expect(i.mix?.emailPct).toBeUndefined();
    expect(i.mix?.smsPct).toBeUndefined();
    expect(i.mix?.organicPct).toBeCloseTo(76, 2);
  });
});

describe("recencyRange", () => {
  it("is the last 30 or 90 whole days up to yesterday", () => {
    expect(recencyRange(30, "2026-10-14")).toEqual({ from: "2026-09-14", to: "2026-10-13", months: 30 / 30.4 });
    expect(recencyRange(90, "2026-10-14")).toEqual({ from: "2026-07-16", to: "2026-10-13", months: 90 / 30.4 });
  });
});

describe("planMixShares and mixOf", () => {
  const months = [month("2026-11", inputs({ mix: { emailPct: 10, organicPct: 25 } })), month("2026-12", inputs({ mix: { organicPct: 40 } })), month("2027-01", inputs()), month("2027-02", null)];
  const shares = planMixShares(months);

  it("keeps each month's typed shares as fractions, only for months that have some", () => {
    expect(shares["2026-11"]).toEqual({ email: 0.1, organic: 0.25 });
    expect(shares["2026-12"]).toEqual({ organic: 0.4 });
    expect(shares["2027-01"]).toBeUndefined();
    expect(shares["2027-02"]).toBeUndefined();
  });

  it("answers by the date's month and is null where nothing was planned", () => {
    const of = mixOf(shares);
    expect(of("2026-11-20", "email")).toBeCloseTo(0.1, 10);
    expect(of("2026-12-02", "email")).toBeNull();
    expect(of("2026-12-02", "organic")).toBeCloseTo(0.4, 10);
    expect(of("2027-01-05", "organic")).toBeNull();
    expect(of("2026-11-20", "sms")).toBeNull();
  });

  it("a share of 0 is a plan (nothing expected from that line), not a missing value", () => {
    const zero = planMixShares([month("2026-11", inputs({ mix: { emailPct: 0 } }))]);
    expect(zero["2026-11"]).toEqual({ email: 0 });
    expect(mixOf(zero)("2026-11-02", "email")).toBe(0);
  });
});
