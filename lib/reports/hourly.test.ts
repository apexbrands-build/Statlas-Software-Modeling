import { describe, expect, it } from "vitest";
import { defaultSettings } from "../defaults";
import type { MarketingEvent } from "../planning/events";
import type { OrderHour } from "../repository/order-hours";
import type { PlanTargetDay } from "../types";
import { EVEN_SHARES } from "./hourly-shape";
import { HOURLY_SPECS } from "./hourly-specs";
import { buildHourly, compareDates, compareLabel, dayListing, daysToLoad, eventMarkers, hourFact, hourlyCsv, lastOrderClock, launchMarkers, planBSignal, sendReadings, sendsOn, storeClock, summarise, toChartRows, type HourlyInput } from "./hourly";

const settings = defaultSettings("c1");
const DAY = "2026-11-18"; // a Wednesday
const oh = (hour: number, newRev: number, retRev: number, newOrders = 1, retOrders = 1, date = DAY): OrderHour => ({ date, hour, orderRevenue: newRev + retRev, newRevenue: newRev, returningRevenue: retRev, orders: newOrders + retOrders, newOrders, returningOrders: retOrders, grossSales: newRev + retRev, discounts: 0, shipping: 0, tax: 0, lastOrderAt: null });
const everyHour = (to: number, newRev: number, retRev: number, date = DAY) => Array.from({ length: to }, (_, h) => oh(h, newRev, retRev, 1, 1, date));
/** 2,400 a day, half new and half returning, 24 orders: 100 an hour on an even shape, AOV 100. */
const plan: PlanTargetDay = { planId: "p", clientId: "c1", date: DAY, orderRevenue: 2400, newRevenue: 1200, returningRevenue: 1200, orders: 24, newOrders: 12, spend: 600, cm: 500, spendByChannel: { meta_acquisition: 600 } };
const PAST = { date: "2026-11-20", hour: 9, minute: 0 };
const input = (over: Partial<HourlyInput> = {}): HourlyInput => ({ clientId: "c1", day: DAY, clock: PAST, asOf: null, hours: [], specs: HOURLY_SPECS, settings, compare: "plan", plan, roasOf: null, mixOf: null, shares: EVEN_SHARES, reference: [], cumulative: false, markers: [], ...over });

describe("storeClock", () => {
  it("reads the store's own date and time, whatever the viewer's zone", () => {
    expect(storeClock(new Date("2026-11-27T07:30:00Z"), "America/Los_Angeles")).toEqual({ date: "2026-11-26", hour: 23, minute: 30 });
    expect(storeClock(new Date("2026-11-27T07:30:00Z"), "Europe/Paris")).toEqual({ date: "2026-11-27", hour: 8, minute: 30 });
    expect(storeClock(new Date("2026-11-27T07:30:00Z"), "not/a-zone")).toEqual({ date: "2026-11-27", hour: 7, minute: 30 });
  });
});

describe("lastOrderClock", () => {
  it("is the store-clock time of the latest order loaded for the day", () => {
    const hours = [{ ...oh(9, 10, 10), lastOrderAt: "2026-11-18T17:20:00+00:00" }, { ...oh(12, 10, 10), lastOrderAt: "2026-11-18T20:40:30+00:00" }];
    expect(lastOrderClock(hours, DAY, "America/Los_Angeles")).toEqual({ hour: 12, minute: 40, at: "2026-11-18T20:40:30+00:00" });
  });

  it("falls back to the end of the last hour that has orders when the times are missing, and is null with no orders", () => {
    expect(lastOrderClock([oh(9, 10, 10), oh(12, 10, 10)], DAY, "UTC")).toEqual({ hour: 12, minute: 59, at: null });
    expect(lastOrderClock([], DAY, "UTC")).toBeNull();
  });
});

describe("hourFact", () => {
  it("is one hour in the daily shape: the order numbers filled, everything with no hourly source at zero", () => {
    const f = hourFact("c1", DAY, { ...oh(9, 60, 40, 2, 1), grossSales: 120, discounts: 30, shipping: 6, tax: 4 });
    expect(f).toMatchObject({ clientId: "c1", date: DAY, newOrderRevenue: 60, returningOrderRevenue: 40, newOrders: 2, returningOrders: 1, grossSales: 120, discounts: 30, shippingCollected: 6, tax: 4, netSales: 90, refunds: 0, cogs: 0, emailRevenue: 0 });
    expect(f.channels.meta_acquisition).toEqual({ spend: 0, platformRevenue: 0, platformPurchases: 0 });
  });
});

