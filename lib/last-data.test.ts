import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { holdsWholeDay, lastCompleteDay, lastDataDate, localMidnight } from "./last-data";

interface FactRow {
  date: string;
  updated_at: string | null;
}
const state = vi.hoisted(() => ({ timezone: "America/Denver" as string | null, facts: [] as { date: string; updated_at: string | null }[], lteAsked: [] as string[] }));

// A stand-in for the browser's database client: `daily_facts` honours the date bound, the order and the limit; `clients` returns the time zone.
vi.mock("./supabase/client", () => ({
  getBrowserClient: () => ({
    from: (table: string) => {
      let bound: string | null = null;
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        order: () => chain,
        lte: (_column: string, value: string) => {
          bound = value;
          state.lteAsked.push(value);
          return chain;
        },
        maybeSingle: async () => ({ data: table === "clients" ? { timezone: state.timezone } : null, error: null }),
        limit: async (n: number) => ({
          data: [...state.facts]
            .filter((r) => bound === null || r.date <= bound)
            .sort((a, b) => (a.date < b.date ? 1 : -1))
            .slice(0, n),
          error: null,
        }),
      };
      return chain;
    },
  }),
}));

const { SupabaseRepository } = await import("./repository/supabase");
const lastData = () => new SupabaseRepository().getLastDataDate("c1");
const addDay = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
/** Daily rows as the daily sync leaves them: each day built twenty minutes after it ended in Denver (07:20Z the next day). */
const syncedThrough = (from: string, to: string): FactRow[] => {
  const out: FactRow[] = [];
  for (let d = from; d <= to; d = addDay(d, 1)) out.push({ date: d, updated_at: `${addDay(d, 1)}T07:20:00Z` });
  return out;
};

describe("lastCompleteDay", () => {
  it("is the store's yesterday on its own clock", () => {
    const now = new Date("2026-11-27T21:10:00Z"); // 14:10 on the 27th in Denver, 16:10 in New York, 08:10 on the 28th in Sydney
    expect(lastCompleteDay(now, "America/Denver")).toBe("2026-11-26");
    expect(lastCompleteDay(now, "America/New_York")).toBe("2026-11-26");
    expect(lastCompleteDay(now, "Australia/Sydney")).toBe("2026-11-27");
  });
  it("moves on at the store's midnight, not at UTC's", () => {
    expect(lastCompleteDay(new Date("2026-11-28T06:59:00Z"), "America/Denver")).toBe("2026-11-26"); // 23:59 on the 27th: the 27th is still running
    expect(lastCompleteDay(new Date("2026-11-28T07:00:00Z"), "America/Denver")).toBe("2026-11-27"); // 00:00 on the 28th
  });
  it("reads a missing or unknown zone as UTC", () => {
    const now = new Date("2026-11-27T21:10:00Z");
    expect(lastCompleteDay(now, null)).toBe("2026-11-26");
    expect(lastCompleteDay(now, undefined)).toBe("2026-11-26");
    expect(lastCompleteDay(now, "Mars/Olympus")).toBe("2026-11-26");
  });
});

describe("localMidnight", () => {
  const iso = (date: string, zone: string | null) => localMidnight(date, zone).toISOString();
  it("is the instant the day begins on the store's clock", () => {
    expect(iso("2026-11-27", "America/Denver")).toBe("2026-11-27T07:00:00.000Z");
    expect(iso("2026-07-04", "America/Denver")).toBe("2026-07-04T06:00:00.000Z");
    expect(iso("2026-11-27", "Australia/Sydney")).toBe("2026-11-26T13:00:00.000Z");
    expect(iso("2026-11-27", "Asia/Kolkata")).toBe("2026-11-26T18:30:00.000Z");
    expect(iso("2026-11-27", null)).toBe("2026-11-27T00:00:00.000Z");
    expect(iso("2026-11-27", "Mars/Olympus")).toBe("2026-11-27T00:00:00.000Z");
  });
  it("is right on the days the clocks change", () => {
    // New York: clocks go back on 2026-11-01 and forward on 2026-03-08, both at 02:00, so each midnight keeps the offset in force before it
    expect(iso("2026-11-01", "America/New_York")).toBe("2026-11-01T04:00:00.000Z");
    expect(iso("2026-11-02", "America/New_York")).toBe("2026-11-02T05:00:00.000Z");
    expect(iso("2026-03-08", "America/New_York")).toBe("2026-03-08T05:00:00.000Z");
    expect(iso("2026-03-09", "America/New_York")).toBe("2026-03-09T04:00:00.000Z");
    // Sydney: forward on 2026-10-04, back on 2026-04-05
    expect(iso("2026-10-04", "Australia/Sydney")).toBe("2026-10-03T14:00:00.000Z");
    expect(iso("2026-10-05", "Australia/Sydney")).toBe("2026-10-04T13:00:00.000Z");
    expect(iso("2026-04-05", "Australia/Sydney")).toBe("2026-04-04T13:00:00.000Z");
    expect(iso("2026-04-06", "Australia/Sydney")).toBe("2026-04-05T14:00:00.000Z");
  });
});

