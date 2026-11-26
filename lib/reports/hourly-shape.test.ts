import { describe, expect, it } from "vitest";
import type { MarketingEvent } from "../planning/events";
import { bfcmReference, EVEN_SHARES, eventReference, hourShares, lastYearDay, pickShape, sameWeekdaysBefore, shapeCandidates } from "./hourly-shape";

const ev = (id: string, type: string, date: string, endDate = date, name = ""): MarketingEvent => ({ id, clientId: "c1", date, endDate, type, name, source: "manual" });
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
/** 24 hourly revenues with everything in one hour. */
const spike = (hour: number, amount = 100) => Array.from({ length: 24 }, (_, h) => (h === hour ? amount : 0));

describe("bfcmReference", () => {
  it("maps Thanksgiving to Cyber Monday onto the day at the same distance from Thanksgiving last year", () => {
    // Thanksgiving: 2026-11-26 and 2025-11-27.
    expect(bfcmReference("2026-11-26")).toEqual({ date: "2025-11-27", name: "Thanksgiving" });
    expect(bfcmReference("2026-11-27")).toEqual({ date: "2025-11-28", name: "Black Friday" });
    expect(bfcmReference("2026-11-28")).toEqual({ date: "2025-11-29", name: "Black Friday weekend Saturday" });
    expect(bfcmReference("2026-11-29")).toEqual({ date: "2025-11-30", name: "Black Friday weekend Sunday" });
    expect(bfcmReference("2026-11-30")).toEqual({ date: "2025-12-01", name: "Cyber Monday" });
  });

  it("is null outside those five days", () => {
    expect(bfcmReference("2026-11-25")).toBeNull();
    expect(bfcmReference("2026-12-01")).toBeNull();
    expect(bfcmReference("2026-06-10")).toBeNull();
  });
});

describe("lastYearDay", () => {
  it("is the same calendar date a year back, except on BFCM days", () => {
    expect(lastYearDay("2026-06-10")).toBe("2025-06-10");
    expect(lastYearDay("2026-11-27")).toBe("2025-11-28");
  });
});

describe("eventReference", () => {
  it("a one-day event maps to the same event type's day last year", () => {
    const events = [ev("a", "mothers_day", "2026-05-10"), ev("b", "mothers_day", "2025-05-11")];
    expect(eventReference("2026-05-10", events)).toEqual({ date: "2025-05-11", name: "Mother's Day", day: 1, days: 1 });
  });

  it("a day inside a longer event maps to the same offset from last year's start, and carries the event's own name", () => {
    const events = [ev("a", "promotion", "2026-07-10", "2026-07-14", "Summer Sale"), ev("b", "promotion", "2025-07-11", "2025-07-15", "Summer Sale 2025"), ev("far", "promotion", "2025-02-01", "2025-02-05", "Winter Sale")];
    expect(eventReference("2026-07-12", events)).toEqual({ date: "2025-07-13", name: "Summer Sale 2025", day: 3, days: 5 });
  });

  it("has no reference when last year's event did not run that long, or there was none near the same time of year", () => {
    const short = [ev("a", "promotion", "2026-07-10", "2026-07-14"), ev("b", "promotion", "2025-07-11", "2025-07-12")];
    expect(eventReference("2026-07-13", short)).toBeNull();
    expect(eventReference("2026-07-10", [ev("a", "promotion", "2026-07-10"), ev("far", "promotion", "2025-02-01")])).toBeNull();
  });

  it("ignores sends, comms and initiatives: they are not what shapes the day", () => {
    const events = [ev("a", "email", "2026-07-10"), ev("b", "email", "2025-07-10"), ev("c", "initiative", "2026-07-10"), ev("d", "initiative", "2025-07-10")];
    expect(eventReference("2026-07-10", events)).toBeNull();
  });

  it("prefers the shortest event the day sits in", () => {
    const events = [ev("long", "sitewide", "2026-07-01", "2026-07-31"), ev("longLy", "sitewide", "2025-07-01", "2025-07-31"), ev("day", "product_launch", "2026-07-10"), ev("dayLy", "product_launch", "2025-07-08")];
    expect(eventReference("2026-07-10", events)?.date).toBe("2025-07-08");
  });
});

describe("sameWeekdaysBefore", () => {
  it("lists the four same weekdays before the day, nearest first", () => {
    expect(sameWeekdaysBefore("2026-11-18")).toEqual(["2026-11-11", "2026-11-04", "2026-10-28", "2026-10-21"]);
  });
});