describe("buildHourly on a finished day against the plan", () => {
  const hours = [oh(9, 90, 60, 1, 1), oh(10, 40, 40, 1, 1), oh(20, 200, 100, 2, 1)];
  const r = buildHourly(input({ hours }));

  it("has 24 hour rows labelled by the store's clock, all done", () => {
    expect(r.rows).toHaveLength(24);
    expect(r.rows[9].label).toBe("09:00");
    expect(r.rows.every((x) => x.state === "done")).toBe(true);
    expect(r.progress.kind).toBe("past");
  });

  it("an hour's expectation is the day's target times the hour's share, with the usual tone rule", () => {
    const c = r.rows[9].cells.rev;
    expect(c.actual).toBe(150);
    expect(c.expected).toBeCloseTo(100, 9);
    expect(c.gap).toBeCloseTo(50, 9);
    expect(c.diff).toBeCloseTo(0.5, 9);
    expect(c.tone).toBe("good");
    expect(r.rows[10].cells.rev).toMatchObject({ actual: 80, tone: "bad" });
    expect(r.rows[10].cells.retRev.expected).toBeCloseTo(50, 9);
  });

  it("an hour with no orders is a real zero against its expectation", () => {
    expect(r.rows[3].cells.rev).toMatchObject({ actual: 0, tone: "bad" });
    expect(r.rows[3].cells.rev.diff).toBeCloseTo(-1, 9);
    expect(r.rows[3].cells.aov.actual).toBeNull();
  });

  it("a ratio is not spread: every hour carries the day's target", () => {
    expect(r.rows[9].cells.aov).toMatchObject({ actual: 75, expected: 100, tone: "bad" });
    expect(r.rows[3].cells.aov.expected).toBe(100);
    expect(r.rows[20].cells.newAov.expected).toBe(100);
  });

  it("columns with no hourly source show their expectation and say there is no data", () => {
    const spend = r.rows[9].cells.spend;
    expect(spend).toMatchObject({ actual: null, noData: true, tone: "neutral", diff: null });
    expect(spend.expected).toBeCloseTo(25, 9);
    expect(r.rows[9].cells.mer).toMatchObject({ actual: null, expected: 4, noData: true });
    expect(r.rows[9].cells.metaAcqSpend.expected).toBeCloseTo(25, 9);
    expect(r.day.cells.spend).toMatchObject({ actual: null, noData: true });
    expect(r.day.cells.spend.expected).toBeCloseTo(600, 9);
  });

  it("the Day row is the sum of the hours against the whole day's target", () => {
    expect(r.day.label).toBe("Day");
    expect(r.day.cells.rev).toMatchObject({ actual: 530, expected: 2400, full: 2400, tone: "bad", heading: null });
    expect(r.rows.reduce((s, x) => s + (x.cells.rev.actual ?? 0), 0)).toBe(r.day.cells.rev.actual);
    expect(r.day.cells.orders.actual).toBe(7);
    expect(r.day.cells.aov.actual).toBeCloseTo(530 / 7, 9);
    expect(r.day.cells.aov.expected).toBe(100);
  });

  it("the hours' expectations add up to the day's", () => {
    expect(r.rows.reduce((s, x) => s + (x.cells.rev.expected ?? 0), 0)).toBeCloseTo(2400, 6);
    expect(r.rows.reduce((s, x) => s + (x.cells.newOrders.expected ?? 0), 0)).toBeCloseTo(12, 6);
  });

  it("follows the shape it is given, and a ratio keeps the day's target even on an hour with no share", () => {
    const shares = Array.from({ length: 24 }, (_, h) => (h === 0 || h === 12 ? 0.5 : 0));
    const s = buildHourly(input({ hours, shares }));
    expect(s.rows[0].cells.rev.expected).toBe(1200);
    expect(s.rows[9].cells.rev.expected).toBe(0);
    expect(s.rows[9].cells.aov.expected).toBe(100);
    expect(s.rows[9].cells.rev).toMatchObject({ actual: 150, diff: null, tone: "neutral" });
  });

  it("with no plan row for the day there is nothing to expect", () => {
    const s = buildHourly(input({ hours, plan: null }));
    expect(s.hasExpectation).toBe(false);
    expect(s.rows[9].cells.rev).toMatchObject({ actual: 150, expected: null, tone: "neutral", diff: null });
    expect(s.day.cells.rev).toMatchObject({ actual: 530, expected: null, full: null });
  });

  it("a past day with no orders loaded shows no actuals instead of zeros", () => {
    const s = buildHourly(input({ hours: [] }));
    expect(s.hasOrders).toBe(false);
    expect(s.rows[9].cells.rev).toMatchObject({ actual: null, tone: "neutral" });
    expect(s.day.cells.rev.actual).toBeNull();
  });

  it("puts the markers on their hour", () => {
    const s = buildHourly(input({ hours, markers: [{ hour: 9, type: "email", name: "VIP early access" }, { hour: 9, type: "meta", name: "6 new ads in ACQ | Evergreen" }, { hour: 30, type: "event", name: "out of range" }] }));
    expect(s.rows[9].markers).toEqual([{ type: "email", name: "VIP early access" }, { type: "meta", name: "6 new ads in ACQ | Evergreen" }]);
    expect(s.rows[10].markers).toEqual([]);
  });
});

