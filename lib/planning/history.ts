import { addDays, addYears, dayOfWeek, endOfMonth, startOfMonth } from "../dates";
import { aggregate, amerSpend, cmParts, div } from "../metrics";
import type { ClientSettings, DailyFact, PlanSeasonality } from "../types";
import { PLAN_PLATFORMS, type PlanMonthInputs } from "./types";

const round2 = (v: number) => Math.round(v * 100) / 100;

/** Thanksgiving (4th Thursday of November) of a year. */
function thanksgiving(year: number): string {
  const first = new Date(Date.UTC(year, 10, 1)).getUTCDay();
  const day = 1 + ((4 - first + 7) % 7) + 21;
  return `${year}-11-${String(day).padStart(2, "0")}`;
}

/** Black Friday to Cyber Monday week (a day before Thanksgiving to the Tuesday after Cyber Monday). */
export function isBfcm(date: string): boolean {
  const tg = thanksgiving(Number(date.slice(0, 4)));
  return date >= addDays(tg, -1) && date <= addDays(tg, 5);
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const sd = (xs: number[]) => {
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
};

/**
 * Day-of-week pattern from the client's own Shopify order revenue over the 12 months up to `asOf`.
 * Per weekday: drop BFCM days and days more than 2 standard deviations from that weekday's average, then average.
 * Offset = weekday average / average of the 7 weekday averages - 1, in % (index 0 = Sunday).
 * Returns null when there are fewer than 8 weeks of data.
 */
export function dowFromHistory(facts: DailyFact[], asOf: string): PlanSeasonality | null {
  const from = addDays(addYears(asOf, -1), 1);
  const rows = facts.filter((f) => f.date >= from && f.date <= asOf && f.newOrderRevenue + f.returningOrderRevenue > 0);
  if (rows.length < 56) return null;
  const avgs: number[] = [];
  for (let d = 0; d < 7; d++) {
    let vals = rows.filter((f) => dayOfWeek(f.date) === d && !isBfcm(f.date)).map((f) => f.newOrderRevenue + f.returningOrderRevenue);
    if (vals.length < 4) return null;
    const m = mean(vals);
    const s = sd(vals);
    const kept = vals.filter((v) => Math.abs(v - m) <= 2 * s);
    if (kept.length >= 4) vals = kept;
    avgs.push(mean(vals));
  }
  const overall = mean(avgs);
  if (overall <= 0) return null;
  return { dow: avgs.map((a) => round2((a / overall - 1) * 100)), effectPct: 100 };
}

export type FillSource = "last_year" | "recent" | "actuals";

/**
 * Month inputs taken from actual data. `monthsCount` is how many months `facts` cover (the sum is divided by it).
 * `growthPct` raises spend and returning revenue (aMER and rates stay as they were).
 * Returns null when there is nothing to base it on.
 */
export function inputsFromFacts(facts: DailyFact[], monthsCount: number, settings: ClientSettings, source: FillSource, growthPct = 0): PlanMonthInputs | null {
  const t = aggregate(facts);
  if (t.days === 0) return null;
  const g = 1 + growthPct / 100;
  const platformSpend = PLAN_PLATFORMS.map((p) => ({ p, main: t.channels[p.main].spend, alt: t.channels[p.alt].spend }));
  const total = platformSpend.reduce((a, x) => a + x.main + x.alt, 0);
  const platformPct: Record<string, number> = {};
  const altPct: Record<string, number> = {};
  for (const x of platformSpend) {
    const sum = x.main + x.alt;
    if (total > 0 && sum > 0) {
      platformPct[x.p.key] = round2((sum / total) * 100);
      altPct[x.p.key] = round2((x.alt / sum) * 100);
    }
  }
  const base = t.grossSales - t.discounts;
  const cm = cmParts(t, settings);
  return {
    spend: Math.round((total / monthsCount) * g),
    amer: round2(div(t.newOrderRevenue, amerSpend(t, settings)) ?? 0),
    returningRevenue: Math.round((t.returningOrderRevenue / monthsCount) * g),
    platformPct,
    altPct,
    rates: {
      discountPct: round2((div(t.discounts, t.grossSales) ?? 0) * 100),
      shippingPct: round2((div(t.shippingCollected, base) ?? 0) * 100),
      taxPct: round2((div(t.tax, base) ?? 0) * 100),
      refundPct: round2((div(t.refunds, base) ?? 0) * 100),
      cogsPct: round2((div(cm.cogs, t.netSales) ?? 0) * 100),
      otherVarPct: settings.otherVariablePct,
      newAov: round2(div(t.newOrderRevenue, t.newOrders) ?? 0),
      returningAov: round2(div(t.returningOrderRevenue, t.returningOrders) ?? 0),
    },
    fixedCosts: settings.monthlyFixedCosts,
    source,
  };
}

/** Date range of a source for a plan month: same month last year, the 3 complete months before today, or the month itself. */
export function sourceRange(source: FillSource, month: string, today: string): { from: string; to: string; months: number } {
  const first = startOfMonth(month);
  if (source === "last_year") {
    const from = addYears(first, -1);
    return { from, to: endOfMonth(from), months: 1 };
  }
  if (source === "actuals") return { from: first, to: endOfMonth(first), months: 1 };
  const end = addDays(startOfMonth(today), -1);
  return { from: startOfMonth(addDays(startOfMonth(end), -62)), to: end, months: 3 };
}
