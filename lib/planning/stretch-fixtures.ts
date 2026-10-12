import { defaultSettings } from "../defaults";
import { eachDay } from "../dates";
import { emptyTotals } from "../metrics";
import type { DailyFact, PlanTargetDay } from "../types";
import { FLAT_SEASONALITY, generateMonth } from "./generate";
import { curveAmer, type Curve } from "./new-customer";
import type { CohortRow } from "./returning";
import { blankInputs, type PlanMonth } from "./types";

/** A client with three years of history, a fitted-looking curve and a baseline plan for 2026, shared by the stretch tests. */
export const settings = { ...defaultSettings("c"), otherVariablePct: 5, deliveryCostPerOrder: 1, monthlyFixedCosts: 1000, excludeBrandFromAmer: false, excludeMetaReturningFromAmer: false };
export const truth: Curve = { kind: "power", a: 40, b: -0.5, r2: 1 };
export const noise = (i: number) => Math.sin(i * 12.9898) * 0.5;
export const lastData = "2026-06-30";

export function factsFrom(start: string, end: string): DailyFact[] {
  return eachDay(start, end).map((date, i) => {
    const spend = 2000 + ((i * 37) % 60) * 100;
    const rev = spend * curveAmer(truth, spend) * (1 + noise(i) * 0.1);
    const channels = emptyTotals().channels;
    channels.meta_acquisition = { ...channels.meta_acquisition, spend };
    return { clientId: "c", date, grossSales: rev, discounts: 0, netSales: rev, shippingCollected: 0, tax: 0, newOrderRevenue: rev, returningOrderRevenue: 800, newOrders: rev / 100, returningOrders: 8, refunds: 0, cogs: rev * 0.3, cogsUnmappedSales: 0, emailRevenue: 0, emailCampaignRevenue: 0, emailFlowRevenue: 0, emailOrders: 0, emailSent: 0, channels };
  });
}

export const idxToMonth = (i: number) => `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}-01`;
export const lift = (p: number) => 0.08 * 0.8 ** (p - 1);
export function cohortsFor(): CohortRow[] {
  return Array.from({ length: 30 }, (_, k) => {
    const month = idxToMonth(2024 * 12 + k);
    const observed = Math.max(0, Math.floor((new Date(`${lastData}T00:00:00Z`).getTime() - new Date(`${month.slice(0, 7)}-28T00:00:00Z`).getTime()) / 86400000 / 30));
    return { month, customers: 1000, firstRevenue: 100000, periods: Array.from({ length: 24 }, (_, p) => (p + 1 <= Math.min(observed, 24) ? 100000 * lift(p + 1) : 0)) };
  });
}

export const rates = { discountPct: 10, shippingPct: 5, taxPct: 20, refundPct: 4, cogsPct: 30, otherVarPct: 8, newAov: 100, returningAov: 120 };
export const monthKeys = Array.from({ length: 12 }, (_, i) => `2026-${String(i + 1).padStart(2, "0")}-01`);
export const baseMonths: PlanMonth[] = monthKeys.map((month) => ({ month, status: "in_progress", locked: month === "2026-09-01", inputs: { ...blankInputs(), spend: 150000, amer: 0.57, returningRevenue: 40000, platformPct: { meta: 100 }, altPct: { meta: 0 }, rates } }));
export const gen = (planId: string, m: PlanMonth) => generateMonth({ planId, clientId: "c", month: m.month, inputs: m.inputs!, seasonality: FLAT_SEASONALITY, deliveryCostPerOrder: 1, excludeBrandFromAmer: false, excludeMetaReturningFromAmer: false });
export const baseRows: Record<string, PlanTargetDay[]> = Object.fromEntries(baseMonths.map((m) => [m.month, gen("base", m)]));