describe("buildHourly on the store's today", () => {
  // The clock says 14:10; the last order loaded was placed at 12:40.
  const clock = { date: DAY, hour: 14, minute: 10 };
  const asOf = { hour: 12, minute: 40 };
  const hours = [...everyHour(12, 60, 50), oh(12, 30, 0, 1, 0)];
  const r = buildHourly(input({ clock, asOf, hours }));

  it("hours before the last order loaded are done, from there to the clock they are partial, the rest is to come", () => {
    expect(r.progress.kind).toBe("today");
    expect(r.rows.slice(0, 12).every((x) => x.state === "done")).toBe(true);
    expect(r.rows.slice(12, 15).map((x) => x.state)).toEqual(["partial", "partial", "partial"]);
    expect(r.rows.slice(15).every((x) => x.state === "tocome")).toBe(true);
  });

  it("hours to come show the expectation only", () => {
    expect(r.rows[18].cells.rev).toMatchObject({ actual: null, tone: "neutral", diff: null, gap: null });
    expect(r.rows[18].cells.rev.expected).toBeCloseTo(100, 9);
  });

  it("a partial hour shows what is loaded and is not judged", () => {
    expect(r.rows[12].cells.rev).toMatchObject({ actual: 30, tone: "neutral", diff: null });
    expect(r.rows[12].cells.rev.expected).toBeCloseTo(100, 9);
    expect(r.rows[13].cells.rev).toMatchObject({ actual: 0, tone: "neutral" });
  });

  it("the Day row reads the day so far against the expectation up to the last order loaded", () => {
    const c = r.day.cells.rev;
    const expectedSoFar = 1200 + 100 * (41 / 60);
    expect(r.day.label).toBe("Day so far");
    expect(c.actual).toBe(1350);
    expect(c.expected).toBeCloseTo(expectedSoFar, 6);
    expect(c.full).toBeCloseTo(2400, 6);
    expect(c.diff).toBeCloseTo((1350 - expectedSoFar) / expectedSoFar, 9);
    expect(c.tone).toBe("neutral");
  });

  it("where the day is heading is so far divided by the share of the day elapsed", () => {
    const elapsed = (1200 + 100 * (41 / 60)) / 2400;
    expect(r.progress.elapsedShare).toBeCloseTo(elapsed, 9);
    expect(r.day.cells.rev.heading).toBeCloseTo(1350 / elapsed, 6);
    expect(r.day.cells.aov.heading).toBeNull();
    expect(r.day.cells.spend.heading).toBeNull();
  });

  it("gives no heading in the first minutes of a day, when almost nothing has elapsed", () => {
    const early = buildHourly(input({ clock: { date: DAY, hour: 0, minute: 30 }, asOf: { hour: 0, minute: 20 }, hours: [oh(0, 300, 0, 1, 0)] }));
    expect(early.day.cells.rev.actual).toBe(300);
    expect(early.day.cells.rev.heading).toBeNull();
  });

  it("with nothing loaded yet the open hours are partial and the Day row has no actual", () => {
    const s = buildHourly(input({ clock, asOf: null, hours: [] }));
    expect(s.rows.slice(0, 15).every((x) => x.state === "partial")).toBe(true);
    expect(s.rows[15].state).toBe("tocome");
    expect(s.day.cells.rev).toMatchObject({ actual: null, expected: null, tone: "neutral" });
    expect(s.day.cells.rev.full).toBeCloseTo(2400, 6);
    expect(s.hasOrders).toBe(false);
  });

  it("a day that has not started is all to come and the Day row holds the day's expectation", () => {
    const s = buildHourly(input({ clock: { date: "2026-11-17", hour: 22, minute: 0 } }));
    expect(s.progress.kind).toBe("future");
    expect(s.rows.every((x) => x.state === "tocome")).toBe(true);
    expect(s.day.label).toBe("Day (expected)");
    expect(s.day.cells.rev.actual).toBeNull();
    expect(s.day.cells.rev.expected).toBeCloseTo(2400, 6);
  });
});

