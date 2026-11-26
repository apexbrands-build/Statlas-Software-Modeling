/** A store's orders by hour of its own clock (database function `orders_by_hour`, migration 0023), and the demo data's version of them. */
import { addDays, bfcmRange } from "../dates";
import type { DailyFact } from "../types";

/** One hour of one day. Hours with no order have no row. The same orders as the daily numbers: DTC, order revenue above zero. */
export interface OrderHour {
  date: string;
  /** 0 to 23, the store's clock. */
  hour: number;
  orderRevenue: number;
  newRevenue: number;
  returningRevenue: number;
  orders: number;
  newOrders: number;
  returningOrders: number;
  grossSales: number;
  discounts: number;
  shipping: number;
  tax: number;
  /** When the latest order of the hour was placed (ISO time); null when unknown. */
  lastOrderAt: string | null;
}

type Row = Record<string, unknown>;
const n = (v: unknown) => {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
};

export function mapOrderHours(rows: Row[]): OrderHour[] {
  const out: OrderHour[] = [];
  for (const r of rows) {
    const date = typeof r.order_date === "string" ? r.order_date.slice(0, 10) : "";
    const hour = Number(r.hour);
    if (!date || !Number.isInteger(hour) || hour < 0 || hour > 23) continue;
    out.push({
      date,
      hour,
      orderRevenue: n(r.order_revenue),
      newRevenue: n(r.new_revenue),
      returningRevenue: n(r.returning_revenue),
      orders: n(r.orders),
      newOrders: n(r.new_orders),
      returningOrders: n(r.returning_orders),
      grossSales: n(r.gross_sales),
      discounts: n(r.discounts),
      shipping: n(r.shipping_collected),
      tax: n(r.tax),
      lastOrderAt: typeof r.last_order_at === "string" && r.last_order_at ? r.last_order_at : null,
    });
  }
  return out.sort((a, b) => (a.date === b.date ? a.hour - b.hour : a.date < b.date ? -1 : 1));
}

