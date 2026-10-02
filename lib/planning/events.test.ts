import { describe, expect, it } from "vitest";
import { addDays } from "../dates";
import { dayMultipliers, DEFAULT_EVENT_SETTINGS, liftsFor, matchType, measureEventDays, parseEventCsv, suggestEvents, type DayFact, type MarketingEvent } from "./events";

const flat = [0, 0, 0, 0, 0, 0, 0];
const ev = (id: string, date: string, type: string, endDate = date): MarketingEvent => ({ id, clientId: "c", date, endDate, type, name: `${type} ${id}`, source: "manual" });

/** 200 ordinary days (spend 1000, new 3000, returning 2000) with the given event days boosted. */
function series(boost: Record<string, Partial<DayFact>>): DayFact[] {
  return Array.from({ length: 200 }, (_, i) => {
    const date = addDays("2025-01-01", i);
    return { date, spend: 1000, newRevenue: 3000, returning: 2000, ...(boost[date] ?? {}) };
  });
}

describe("measuring event days", () => {
  it("measures each lift against the ordinary days around the event", () => {
    const days = series({ "2025-03-10": { spend: 1500, newRevenue: 6000, returning: 3000 } });
    const r = measureEventDays(days, [ev("a", "2025-03-10", "promotion")], flat, "2025-07-19");
    expect(r).toHaveLength(1);
    expect(r[0].lifts.spend).toBeCloseTo(1.5);
    expect(r[0].lifts.newRevenue).toBeCloseTo(2);
    expect(r[0].lifts.returning).toBeCloseTo(1.5);
    expect(r[0].lifts.amer).toBeCloseTo(2 / 1.5);
  });

  it("does not count other event days as ordinary, and skips initiatives", () => {
    const days = series({ "2025-03-10": { newRevenue: 6000 }, "2025-03-11": { newRevenue: 6000 } });
    const r = measureEventDays(days, [ev("a", "2025-03-10", "promotion", "2025-03-11"), ev("b", "2025-04-10", "initiative")], flat, "2025-07-19");
    expect(r.map((x) => x.date)).toEqual(["2025-03-10", "2025-03-11"]);
    expect(r[0].lifts.newRevenue).toBeCloseTo(2);
  });
});

describe("lifts for a future event", () => {
  const days = series({ "2025-03-10": { newRevenue: 6000 }, "2025-04-10": { newRevenue: 4500 }, "2025-05-10": { newRevenue: 9000 }, "2025-06-10": { newRevenue: 3600 } });
  const events = ["2025-03-10", "2025-04-10", "2025-05-10", "2025-06-10"].map((d, i) => ev(String(i), d, "promotion"));
  const results = measureEventDays(days, events, flat, "2025-07-19");

  it("conservative <= typical <= strong", () => {
    const c = liftsFor("promotion", "conservative", results).newRevenue;
    const t = liftsFor("promotion", "typical", results).newRevenue;
    const s = liftsFor("promotion", "strong", results).newRevenue;
    expect(c).toBeLessThanOrEqual(t);
    expect(t).toBeLessThanOrEqual(s);
    expect(t).toBeGreaterThan(1);
  });

  it("a type with no history gets half of the all-events effect; initiatives get none", () => {
    const x = liftsFor("mothers_day", "typical", results);
    expect(x.known).toBe(false);
    expect(x.newRevenue).toBeGreaterThan(1);
    expect(x.newRevenue).toBeLessThan(liftsFor("promotion", "typical", results).newRevenue);
    expect(liftsFor("initiative", "typical", results).newRevenue).toBe(1);
  });

  it("multipliers: the strongest main event wins and comms events only count alone", () => {
    const list = [ev("p", "2026-05-01", "promotion"), ev("e", "2026-05-01", "email"), ev("e2", "2026-05-02", "email")];
    const m = dayMultipliers(list, DEFAULT_EVENT_SETTINGS, results);
    expect(m["2026-05-01"].label).toContain("promotion");
    expect(m["2026-05-02"]).toBeDefined();
    const off = dayMultipliers(list, { ...DEFAULT_EVENT_SETTINGS, perEvent: { p: { stance: "typical", off: true } } }, results);
    expect(off["2026-05-01"].label).toContain("email");
  });
});

describe("csv import and suggestions", () => {
  it("parses dates, matches types and reports bad rows", () => {
    const r = parseEventCsv("Date,End Date,Type,Name,Segment Size\n2026-11-24,2026-11-30,Black Friday,BFCM,\n12/12/2026,,mothers day,Gifting,\"12,000\"\nnope,,Email,x,\n");
    expect(r.events).toHaveLength(2);
    expect(r.events[0]).toMatchObject({ date: "2026-11-24", endDate: "2026-11-30", type: "black_friday" });
    expect(r.events[1]).toMatchObject({ date: "2026-12-12", endDate: "2026-12-12", type: "mothers_day", segmentSize: 12000 });
    expect(r.errors).toHaveLength(1);
    expect(matchType("zzz")).toBe("other");
  });

  it("suggests unlabelled spike days and merges runs", () => {
    const days = series({ "2025-03-10": { newRevenue: 9000 }, "2025-03-11": { newRevenue: 9000 }, "2025-05-01": { newRevenue: 9000 } });
    const s = suggestEvents(days, [ev("a", "2025-05-01", "promotion")], flat, "2025-01-01", "2025-07-19");
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ date: "2025-03-10", endDate: "2025-03-11" });
  });
});