describe("buildHourly in cumulative mode", () => {
  const clock = { date: DAY, hour: 14, minute: 10 };
  const hours = [oh(0, 100, 0, 1, 0), oh(1, 100, 100, 1, 1), oh(2, 0, 200, 0, 4), oh(13, 50, 0, 1, 0)];
  const r = buildHourly(input({ clock, asOf: { hour: 13, minute: 5 }, hours, cumulative: true }));

  it("turns every column into a running total", () => {
    expect(r.rows[0].cells.rev.actual).toBe(100);
    expect(r.rows[1].cells.rev.actual).toBe(300);
    expect(r.rows[2].cells.rev.actual).toBe(500);
    expect(r.rows[5].cells.rev.actual).toBe(500);
    expect(r.rows[2].cells.rev.expected).toBeCloseTo(300, 6);
    expect(r.rows[2].cells.rev.tone).toBe("good");
    expect(r.rows[23].cells.rev.expected).toBeCloseTo(2400, 6);
  });

  it("recomputes ratios from the running sums", () => {
    expect(r.rows[1].cells.aov.actual).toBeCloseTo(300 / 3, 9);
    expect(r.rows[2].cells.aov.actual).toBeCloseTo(500 / 7, 9);
    expect(r.rows[2].cells.aov.expected).toBe(100);
  });

  it("keeps partial hours unjudged and hours to come as the expected running total only", () => {
    expect(r.rows[13].cells.rev).toMatchObject({ actual: 550, tone: "neutral", diff: null });
    expect(r.rows[20].cells.rev.actual).toBeNull();
    expect(r.rows[20].cells.rev.expected).toBeCloseTo(2100, 6);
  });

  it("leaves the per-hour rows available for the readings", () => {
    expect(r.hourRows[1].cells.rev.actual).toBe(200);
    expect(r.hourRows[2].cells.rev.expected).toBeCloseTo(100, 9);
  });
});

describe("comparison modes", () => {
  it("lists the reference days of each mode", () => {
    expect(compareDates("plan", DAY)).toEqual([]);
    expect(compareDates("lastWeek", DAY)).toEqual(["2026-11-11"]);
    expect(compareDates("fourWeeks", DAY)).toEqual(["2026-11-11", "2026-11-04", "2026-10-28", "2026-10-21"]);
    expect(compareDates("lastYear", DAY)).toEqual(["2025-11-18"]);
    expect(compareDates("lastYear", "2026-11-27")).toEqual(["2025-11-28"]);
  });

  it("names the reference in plain words", () => {
    expect(compareLabel("plan", DAY, [])).toBe("the plan");
    expect(compareLabel("lastWeek", DAY, ["2026-11-11"])).toBe("the same weekday last week (2026-11-11)");
    expect(compareLabel("fourWeeks", DAY, ["2026-11-11", "2026-11-04", "2026-10-28", "2026-10-21"])).toBe("the average of the last four Wednesdays");
    expect(compareLabel("fourWeeks", DAY, ["2026-11-11", "2026-10-28"])).toBe("the average of 2 of the last four Wednesdays (the others have no orders)");
    expect(compareLabel("lastYear", DAY, ["2025-11-18"])).toBe("the same day last year (2025-11-18)");
    expect(compareLabel("lastYear", "2026-11-27", ["2025-11-28"])).toBe("last year's Black Friday (2025-11-28)");
  });

  const hours = [oh(9, 90, 60, 1, 1), oh(10, 40, 40, 1, 1)];
  const lastWeek = [oh(9, 50, 30, 1, 1, "2026-11-11"), oh(10, 100, 100, 2, 2, "2026-11-11"), oh(20, 10, 10, 1, 1, "2026-11-11")];

  it("same weekday last week: the expectation is that day's own hours", () => {
    const r = buildHourly(input({ hours, compare: "lastWeek", reference: [lastWeek], plan }));
    expect(r.rows[9].cells.rev).toMatchObject({ actual: 150, expected: 80, tone: "good" });
    expect(r.rows[10].cells.rev).toMatchObject({ actual: 80, expected: 200, tone: "bad" });
    expect(r.rows[9].cells.aov.expected).toBe(40);
    expect(r.rows[3].cells.rev.expected).toBe(0);
    expect(r.rows[3].cells.aov.expected).toBeNull();
    expect(r.day.cells.rev).toMatchObject({ actual: 230, expected: 300, full: 300 });
    expect(r.day.cells.aov.expected).toBeCloseTo(300 / 8, 9);
  });

  it("columns with no hourly source have nothing to compare with in these modes", () => {
    const r = buildHourly(input({ hours, compare: "lastWeek", reference: [lastWeek] }));
    expect(r.rows[9].cells.spend).toMatchObject({ actual: null, expected: null, noData: true });
    expect(r.day.cells.spend.expected).toBeNull();
  });

  it("average of the last four same weekdays: the mean of the days that have orders", () => {
    const other = [oh(9, 150, 70, 3, 1, "2026-11-04")];
    const r = buildHourly(input({ hours, compare: "fourWeeks", reference: [lastWeek, [], other] }));
    expect(r.rows[9].cells.rev.expected).toBeCloseTo((80 + 220) / 2, 9);
    expect(r.rows[9].cells.orders.expected).toBeCloseTo((2 + 4) / 2, 9);
    expect(r.rows[9].cells.aov.expected).toBeCloseTo(300 / 6, 9);
    expect(r.rows[10].cells.rev.expected).toBeCloseTo(200 / 2, 9);
    expect(r.day.cells.rev.expected).toBeCloseTo((300 + 220) / 2, 9);
  });

  it("no reference day with orders: nothing to expect", () => {
    const r = buildHourly(input({ hours, compare: "lastYear", reference: [[]] }));
    expect(r.hasExpectation).toBe(false);
    expect(r.rows[9].cells.rev).toMatchObject({ actual: 150, expected: null, tone: "neutral" });
  });

  it("today: the expectation so far is the reference day up to the same time, and the heading scales its total", () => {
    const r = buildHourly(input({ clock: { date: DAY, hour: 10, minute: 45 }, asOf: { hour: 10, minute: 29 }, hours, compare: "lastWeek", reference: [lastWeek] }));
    const soFar = 80 + 200 * 0.5;
    expect(r.day.cells.rev.actual).toBe(230);
    expect(r.day.cells.rev.expected).toBeCloseTo(soFar, 9);
    expect(r.day.cells.rev.full).toBe(300);
    expect(r.day.cells.rev.heading).toBeCloseTo(230 / (soFar / 300), 9);
    expect(r.rows[10].state).toBe("partial");
  });

  it("cumulative: the reference's running totals and running ratios", () => {
    const r = buildHourly(input({ hours, compare: "lastWeek", reference: [lastWeek], cumulative: true }));
    expect(r.rows[10].cells.rev.expected).toBe(280);
    expect(r.rows[10].cells.aov.expected).toBeCloseTo(280 / 6, 9);
    expect(r.rows[23].cells.rev.expected).toBe(300);
  });
});

