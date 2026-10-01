import { dayOfWeek, eachDay, endOfMonth } from "../dates";
import type { ChannelKey, PlanSeasonality, PlanTargetDay } from "../types";
import { PLAN_PLATFORMS, type PlanMonthInputs, type PlanRates } from "./types";

export const FLAT_SEASONALITY: PlanSeasonality = { dow: [0, 0, 0, 0, 0, 0, 0], effectPct: 100 };

/** Relative weight of each date: 1 + that weekday's offset x the effect strength. Never below 5%. */
export function dayWeights(dates: string[], s: PlanSeasonality): number[] {
  return dates.map((d) => Math.max(0.05, 1 + ((s.dow[dayOfWeek(d)] ?? 0) / 100) * (s.effectPct / 100)));
}

/** Shares `total` over the weights (an empty weight list gives an empty result). */
function spread(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  return weights.map((w) => (sum > 0 ? (total * w) / sum : 0));
}

export interface PlOfDay {
  gross: number;
  discounts: number;
  shipping: number;
  tax: number;
  refunds: number;
  netSales: number;
  cogs: number;
  costOfDelivery: number;
}

/**
 * Turns one day's order revenue into the P&L lines.
 * Order revenue = gross - discounts + shipping + tax (returns not deducted). With b = gross - discounts:
 * shipping = s*b, tax = t*b, refunds = r*b, so b = revenue / (1 + s + t). Net sales = b - refunds.
 */
export function plOfRevenue(orderRevenue: number, rates: PlanRates, orders: number, deliveryCostPerOrder: number): PlOfDay {
  const b = orderRevenue / (1 + (rates.shippingPct + rates.taxPct) / 100);
  const gross = rates.discountPct >= 100 ? b : b / (1 - rates.discountPct / 100);
  const shipping = (b * rates.shippingPct) / 100;
  const tax = (b * rates.taxPct) / 100;
  const refunds = (b * rates.refundPct) / 100;
  const netSales = b - refunds;
  const cogs = (netSales * rates.cogsPct) / 100;
  const costOfDelivery = ((netSales + shipping) * rates.otherVarPct) / 100 + deliveryCostPerOrder * orders;
  return { gross, discounts: gross - b, shipping, tax, refunds, netSales, cogs, costOfDelivery };
}

export interface GenerateOptions {
  planId: string;
  clientId: string;
  /** Any date in the month (or the first day). */
  month: string;
  inputs: PlanMonthInputs;
  seasonality: PlanSeasonality;
  deliveryCostPerOrder: number;
  excludeBrandFromAmer: boolean;
  excludeMetaReturningFromAmer: boolean;
}

/**
 * Deterministic daily rows for one month (no statistics):
 * spend and returning revenue follow the weekday weights; new revenue = acquisition spend x aMER;
 * the platform split is fixed for the month; days with a fixed (override) value keep it and the other days absorb the rest.
 */
export function generateMonth(o: GenerateOptions): PlanTargetDay[] {
  const first = o.month.slice(0, 8) + "01";
  const dates = eachDay(first, endOfMonth(first));
  const w = dayWeights(dates, o.seasonality);
  const ov = o.inputs.overrides ?? {};

  const distribute = (total: number, pick: (d: string) => number | undefined): number[] => {
    const fixed = dates.map((d) => pick(d));
    const fixedSum = fixed.reduce<number>((a, v) => a + (v ?? 0), 0);
    const free = spread(
      Math.max(0, total - fixedSum),
      w.map((x, i) => (fixed[i] === undefined ? x : 0)),
    );
    return dates.map((_, i) => fixed[i] ?? free[i]);
  };
  const spend = distribute(o.inputs.spend, (d) => ov[d]?.spend);
  const returning = distribute(o.inputs.returningRevenue, (d) => ov[d]?.returningRevenue);

  const pctSum = PLAN_PLATFORMS.reduce((a, p) => a + (o.inputs.platformPct[p.key] ?? 0), 0);
  return dates.map((date, i) => {
    const spendByChannel: Partial<Record<ChannelKey, number>> = {};
    if (pctSum > 0) {
      for (const p of PLAN_PLATFORMS) {
        const amt = (spend[i] * (o.inputs.platformPct[p.key] ?? 0)) / pctSum;
        if (amt === 0) continue;
        const alt = (amt * (o.inputs.altPct[p.key] ?? 0)) / 100;
        spendByChannel[p.main] = amt - alt;
        if (alt > 0) spendByChannel[p.alt] = alt;
      }
    }
    let acqSpend = spend[i];
    if (o.excludeBrandFromAmer) acqSpend -= spendByChannel.google_brand ?? 0;
    if (o.excludeMetaReturningFromAmer) acqSpend -= spendByChannel.meta_returning ?? 0;
    const newRevenue = ov[date]?.newRevenue ?? acqSpend * o.inputs.amer;
    const r = o.inputs.rates;
    const newOrders = r.newAov > 0 ? newRevenue / r.newAov : 0;
    const orders = newOrders + (r.returningAov > 0 ? returning[i] / r.returningAov : 0);
    const orderRevenue = newRevenue + returning[i];
    const pl = plOfRevenue(orderRevenue, r, orders, o.deliveryCostPerOrder);
    const cm = pl.netSales + pl.shipping - pl.cogs - spend[i] - pl.costOfDelivery;
    return {
      planId: o.planId,
      clientId: o.clientId,
      date,
      orderRevenue,
      newRevenue,
      returningRevenue: returning[i],
      orders,
      newOrders,
      spend: spend[i],
      cm,
      spendByChannel,
      grossSales: pl.gross,
      discounts: pl.discounts,
      shipping: pl.shipping,
      refunds: pl.refunds,
      tax: pl.tax,
      cogs: pl.cogs,
      costOfDelivery: pl.costOfDelivery,
    };
  });
}