/** The instant at which a time zone's clock shows `date` `hour`:`minute`. An unknown zone is read as UTC. */
export function zonedInstant(date: string, hour: number, minute: number, timeZone: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const wall = Date.UTC(y, m - 1, d, hour, minute);
  try {
    const p = Object.fromEntries(
      new Intl.DateTimeFormat("en-CA", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
        .formatToParts(new Date(wall))
        .map((x) => [x.type, x.value]),
    );
    const shown = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
    return new Date(wall - (shown - wall));
  } catch {
    return new Date(wall);
  }
}

/* ---------- demo data ---------- */

/** Share of a day's orders by hour: quiet at night, a midday plateau, an evening peak. */
const ORDINARY = [1.2, 0.7, 0.4, 0.3, 0.3, 0.5, 1.0, 1.8, 2.8, 3.6, 4.2, 4.6, 4.9, 4.8, 4.6, 4.5, 4.6, 5.0, 5.6, 6.2, 6.4, 5.6, 4.0, 2.4];
/** Thanksgiving to Cyber Monday: the sale opens at midnight, so the first hours run hot. */
const BFCM = [6.5, 3.0, 1.4, 0.8, 0.6, 0.9, 1.8, 3.0, 4.2, 5.0, 5.2, 5.0, 4.8, 4.5, 4.3, 4.2, 4.4, 4.8, 5.4, 6.0, 6.2, 5.6, 4.4, 3.2];

function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
/** Uniform [0,1) from a key: the same key always gives the same number. */
const rnd = (key: string) => (hash(key) % 100_000) / 100_000;

function isBfcmDay(date: string): boolean {
  const r = bfcmRange(Number(date.slice(0, 4)));
  return date >= addDays(r.from, -1) && date <= r.to;
}

/** Splits a whole number over weights so the parts are whole and add up to it (largest remainders first, earlier hour on a tie). */
function splitWhole(total: number, weights: number[]): number[] {
  const all = weights.reduce((a, b) => a + b, 0);
  if (total <= 0 || all <= 0) return weights.map(() => 0);
  const exact = weights.map((w) => (total * w) / all);
  const parts = exact.map(Math.floor);
  let left = total - parts.reduce((a, b) => a + b, 0);
  const order = exact.map((x, i) => ({ i, frac: x - Math.floor(x) })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; left > 0 && k < order.length; k++, left--) parts[order[k].i] += 1;
  return parts;
}

/** Splits an amount over weights; the last weighted part takes what is left, so the parts add up to the amount. */
function splitAmount(total: number, weights: number[]): number[] {
  const all = weights.reduce((a, b) => a + b, 0);
  if (all <= 0) return weights.map(() => 0);
  let last = -1;
  weights.forEach((w, i) => {
    if (w > 0) last = i;
  });
  let given = 0;
  return weights.map((w, i) => {
    if (i === last) return total - given;
    const part = (total * w) / all;
    given += part;
    return part;
  });
}

/**
 * The hours of a demo day, made from the day's own fact so they add up to it: orders are split over a fixed daily curve (with a little
 * noise that depends only on the client, the day and the hour), revenue follows the orders. `upTo` is the store's clock on a day in
 * progress: later hours are left out and the hour in progress holds the part of its orders placed so far.
 */
export function demoOrderHours(fact: DailyFact, timeZone: string, upTo?: { hour: number; minute: number }): OrderHour[] {
  const key = (h: number, s: string) => `${fact.clientId}|${fact.date}|${h}|${s}`;
  const curve = (isBfcmDay(fact.date) ? BFCM : ORDINARY).map((w, h) => w * (0.85 + 0.3 * rnd(key(h, "w"))));
  const newOrders = splitWhole(Math.round(fact.newOrders), curve);
  const retOrders = splitWhole(Math.round(fact.returningOrders), curve.map((w, h) => w * (0.8 + 0.4 * rnd(key(h, "r")))));
  const newRev = splitAmount(fact.newOrderRevenue, newOrders.map((o, h) => o * (0.92 + 0.16 * rnd(key(h, "na")))));
  const retRev = splitAmount(fact.returningOrderRevenue, retOrders.map((o, h) => o * (0.92 + 0.16 * rnd(key(h, "ra")))));
  const revenue = newRev.map((v, h) => v + retRev[h]);
  const gross = splitAmount(fact.grossSales, revenue);
  const discounts = splitAmount(fact.discounts, revenue);
  const shipping = splitAmount(fact.shippingCollected, revenue);
  const tax = splitAmount(fact.tax, revenue);

  const out: OrderHour[] = [];
  for (let h = 0; h < 24; h++) {
    if (upTo && h > upTo.hour) break;
    const orders = newOrders[h] + retOrders[h];
    if (orders <= 0) continue;
    let minute = 40 + Math.floor(rnd(key(h, "m")) * 20);
    let row: OrderHour = { date: fact.date, hour: h, orderRevenue: revenue[h], newRevenue: newRev[h], returningRevenue: retRev[h], orders, newOrders: newOrders[h], returningOrders: retOrders[h], grossSales: gross[h], discounts: discounts[h], shipping: shipping[h], tax: tax[h], lastOrderAt: null };
    if (upTo && h === upTo.hour) {
      const part = Math.max(0, Math.min(1, upTo.minute / 60));
      const no = Math.floor(newOrders[h] * part);
      const ro = Math.floor(retOrders[h] * part);
      if (no + ro <= 0) continue;
      const nk = newOrders[h] > 0 ? no / newOrders[h] : 0;
      const rk = retOrders[h] > 0 ? ro / retOrders[h] : 0;
      const rev = newRev[h] * nk + retRev[h] * rk;
      const k = revenue[h] > 0 ? rev / revenue[h] : 0;
      row = { ...row, orderRevenue: rev, newRevenue: newRev[h] * nk, returningRevenue: retRev[h] * rk, orders: no + ro, newOrders: no, returningOrders: ro, grossSales: gross[h] * k, discounts: discounts[h] * k, shipping: shipping[h] * k, tax: tax[h] * k };
      minute = Math.max(0, upTo.minute - 2);
    }
    row.lastOrderAt = zonedInstant(fact.date, h, minute, timeZone).toISOString();
    out.push(row);
  }
  return out;
}