const ev = (id: string, type: string, name: string, sendTime?: string, date = DAY, endDate = date): MarketingEvent => ({ id, clientId: "c1", date, endDate, type, name, source: "manual", ...(sendTime ? { sendTime } : {}) });

describe("sends, events and markers of the day", () => {
  const events = [
    ev("a", "email", "VIP early access", "09:00"),
    ev("b", "sms", "Doors open", "12:30"),
    ev("c", "email", "Last call"),
    ev("d", "sitewide", "Black Week", undefined, "2026-11-16", "2026-11-22"),
    ev("e", "product_launch", "New colourway", "10:00"),
    ev("f", "email", "Yesterday's email", "08:00", "2026-11-17"),
    ev("g", "email", "Week of emails", "07:00", "2026-11-17", "2026-11-19"),
  ];

  it("sends are the email and SMS events that start on the day, timed ones first in clock order", () => {
    expect(sendsOn(events, DAY)).toEqual([
      { type: "email", name: "VIP early access", time: "09:00", hour: 9 },
      { type: "sms", name: "Doors open", time: "12:30", hour: 12 },
      { type: "email", name: "Last call", time: null, hour: null },
    ]);
  });

  it("timed events that start on the day sit on their hour", () => {
    expect(eventMarkers(events, DAY)).toEqual([
      { hour: 9, type: "email", name: "VIP early access" },
      { hour: 10, type: "event", name: "New colourway" },
      { hour: 12, type: "sms", name: "Doors open" },
    ]);
  });

  it("the rest of the day's events and the sends with no time are listed above the grid", () => {
    expect(dayListing(events, DAY)).toEqual({
      events: [
        { type: "Sitewide", name: "Black Week" },
        { type: "Email", name: "Week of emails" },
      ],
      untimed: [{ type: "email", name: "Last call", time: null, hour: null }],
    });
  });

  it("Meta launches read as new ads in a campaign on their hour", () => {
    expect(launchMarkers([{ date: DAY, hour: 12, campaign: "ACQ | Evergreen", ads: 6 }, { date: DAY, hour: 15, campaign: "RTN | VIP", ads: 1 }, { date: "2026-11-17", hour: 3, campaign: "old", ads: 2 }], DAY)).toEqual([
      { hour: 12, type: "meta", name: "6 new ads in ACQ | Evergreen" },
      { hour: 15, type: "meta", name: "1 new ad in RTN | VIP" },
    ]);
  });
});