describe("shapeCandidates", () => {
  it("an ordinary day: the last four same weekdays, then an even split", () => {
    const c = shapeCandidates("2026-11-18", []);
    expect(c.map((x) => x.kind)).toEqual(["weekdays", "even"]);
    expect(c[0]).toEqual({ kind: "weekdays", dates: ["2026-11-11", "2026-11-04", "2026-10-28", "2026-10-21"], label: "the last four Wednesdays" });
    expect(c[1]).toEqual({ kind: "even", dates: [], label: "an even split" });
  });

  it("a BFCM day comes first with last year's same day, even inside another event", () => {
    const events = [ev("a", "cyber_week", "2026-11-23", "2026-12-02"), ev("b", "cyber_week", "2025-11-24", "2025-12-03")];
    const c = shapeCandidates("2026-11-27", events);
    expect(c.map((x) => x.kind)).toEqual(["bfcm", "event", "weekdays", "even"]);
    expect(c[0]).toEqual({ kind: "bfcm", dates: ["2025-11-28"], label: "last year's Black Friday (2025-11-28)" });
    expect(c[1]).toEqual({ kind: "event", dates: ["2025-11-28"], label: "day 5 of last year's Cyber Week excl BFCM (2025-11-28)" });
  });

  it("a day inside another event uses that event's day last year", () => {
    const c = shapeCandidates("2026-05-10", [ev("a", "mothers_day", "2026-05-10"), ev("b", "mothers_day", "2025-05-11")]);
    expect(c[0]).toEqual({ kind: "event", dates: ["2025-05-11"], label: "last year's Mother's Day (2025-05-11)" });
    expect(c.map((x) => x.kind)).toEqual(["event", "weekdays", "even"]);
  });
});

describe("hourShares", () => {
  it("is each hour's part of the day and adds up to exactly 1", () => {
    const s = hourShares(Array.from({ length: 24 }, (_, h) => (h === 9 ? 300 : h === 20 ? 100 : 0)))!;
    expect(s[9]).toBeCloseTo(0.75, 12);
    expect(s[20]).toBeCloseTo(0.25, 12);
    expect(sum(s)).toBe(1);
  });

  it("adds up to exactly 1 on awkward numbers", () => {
    let seed = 12345;
    const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let i = 0; i < 2000; i++) {
      const s = hourShares(Array.from({ length: 24 }, () => (next() < 0.15 ? 0 : next() * 5000 + 0.01)))!;
      expect(sum(s)).toBe(1);
      expect(s.every((x) => x >= 0)).toBe(true);
    }
  });

  it("is null when the reference has no revenue", () => {
    expect(hourShares(spike(3, 0))).toBeNull();
    expect(hourShares([])).toBeNull();
  });

  it("the even split is a 24th every hour and adds up to exactly 1", () => {
    expect(EVEN_SHARES).toHaveLength(24);
    expect(EVEN_SHARES[5]).toBeCloseTo(1 / 24, 12);
    expect(sum(EVEN_SHARES)).toBe(1);
  });
});

describe("pickShape", () => {
  const bf = shapeCandidates("2026-11-27", []);
  const revenue = (by: Record<string, number[]>) => (d: string) => by[d] ?? null;

  it("a Black Friday opens on last year's Black Friday and says so", () => {
    const s = pickShape(bf, revenue({ "2025-11-28": spike(0) }), "auto");
    expect(s).toMatchObject({ kind: "bfcm", dates: ["2025-11-28"], label: "last year's Black Friday (2025-11-28)", fellBack: false });
    expect(s.shares[0]).toBe(1);
  });

  it("falls to the last four same weekdays when last year has no orders, pooling their revenue by hour", () => {
    const s = pickShape(bf, revenue({ "2025-11-28": spike(0, 0), "2026-11-20": spike(10, 300), "2026-11-13": spike(20, 100) }), "auto");
    expect(s.kind).toBe("weekdays");
    expect(s.dates).toEqual(["2026-11-20", "2026-11-13"]);
    expect(s.label).toBe("2 of the last four Fridays (the others have no orders)");
    expect(s.shares[10]).toBeCloseTo(0.75, 12);
    expect(s.shares[20]).toBeCloseTo(0.25, 12);
    expect(s.fellBack).toBe(true);
  });

  it("says the last four weekdays plainly when all four have orders", () => {
    const by = Object.fromEntries(sameWeekdaysBefore("2026-11-18").map((d) => [d, spike(12)]));
    expect(pickShape(shapeCandidates("2026-11-18", []), revenue(by), "auto")).toMatchObject({ kind: "weekdays", label: "the last four Wednesdays", fellBack: false });
  });

  it("with no history at all it is an even split, and says so", () => {
    const s = pickShape(bf, () => null, "auto");
    expect(s).toMatchObject({ kind: "even", dates: [], label: "an even split", fellBack: true });
    expect(s.shares).toEqual(EVEN_SHARES);
  });

  it("a shape picked by hand is used when it applies to the day", () => {
    const by = { "2025-11-28": spike(0), "2026-11-20": spike(10) };
    expect(pickShape(bf, revenue(by), "weekdays").kind).toBe("weekdays");
    expect(pickShape(bf, revenue(by), "even")).toMatchObject({ kind: "even", fellBack: false });
    // "event" does not apply to this day: the automatic rule is used instead.
    expect(pickShape(bf, revenue(by), "event").kind).toBe("bfcm");
  });

  it("a shape picked by hand that has no orders falls back to an even split", () => {
    expect(pickShape(bf, revenue({ "2025-11-28": spike(0) }), "weekdays")).toMatchObject({ kind: "even", fellBack: true });
  });
});
