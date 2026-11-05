import { describe, expect, it } from "vitest";
import { defaultSettings } from "../defaults";
import { emptyTotals } from "../metrics";
import type { DailyFact, PlanTargetDay } from "../types";
import { buildCalendarRows } from "./calendar";
import type { MarketingAction } from "./calendar-actions";
import { CALENDAR_SPECS } from "./calendar-specs";

const settings = defaultSettings("c1");

const fact = (date: string, newRev: number, retRev: number, metaSpend: number): DailyFact => {
  const channels = emptyTotals().channels;
  channels.meta_acquisition = { spend: metaSpend, platformRevenue: 0, platformPurchases: 0 };
  return { clientId: "c1", date, grossSales: 0, discounts: 0, netSales: 0, shippingCollected: 0, tax: 0, newOrderRevenue: newRev, returningOrderRevenue: retRev, newOrders: 1, returningOrders: 1, refunds: 0, cogs: 0, cogsUnmappedSales: 0, emailRevenue: 0, emailCampaignRevenue: 0, emailFlowRevenue: 0, emailOrders: 0, emailSent: 0, channels };
};
const planDay = (date: string): PlanTargetDay => ({ planId: "p", clientId: "c1", date, orderRevenue: 1000, newRevenue: 500, returningRevenue: 500, orders: 10, newOrders: 5, spend: 250, cm: 400, spendByChannel: { meta_acquisition: 250 } });

const DATES = ["2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04"];
/** Data on Jan 1 and Jan 3 (Jan 2 has none), the range runs to Jan 4, data ends Jan 3. */
const base = (over: Partial<Parameters<typeof buildCalendarRows>[0]["data"]> = {}) => ({
  facts: new Map([fact("2026-01-01", 700, 500, 300), fact("2026-01-03", 400, 200, 100)].map((f) => [f.date, f])),
  plan: new Map(DATES.map((d) => [d, planDay(d)])),
  dates: DATES,
  effTo: "2026-01-03",
  settings,
  hasPlan: true,
  roasOf: null,
  mixOf: null,
  ...over,
});
const specs = CALENDAR_SPECS.filter((s) => ["rev", "spend", "mer"].includes(s.key));
const run = (data = base(), actions: MarketingAction[] = [], showProjection = true) => buildCalendarRows({ data, specs, actions, showProjection });

describe("buildCalendarRows", () => {
  it("elapsed days use the spec value, the plan day's goal, and the Home tone rule", () => {
    const { rows } = run();
    const d1 = rows[0];
    expect(d1.label).toBe("Thu, Jan 1");
    expect(d1.projected).toBe(false);
    expect(d1.cells.rev).toMatchObject({ actual: 1200, goal: 1000, tone: "good" });
    expect(d1.cells.rev.diff).toBeCloseTo(0.2, 10);
    expect(d1.cells.spend).toMatchObject({ actual: 300, goal: 250, tone: "good" });
  });

  it("days after the last data day are projected: they show the goal, in neutral tone, with no diff", () => {
    const d4 = run().rows[3];
    expect(d4.projected).toBe(true);
    expect(d4.cells.rev).toEqual({ actual: 1000, goal: 1000, tone: "neutral", diff: null });
  });

  it("an elapsed day with no data has a null actual and does not count in the total", () => {
    const { rows, total } = run();
    expect(rows[1].projected).toBe(false);
    expect(rows[1].cells.rev.actual).toBeNull();
    expect(total.cells.rev.actual).toBe(1800);
    expect(total.cells.rev.goal).toBe(2000);
  });

  it("total MER is total revenue over total spend, not the mean of the daily MERs", () => {
    const { rows, total } = run();
    expect(rows[0].cells.mer.actual).toBeCloseTo(4, 10);
    expect(rows[2].cells.mer.actual).toBeCloseTo(6, 10);
    expect(total.cells.mer.actual).toBeCloseTo(1800 / 400, 10);
    expect(total.label).toBe("TOTAL");
  });

  it("with no plan the goals are null and the tones neutral", () => {
    const { rows, total } = run(base({ hasPlan: false, plan: new Map() }));
    expect(rows[0].cells.rev).toEqual({ actual: 1200, goal: null, tone: "neutral", diff: null });
    expect(rows[3].cells.rev.actual).toBeNull();
    expect(total.cells.rev.goal).toBeNull();
  });

  it("dropping projection removes the future days", () => {
    expect(run(base(), [], false).rows.map((r) => r.date)).toEqual(["2026-01-01", "2026-01-02", "2026-01-03"]);
  });

  it("attaches each day's actions, collapsed and ordered", () => {
    const actions: MarketingAction[] = [
      { date: "2026-01-03", type: "meta", name: "UK12" },
      { date: "2026-01-03", type: "event", name: "Sale" },
      { date: "2026-01-03", type: "event", name: "Sale" },
    ];
    const { rows } = run(base(), actions);
    expect(rows[2].actions.map((a) => a.type)).toEqual(["event", "meta"]);
    expect(rows[0].actions).toEqual([]);
  });
});