describe("sendReadings", () => {
  const clock = { date: DAY, hour: 14, minute: 10 };
  // 100 an hour expected (50 returning). After the 09:00 email: 300, 250, 150 against 100 each.
  const hours = [...everyHour(9, 50, 50), oh(9, 100, 200), oh(10, 100, 150), oh(11, 50, 100), oh(12, 50, 50), oh(13, 10, 0, 1, 0)];
  const r = buildHourly(input({ clock, asOf: { hour: 13, minute: 20 }, hours }));
  const sends = sendsOn([ev("a", "email", "VIP early access", "09:00"), ev("b", "sms", "Doors open", "12:30"), ev("c", "email", "Last call")], DAY);

  it("reads the three hours from a send against the same hours' expectation, for total and returning revenue", () => {
    const [email] = sendReadings(r.hourRows, sends);
    expect(email.hours).toEqual([9, 10, 11]);
    expect(email.complete).toBe(true);
    expect(email.revenue.actual).toBe(700);
    expect(email.revenue.expected).toBeCloseTo(300, 6);
    expect(email.revenue.gap).toBeCloseTo(400, 6);
    expect(email.returning.actual).toBe(450);
    expect(email.returning.gap).toBeCloseTo(300, 6);
  });

  it("a send whose three hours are not over has no reading yet, and a send with no time has none at all", () => {
    const out = sendReadings(r.hourRows, sends);
    expect(out).toHaveLength(2);
    expect(out[1]).toMatchObject({ complete: false, hours: [12, 13, 14], revenue: { actual: null, expected: null, gap: null } });
  });

  it("stops at midnight for a late send, and reads without an expectation when there is none", () => {
    const late = sendsOn([ev("z", "sms", "Final hours", "22:15")], DAY);
    const past = buildHourly(input({ hours: [oh(22, 100, 100), oh(23, 50, 50)], plan: null }));
    expect(sendReadings(past.hourRows, late)[0]).toMatchObject({ hours: [22, 23], complete: true, revenue: { actual: 300, expected: null, gap: null } });
  });

  it("works on the per-hour rows even when the grid is cumulative", () => {
    const cum = buildHourly(input({ clock, asOf: { hour: 13, minute: 20 }, hours, cumulative: true }));
    expect(sendReadings(cum.hourRows, sends)[0].revenue.actual).toBe(700);
  });
});

describe("planBSignal", () => {
  const clock = { date: DAY, hour: 14, minute: 10 };
  const asOf = { hour: 12, minute: 40 };
  // Returning revenue 40 an hour against 50 expected: 480 against 634.17 so far (-24%). Total 1,230 against 1,268.33 (-3%).
  const behind = buildHourly(input({ clock, asOf, hours: [...everyHour(12, 62.5, 40)] }));
  const timed = [ev("a", "email", "VIP early access", "09:00"), ev("b", "sms", "Doors open", "12:00")];

  it("is silent when the day is within 10% of its expectation", () => {
    const fine = buildHourly(input({ clock, asOf, hours: [...everyHour(12, 60, 50), oh(12, 30, 20)] }));
    expect(planBSignal(fine, clock, sendsOn(timed, DAY))).toBeNull();
  });

  it("returning revenue more than 10% behind with every planned send out: nothing is left, and it gives the amount to close by midnight", () => {
    const s = planBSignal(behind, clock, sendsOn(timed, DAY))!;
    const expectedSoFar = 600 + 50 * (41 / 60);
    expect(s.metric).toBe("retRev");
    expect(s.behindBy).toBeCloseTo(expectedSoFar - 480, 6);
    expect(s.diff).toBeCloseTo((480 - expectedSoFar) / expectedSoFar, 9);
    expect(s.out.map((x) => x.name)).toEqual(["VIP early access", "Doors open"]);
    expect(s.toGo).toEqual([]);
    expect(s.untimed).toEqual([]);
    // The day's target less where the day is heading at this pace.
    expect(s.toClose).toBeCloseTo(1200 - 480 / (expectedSoFar / 1200), 6);
  });

  it("names the planned sends still to go", () => {
    const s = planBSignal(behind, clock, sendsOn([...timed, ev("c", "email", "Last call", "18:00"), ev("d", "sms", "Final hours", "14:30")], DAY))!;
    expect(s.toGo.map((x) => `${x.time} ${x.name}`)).toEqual(["14:30 Final hours", "18:00 Last call"]);
    expect(s.out).toHaveLength(2);
  });

  it("never counts a send with no time as already out", () => {
    const s = planBSignal(behind, clock, sendsOn([timed[0], ev("c", "email", "Last call")], DAY))!;
    expect(s.out.map((x) => x.name)).toEqual(["VIP early access"]);
    expect(s.untimed.map((x) => x.name)).toEqual(["Last call"]);
    expect(s.toGo).toEqual([]);
  });

  it("falls to total revenue when only the total is behind", () => {
    const totalBehind = buildHourly(input({ clock, asOf, hours: [...everyHour(12, 30, 50)] }));
    expect(planBSignal(totalBehind, clock, [])).toMatchObject({ metric: "rev", out: [], toGo: [] });
  });

  it("says nothing on a finished day or a day with nothing to compare with", () => {
    expect(planBSignal(buildHourly(input({ hours: everyHour(24, 10, 10) })), PAST, [])).toBeNull();
    expect(planBSignal(buildHourly(input({ clock, asOf, hours: everyHour(12, 10, 10), plan: null })), clock, [])).toBeNull();
  });
});

