import { RETENTION_CHANNELS } from "../channels";
import { aggregate, cmParts, METRICS, type Totals } from "../metrics";
import { endOfMonth } from "../dates";
import type { MixOf } from "../planning/mix";
import type { RoasOf } from "../planning/roas";
import { CHANNEL_KEYS, type ClientSettings, type DailyFact, type PlanTargetDay } from "../types";
import type { PnlTotals } from "./pnl";

export type PnlMode = "A" | "P" | "F";

/** What the plan says about the channels beyond spend: the platform ROAS target per month and the email / SMS / organic shares of order revenue. */
export interface PlanSources {
  roasOf?: RoasOf;
  mixOf?: MixOf;
}

/**
 * A plan day shaped like an actual day, so the P&L builder can treat both the same way. With the plan's sources, a channel that has a ROAS target
 * expects spend x target in platform revenue (conversions at the day's new AOV, or returning AOV for the returning audiences), and email and SMS
 * revenue are their planned shares of the day's order revenue.
 */
export function planDayToFact(r: PlanTargetDay, src: PlanSources = {}): DailyFact {
  const refunds = r.refunds ?? 0;
  const gross = r.grossSales ?? r.orderRevenue;
  const discounts = r.discounts ?? 0;
  const returningOrders = Math.max(0, r.orders - r.newOrders);
  const totalAov = r.orders > 0 ? r.orderRevenue / r.orders : 0;
  const newAov = r.newOrders > 0 ? r.newRevenue / r.newOrders : totalAov;
  const returningAov = returningOrders > 0 ? r.returningRevenue / returningOrders : totalAov;
  const channels = Object.fromEntries(
    CHANNEL_KEYS.map((k) => {
      const spend = r.spendByChannel[k] ?? 0;
      const roas = spend > 0 ? src.roasOf?.(r.date, k) ?? null : null;
      const platformRevenue = roas === null ? 0 : spend * roas;
      const aov = RETENTION_CHANNELS.includes(k) ? returningAov : newAov;
      return [k, { spend, platformRevenue, platformPurchases: aov > 0 ? platformRevenue / aov : 0 }];
    }),
  ) as DailyFact["channels"];
  const share = (key: "email" | "sms") => r.orderRevenue * (src.mixOf?.(r.date, key) ?? 0);
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
    returningOrders,
    refunds,
    cogs: r.cogs ?? 0,
    cogsUnmappedSales: 0,
    emailRevenue: share("email"),
    emailCampaignRevenue: 0,
    emailFlowRevenue: 0,
    emailOrders: 0,
    emailSent: 0,
    smsRevenue: share("sms"),
    channels,
    // A month planned with spend but no platform split: keep the rest so the P&L's ad spend and CM match the plan.
    unassignedSpend: Math.max(0, r.spend - Object.values(r.spendByChannel).reduce<number>((a, v) => a + (v ?? 0), 0)),
  };
}

/**
 * One P&L column from actual days plus plan days (either may be empty).
 * Costs are fixed explicitly so CM follows the same formula as the dashboard: actual days use the client's settings,
 * plan days use the plan's own COGS and cost of delivery.
 */
export function blendColumn(actual: DailyFact[], plan: PlanTargetDay[], s: ClientSettings, src: PlanSources = {}): PnlTotals | null {
  if (!actual.length && !plan.length) return null;
  const tA = aggregate(actual);
  const costsA = actual.length ? cmParts(tA, s) : { cogs: 0, costOfDelivery: 0 };
  const planFacts = plan.map((r) => planDayToFact(r, src));
  const t: PnlTotals = aggregate([...actual, ...planFacts]);
  // Planned spend with no ROAS target (it brings no planned revenue), so the P&L's planned ROAS and CPA do not count it.
  const untargeted: Partial<Record<(typeof CHANNEL_KEYS)[number], number>> = {};
  for (const f of planFacts) for (const k of CHANNEL_KEYS) if (f.channels[k].spend > 0 && f.channels[k].platformRevenue === 0) untargeted[k] = (untargeted[k] ?? 0) + f.channels[k].spend;
  t.untargetedSpend = untargeted;
  // Organic: the planned share of order revenue on the days that plan one, the dashboard's definition (what is left) on the other plan days.
  if (src.mixOf && plan.some((r) => src.mixOf!(r.date, "organic") !== null)) {
    t.organicRevenue =
      (actual.length ? METRICS.organicRevenue.value(tA, s) ?? 0 : 0) +
      plan.reduce((a, r, i) => {
        const share = src.mixOf!(r.date, "organic");
        return a + (share !== null ? r.orderRevenue * share : METRICS.organicRevenue.value(aggregate([planFacts[i]]), s) ?? 0);
      }, 0);
  }
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
export function pnlColumns(mode: PnlMode, year: number, facts: DailyFact[], planRows: PlanTargetDay[], lastData: string, s: ClientSettings, planFixed: (number | null)[], src: PlanSources = {}): PnlColumns {
  const month = (i: number) => `${year}-${String(i + 1).padStart(2, "0")}`;
  const inMonth = <T extends { date: string }>(rows: T[], i: number) => rows.filter((r) => r.date.startsWith(month(i)));
  const actualOf = (rows: DailyFact[]) => rows.filter((f) => f.date <= lastData);
  const planAfter = (rows: PlanTargetDay[]) => (mode === "F" ? rows.filter((r) => r.date > lastData) : rows);

  const pick = (fs: DailyFact[], ps: PlanTargetDay[]): PnlTotals | null => {
    if (mode === "A") return fs.length ? aggregate(fs) : null;
    if (mode === "P") return blendColumn([], ps, s, src);
    return blendColumn(actualOf(fs), planAfter(ps), s, src);
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