describe("holdsWholeDay", () => {
  const tz = "America/Denver"; // the 26th ends at 07:00Z on the 27th
  it("a row built after the day ended holds the whole day", () => {
    expect(holdsWholeDay({ date: "2026-11-26", updatedAt: "2026-11-27T07:20:00Z" }, tz)).toBe(true); // the daily sync, 00:20
    expect(holdsWholeDay({ date: "2026-11-26", updatedAt: "2026-11-27T07:00:00Z" }, tz)).toBe(true);
    expect(holdsWholeDay({ date: "2026-11-26", updatedAt: "2026-12-05T12:00:00+00:00" }, tz)).toBe(true); // a later history load
  });
  it("a row built while the day was running holds only the day so far", () => {
    expect(holdsWholeDay({ date: "2026-11-26", updatedAt: "2026-11-26T22:00:00Z" }, tz)).toBe(false); // 15:00 that day (the store page)
    expect(holdsWholeDay({ date: "2026-11-26", updatedAt: "2026-11-27T06:59:59Z" }, tz)).toBe(false); // 23:59:59
  });
  it("an unknown build time is taken as whole, so older data is never hidden", () => {
    expect(holdsWholeDay({ date: "2026-11-26", updatedAt: null }, tz)).toBe(true);
    expect(holdsWholeDay({ date: "2026-11-26", updatedAt: "not a time" }, tz)).toBe(true);
  });
});

describe("lastDataDate", () => {
  const tz = "America/Denver";
  const stamps = (rows: FactRow[]) => rows.map((r) => ({ date: r.date, updatedAt: r.updated_at }));
  it("is the newest day whose row holds the whole day", () => {
    expect(lastDataDate(stamps(syncedThrough("2026-11-20", "2026-11-26")), tz)).toBe("2026-11-26");
    expect(lastDataDate(stamps([...syncedThrough("2026-11-20", "2026-11-25"), { date: "2026-11-26", updated_at: "2026-11-26T22:00:00Z" }]), tz)).toBe("2026-11-25");
  });
  it("gives the newest row rather than nothing when none holds its whole day, and null with no rows", () => {
    const partial = [
      { date: "2026-11-25", updatedAt: "2026-11-25T20:00:00Z" },
      { date: "2026-11-26", updatedAt: "2026-11-26T20:00:00Z" },
    ];
    expect(lastDataDate(partial, tz)).toBe("2026-11-26");
    expect(lastDataDate([], tz)).toBeNull();
  });
});

describe("getLastDataDate (what Home, the reports, the plan comparison and the trackers call the last day with data)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-27T21:10:00Z")); // 14:10 on Black Friday in Denver
    state.timezone = "America/Denver";
    state.facts = [];
    state.lteAsked = [];
  });
  afterEach(() => vi.useRealTimers());

  it("is yesterday when the daily sync has loaded yesterday", async () => {
    state.facts = syncedThrough("2026-11-01", "2026-11-26");
    expect(await lastData()).toBe("2026-11-26");
  });

  it("never returns the store's today, even when today's daily row exists (the Shopify store page was opened)", async () => {
    state.facts = [...syncedThrough("2026-11-01", "2026-11-26"), { date: "2026-11-27", updated_at: "2026-11-27T21:05:00Z" }]; // a row for today, holding the day so far
    expect(await lastData()).toBe("2026-11-26");
    expect(state.lteAsked).toEqual(["2026-11-26"]);
  });

  it("ignores rows dated after today as well", async () => {
    state.facts = [...syncedThrough("2026-11-01", "2026-11-26"), { date: "2026-11-28", updated_at: null }, { date: "2026-12-01", updated_at: null }];
    expect(await lastData()).toBe("2026-11-26");
  });

  it("stays on the last day the data really reaches when the daily sync is behind", async () => {
    state.facts = syncedThrough("2026-11-01", "2026-11-24");
    expect(await lastData()).toBe("2026-11-24");
  });

  it("uses the store's clock, not the viewer's: for a Sydney store the 27th is over at this instant", async () => {
    state.timezone = "Australia/Sydney";
    state.facts = [...syncedThrough("2026-11-01", "2026-11-27"), { date: "2026-11-28", updated_at: "2026-11-27T21:05:00Z" }];
    expect(await lastData()).toBe("2026-11-27");
  });

  it("just after the store's midnight, a day that only has the row built during the day does not count until the daily sync rebuilds it", async () => {
    vi.setSystemTime(new Date("2026-11-28T07:20:00Z")); // 00:20 on the 28th in Denver: the 27th is over
    const openedAt15 = { date: "2026-11-27", updated_at: "2026-11-27T22:00:00Z" }; // the store page was opened at 15:00 on the 27th
    state.facts = [...syncedThrough("2026-11-01", "2026-11-26"), openedAt15];
    expect(await lastData()).toBe("2026-11-26"); // the 27th holds only its first 15 hours: not a finished day yet

    state.facts = syncedThrough("2026-11-01", "2026-11-27"); // the daily sync rebuilt the 27th at 00:20
    expect(await lastData()).toBe("2026-11-27");
  });

  it("with no row for yesterday yet it is the day before", async () => {
    vi.setSystemTime(new Date("2026-11-28T07:20:00Z"));
    state.facts = syncedThrough("2026-11-01", "2026-11-26");
    expect(await lastData()).toBe("2026-11-26");
  });

  it("falls back to the store's yesterday when there is no data at all", async () => {
    expect(await lastData()).toBe("2026-11-26");
    state.timezone = null;
    expect(await lastData()).toBe("2026-11-26");
  });
});