describe("summarise", () => {
  const clock = { date: DAY, hour: 14, minute: 10 };
  const asOf = { hour: 12, minute: 40 };
  const sum = (over: Partial<HourlyInput>, events: MarketingEvent[] = [], compare = "the plan") => {
    const i = input(over);
    return summarise({ result: buildHourly(i), clock: i.clock, sends: sendsOn(events, DAY), compare: i.compare, compareLabel: compare, currency: "USD" });
  };

  it("today: revenue so far against expected, and where the day is heading against its target", () => {
    const s = sum({ clock, asOf, hours: [...everyHour(12, 60, 50), oh(12, 30, 0, 1, 0)] });
    expect(s.lines[0]).toBe("To 12:40 (the last order loaded): revenue US$1,350 of US$1,268 expected (+6.4%), heading for US$2,555 against a target of US$2,400.");
    expect(s.lines[1]).toBe("AOV so far is US$54.00 against US$100.00 expected (-46.0%).");
    expect(s.planB).toBeNull();
  });

  it("today behind on returning revenue with the sends out: the Plan B sentence", () => {
    const s = sum({ clock, asOf, hours: [...everyHour(12, 62.5, 40)] }, [ev("a", "email", "VIP early access", "09:00"), ev("b", "sms", "Doors open", "12:00")]);
    const line = s.lines.find((l) => l.startsWith("Returning revenue"))!;
    expect(line).toBe('Returning revenue is US$154 behind (-24.3%). Both planned sends are out (09:00 Email "VIP early access", 12:00 SMS "Doors open"): nothing planned is left today, US$292 to close by midnight.');
    expect(s.planB?.metric).toBe("retRev");
  });

  it("today behind with sends still to go, and one with no time set", () => {
    const s = sum({ clock, asOf, hours: [...everyHour(12, 62.5, 40)] }, [ev("a", "email", "VIP early access", "09:00"), ev("c", "email", "Last call", "18:00"), ev("d", "sms", "Reminder")]);
    const line = s.lines.find((l) => l.startsWith("Returning revenue"))!;
    expect(line).toBe('Returning revenue is US$154 behind (-24.3%). 1 planned send is still to go today (18:00 Email "Last call"). 1 planned send has no time set (SMS "Reminder"), so the page cannot tell whether it is out.');
  });

  it("today behind with no send in the calendar", () => {
    const s = sum({ clock, asOf, hours: [...everyHour(12, 62.5, 40)] });
    expect(s.lines.find((l) => l.startsWith("Returning revenue"))).toBe("Returning revenue is US$154 behind (-24.3%). No send is planned today in the calendar: US$292 to close by midnight.");
  });

  it("adds what each send did once its three hours are over", () => {
    const hours = [...everyHour(9, 50, 50), oh(9, 100, 200), oh(10, 100, 150), oh(11, 50, 100), oh(12, 50, 50), oh(13, 10, 0, 1, 0)];
    const s = sum({ clock, asOf: { hour: 13, minute: 20 }, hours }, [ev("a", "email", "VIP early access", "09:00"), ev("b", "sms", "Doors open", "12:30")]);
    expect(s.readingLines).toEqual(['Email "VIP early access" at 09:00: +US$400 revenue against expected over 3 hours (returning revenue +US$300).', 'SMS "Doors open" at 12:30: its three hours are not over yet.']);
    expect(s.readings).toHaveLength(2);
  });

  it("names the reference in the other comparisons", () => {
    const lastWeek = [oh(9, 50, 30, 1, 1, "2026-11-11"), oh(10, 100, 100, 2, 2, "2026-11-11"), oh(20, 10, 10, 1, 1, "2026-11-11")];
    const s = sum({ clock: { date: DAY, hour: 10, minute: 45 }, asOf: { hour: 10, minute: 29 }, hours: [oh(9, 90, 60), oh(10, 40, 40)], compare: "lastWeek", reference: [lastWeek] }, [], "the same weekday last week (2026-11-11)");
    expect(s.lines[0]).toBe("To 10:29 (the last order loaded): revenue US$230 of US$180 expected (+27.8%), heading for US$383 against US$300 on the same weekday last week (2026-11-11).");
  });

  it("a finished day: how it closed", () => {
    const s = sum({ hours: [oh(9, 1500, 1000, 10, 10)] });
    expect(s.lines[0]).toBe("The day closed at US$2,500 revenue against US$2,400 expected (+4.2%).");
    expect(s.lines[1]).toBe("AOV was US$125.00 against US$100.00 expected (+25.0%).");
  });

  it("says so plainly when there is nothing to compare with or nothing loaded", () => {
    expect(sum({ hours: [oh(9, 1500, 1000, 10, 10)], plan: null }).lines[0]).toBe("The day closed at US$2,500 revenue from 20 orders. There is nothing to compare it with.");
    expect(sum({ hours: [] }).lines[0]).toBe("No orders are loaded for this day.");
    expect(sum({ clock, asOf: null, hours: [] }).lines[0]).toBe("No orders are loaded for today yet. Expected revenue for the day: US$2,400.");
    expect(sum({ clock: { date: "2026-11-17", hour: 9, minute: 0 } }).lines[0]).toBe("This day has not started yet. Expected revenue for the day: US$2,400.");
  });
});

