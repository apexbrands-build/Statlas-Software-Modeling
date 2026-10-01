import { aggregate, cmParts, type Totals } from "../metrics";
import { endOfMonth } from "../dates";
import { CHANNEL_KEYS, type ClientSettings, type DailyFact, type PlanTargetDay } from "../types";
import type { PnlTotals } from "./pnl";

export type PnlMode = "A" | "P" | "F";

/** A plan day shaped like an actual day, so the P&L builder can treat both the same way. */
export function planDayToFact(r: PlanTargetDay): DailyFact {
  const refunds = r.refunds ?? 0;
  const gross = r.grossSales ?? r.orderRevenue;
  const discounts = r.discounts ?? 0;
  const channels = Object.fromEntries(CHANNEL_KEYS.map((k) => [k, { spend: r.spendByChannel[k] ?? 0, platformRevenue: 0, platformPurchases: 0 }])) as DailyFact["channels"];
  return {
    clientId: r.clientId,
    date: r.date,
    grossSales: gross,
    discounts,
    netSales: gross - discounts - refunds,
    shippingCollected: r.shipping ?? 0,
    tax: r.tax ?? 0,
    newOrderRevenue: r.newRevenue,
    returningOrderRevenue: r.returningRevenue,
    newOrders: r.newOrders,
    returningOrders: Math.max(0, r.orders - r.newOrders),
    refunds,
    cogs: r.cogs ?? 0,
    cogsUnmappedSales: 0,
    emailRevenue: 0,
    emailCampaignRevenue: 0,
    emailFlowRevenue: 0,
    emailOrders: 0,
    emailSent: 0,
    channels,
  };
}

/**
 * One P&L column from actual days plus plan days (either may be empty).
 * Costs are fixed explicitly so CM follows the same formula as the dashboard: actual days use the client's settings,
 * plan days use the plan's own COGS and cost of delivery.
 */
export function blendColumn(actual: DailyFact[], plan: PlanTargetDay[], s: ClientSettings): PnlTotals | null {
  if (!actual.length && !plan.length) return null;
  const tA = aggregate(actual);
  const costsA = actual.length ? cmParts(tA, s) : { cogs: 0, costOfDelivery: 0 };
  const t: PnlTotals = aggregate([...actual, ...plan.map(planDayToFact)]);
  const planCogs = plan.reduce((a, r) => a + (r.cogs ?? 0), 0);
  const planCod = plan.reduce((a, r) => a + (r.costOfDelivery ?? 0), 0);
  const orders = t.newOrders + t.returningOrders;
  t.cogs = costsA.cogs + planCogs;
  t.cogsUnmappedSales = 0;
  t.cmSettings = { ...s, cogsFlatRate: false, cogsFallbackPct: 0, otherVariablePct: 0, deliveryCostPerOrder: orders > 0 ? (costsA.costOfDelivery + planCod) / orders : 0 };
  return t;
}

export interface PnlColumns {
  /** 12 months then the year; null where there is nothing to show. */
  columns: (Totals | null)[];
  /** Label under each month: Actual / Partial / Plan / Forecast. */
  status: string[];
  /** Monthly fixed costs (SG&A) per month, or undefined to use the client's setting for every month. */
  fixed?: (number | null)[];
}

/**
 * Columns for the P&L report. A = actual only. P = plan only. F = actual up to `lastData`, plan after it.
 * `planFixed` is each month's SG&A from the plan (null = none planned).
 */
export function pnlColumns(mode: PnlMode, year: number, facts: DailyFact[], planRows: PlanTargetDay[], lastData: string, s: ClientSettings, planFixed: (number | null)[]): PnlColumns {
  const month = (i: number) => `${year}-${String(i + 1).padStart(2, "0")}`;
  const inMonth = <T extends { date: string }>(rows: T[], i: number) => rows.filter((r) => r.date.startsWith(month(i)));
  const actualOf = (rows: DailyFact[]) => rows.filter((f) => f.date <= lastData);
  const planAfter = (rows: PlanTargetDay[]) => (mode === "F" ? rows.filter((r) => r.date > lastData) : rows);

  const pick = (fs: DailyFact[], ps: PlanTargetDay[]): PnlTotals | null => {
    if (mode === "A") return fs.length ? aggregate(fs) : null;
    if (mode === "P") return blendColumn([], ps, s);
    return blendColumn(actualOf(fs), planAfter(ps), s);
  };
  const columns: (Totals | null)[] = [];
  const status: string[] = [];
  const fixed: (number | null)[] = [];
  for (let i = 0; i < 12; i++) {
    const fs = inMonth(facts, i);
    const ps = inMonth(planRows, i);
    columns.push(pick(fs, ps));
    const first = `${month(i)}-01`;
    const elapsed = lastData >= endOfMonth(first);
    const started = lastData >= first;
    if (mode === "A") status.push(!fs.length ? "" : elapsed ? "Actual" : "Partial");
    else if (mode === "P") status.push(ps.length ? "Plan" : "");
    else status.push(elapsed ? (fs.length ? "Actual" : "") : started ? "Actual + plan" : ps.length ? "Forecast" : "");
    fixed.push(mode === "P" ? planFixed[i] : elapsed ? s.monthlyFixedCosts : (planFixed[i] ?? s.monthlyFixedCosts));
  }
  columns.push(pick(facts, planRows));
  return { columns, status, fixed: mode === "A" ? undefined : fixed };
}