describe("hourlyCsv", () => {
  it("has a row per hour and the Day row, with actual, expected and difference for each picked column", () => {
    const r = buildHourly(input({ hours: [oh(9, 90, 60)], markers: [{ hour: 9, type: "email", name: "VIP early access" }] }));
    const csv = hourlyCsv(r, HOURLY_SPECS.filter((s) => s.key === "rev" || s.key === "spend"));
    expect(csv.head).toEqual(["Hour", "Status", "What happened", "Revenue", "Revenue expected", "Revenue difference %", "Ad spend", "Ad spend expected", "Ad spend difference %"]);
    expect(csv.rows).toHaveLength(25);
    expect(csv.rows[9].slice(0, 4)).toEqual(["09:00", "done", "Email: VIP early access", 150]);
    expect(csv.rows[9][4]).toBeCloseTo(100, 6);
    expect(csv.rows[9][5]).toBeCloseTo(50, 6);
    expect(csv.rows[9][6]).toBeNull();
    expect(csv.rows[24][0]).toBe("Day");
  });
});

describe("toChartRows", () => {
  it("draws done hours as actuals, leaves partial hours out and shows hours to come as the expectation", () => {
    const r = buildHourly(input({ clock: { date: DAY, hour: 14, minute: 10 }, asOf: { hour: 12, minute: 40 }, hours: [...everyHour(12, 60, 50), oh(12, 30, 0, 1, 0)], markers: [{ hour: 9, type: "email", name: "VIP early access" }] }));
    const rows = toChartRows(DAY, r.rows);
    expect(rows).toHaveLength(24);
    expect(rows[9]).toMatchObject({ label: "09:00", projected: false, actions: [{ date: DAY, type: "email", name: "VIP early access" }] });
    expect(rows[9].cells.rev.actual).toBe(110);
    expect(rows[12].cells.rev.actual).toBeNull();
    expect(rows[12].projected).toBe(false);
    expect(rows[18].projected).toBe(true);
    expect(rows[18].cells.rev.actual).toBeCloseTo(100, 6);
    expect(new Set(rows.map((x) => x.date)).size).toBe(24);
  });
});

describe("daysToLoad", () => {
  it("asks for the day and the four weeks before it in one go, and each further reference day on its own", () => {
    expect(daysToLoad("2026-11-18", [])).toEqual({ from: "2026-10-21", to: "2026-11-18", extra: ["2025-11-18"] });
  });

  it("adds last year's Black Friday and an event's day last year when they give the shape", () => {
    const events = [ev("a", "mothers_day", "", undefined, "2026-05-10"), ev("b", "mothers_day", "", undefined, "2025-05-11")];
    expect(daysToLoad("2026-05-10", events).extra).toEqual(["2025-05-10", "2025-05-11"]);
    expect(daysToLoad("2026-11-27", [])).toEqual({ from: "2026-10-30", to: "2026-11-27", extra: ["2025-11-28"] });
  });
});
