import { afterEach, describe, expect, it, vi } from "vitest";
import { dailySyncDue, localDayStart, type RecentJob } from "./sync-schedule";
import { planTodayPulls, pullSummary, runPulls, SYNC_IN_FLIGHT_MS, TODAY_PULL_BUDGET_MS, TODAY_PULL_CONCURRENCY, TODAY_PULL_FETCH_MS, TODAY_PULL_OVERLAP_MS, TODAY_PULL_STORE_MS, todaySince, type PullConnection, type RecentRun } from "./today-pull";

const at = (iso: string) => new Date(iso);
const shop = (id: string, status = "connected"): PullConnection => ({ id, provider: "shopify", status });
const run = (integrationId: string, startedAt: string, status = "ok"): RecentRun => ({ integrationId, status, startedAt: at(startedAt) });

describe("planTodayPulls", () => {
  const now = at("2026-11-27T15:10:00Z");

  it("pulls every connected Shopify store, and nothing else", () => {
    const plan = planTodayPulls({
      now,
      connections: [shop("s1"), shop("s2"), { id: "m1", provider: "meta", status: "connected" }, { id: "g1", provider: "google_ads", status: "connected" }],
      busyIds: [],
      runs: [],
    });
    expect(plan).toEqual({ pull: ["s1", "s2"], busy: 0, inFlight: 0 });
  });

  it("still pulls a store whose last sync failed (a failed nightly sync must not blank the day's hours), never one that is disconnected or pending", () => {
    const plan = planTodayPulls({ now, connections: [shop("s1", "error"), shop("s2", "disconnected"), shop("s3", "pending"), shop("s4")], busyIds: [], runs: [] });
    expect(plan.pull).toEqual(["s1", "s4"]);
  });

  it("never pulls a store with a sync job queued or running: the job loads the same orders", () => {
    const plan = planTodayPulls({ now, connections: [shop("s1"), shop("s2"), shop("s3")], busyIds: ["s2", "m1"], runs: [] });
    expect(plan).toEqual({ pull: ["s1", "s3"], busy: 1, inFlight: 0 });
  });

  it("skips a store another task started syncing moments ago (the store page, or the same tick delivered twice)", () => {
    const plan = planTodayPulls({
      now,
      connections: [shop("s1"), shop("s2"), shop("s3")],
      busyIds: [],
      runs: [
        run("s1", "2026-11-27T15:09:30Z", "running"), // 30 seconds ago, not finished
        run("s2", "2026-11-27T14:10:00Z", "running"), // an hour ago: a run that never closed must not block the store for good
        run("s3", "2026-11-27T15:09:30Z", "ok"), // finished
      ],
    });
    expect(plan.pull).toEqual(["s2", "s3"]);
    expect(plan.inFlight).toBe(1);
    expect(planTodayPulls({ now, connections: [shop("s1")], busyIds: [], runs: [run("s1", new Date(now.getTime() - SYNC_IN_FLIGHT_MS - 1).toISOString(), "running")] }).pull).toEqual(["s1"]);
  });

  it("puts the store that has waited longest first, so stores a tick did not reach go first on the next one", () => {
    const plan = planTodayPulls({
      now,
      connections: [shop("a"), shop("b"), shop("c"), shop("d")],
      busyIds: [],
      runs: [run("a", "2026-11-27T14:10:05Z"), run("a", "2026-11-27T13:10:00Z"), run("b", "2026-11-27T13:10:00Z"), run("c", "2026-11-27T14:10:00Z", "error")],
    });
    // d was never reached, b was last tried two hours ago, c failed an hour ago (a failure waits its turn like any other), a is the freshest
    expect(plan.pull).toEqual(["d", "b", "c", "a"]);
  });

  it("is a plain list of ids: it creates no job, so whether the daily sync is due stays what the sync jobs say", () => {
    const tz = "America/New_York";
    const jobs: RecentJob[] = [{ createdAt: at("2026-11-27T05:20:00Z"), status: "done" }]; // today's daily sync, 00:20 local
    const before = dailySyncDue(now, tz, jobs);
    const plan = planTodayPulls({ now, connections: [shop("s1")], busyIds: [], runs: [run("s1", "2026-11-27T14:10:00Z", "error"), run("s1", "2026-11-27T13:10:00Z", "error")] });
    expect(plan.pull).toEqual(["s1"]); // two failed pulls in a row: still pulled, still no job
    expect(dailySyncDue(now, tz, jobs)).toBe(before);
    expect(before).toBe(false);
    // and the next morning the daily sync is due exactly as it would be with no pulls at all
    expect(dailySyncDue(at("2026-11-28T05:20:00Z"), tz, jobs)).toBe(true);
  });
});

describe("todaySince", () => {
  const tz = "America/Denver";
  const now = at("2026-11-27T21:10:00Z"); // 14:10 on Black Friday in Denver
  const dayStart = localDayStart(now, tz); // 07:00Z

  it("starts at the store's midnight when no order of today is loaded yet", () => {
    expect(dayStart.toISOString()).toBe("2026-11-27T07:00:00.000Z");
    expect(todaySince(now, dayStart, null)).toEqual(dayStart);
    expect(todaySince(now, dayStart, at("2026-11-27T06:59:00Z"))).toEqual(dayStart); // yesterday's last order
    expect(todaySince(now, dayStart, new Date(Number.NaN))).toEqual(dayStart);
  });

  it("carries on from the last order loaded, minus the overlap", () => {
    expect(todaySince(now, dayStart, at("2026-11-27T20:12:30Z")).toISOString()).toBe("2026-11-27T20:02:30.000Z");
    expect(TODAY_PULL_OVERLAP_MS).toBe(10 * 60_000);
  });

  it("never asks for orders from before the store's day began: yesterday is the daily sync's", () => {
    expect(todaySince(now, dayStart, at("2026-11-27T07:04:00Z"))).toEqual(dayStart); // 00:04 local, minus 10 minutes would be yesterday
  });

  it("never starts in the future, whatever date an order carries", () => {
    expect(todaySince(now, dayStart, at("2026-11-29T00:00:00Z")).toISOString()).toBe("2026-11-27T21:00:00.000Z");
  });
});

describe("runPulls", () => {
  afterEach(() => vi.useRealTimers());

  it("one store failing does not stop the others, and the call itself never rejects", async () => {
    const pulled: string[] = [];
    const results = await runPulls(["a", "b", "c", "d", "e"], {
      mayStart: () => true,
      pull: async (id) => {
        pulled.push(id);
        if (id === "b") throw new Error("Shopify 502");
        if (id === "d") return Promise.reject("not an Error object");
        return { orders: 1 };
      },
    });
    expect(pulled.sort()).toEqual(["a", "b", "c", "d", "e"]);
    expect(results.done.map((d) => d.id).sort()).toEqual(["a", "c", "e"]);
    expect(results.failed).toEqual(expect.arrayContaining([{ id: "b", error: "Shopify 502" }, { id: "d", error: "not an Error object" }]));
    expect(results.notReached).toEqual([]);
  });

  it("a pull that throws before returning a promise is a failure like any other", async () => {
    const results = await runPulls(["a", "b"], {
      mayStart: () => true,
      pull: (id) => {
        if (id === "a") throw new Error("boom");
        return Promise.resolve({ orders: 0 });
      },
    });
    expect(results.failed).toEqual([{ id: "a", error: "boom" }]);
    expect(results.done.map((d) => d.id)).toEqual(["b"]);
  });

  it("never runs more than the allowed number of stores at once", async () => {
    let inFlight = 0;
    let peak = 0;
    const ids = Array.from({ length: 30 }, (_, i) => `s${i}`);
    const results = await runPulls(ids, {
      mayStart: () => true,
      pull: async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 2));
        inFlight--;
        return { orders: 0 };
      },
    });
    expect(results.done).toHaveLength(30);
    expect(peak).toBe(TODAY_PULL_CONCURRENCY);
  });

  it("stops starting stores once the time budget is spent and reports the ones it did not reach", async () => {
    let started = 0;
    const results = await runPulls(["a", "b", "c", "d", "e", "f"], {
      concurrency: 2,
      mayStart: () => started < 3,
      pull: async () => {
        started++;
        return { orders: 0 };
      },
    });
    expect(results.done.map((d) => d.id)).toEqual(["a", "b", "c"]);
    expect(results.notReached).toEqual(["d", "e", "f"]);
    expect(results.failed).toEqual([]);
  });

  it("a store that does not answer gives its place away: the others are still pulled", async () => {
    vi.useFakeTimers();
    const pulled: string[] = [];
    const promise = runPulls(["hung", "b", "c"], {
      concurrency: 1,
      storeMs: 60_000,
      mayStart: () => true,
      pull: (id) => {
        pulled.push(id);
        return id === "hung" ? new Promise(() => {}) : Promise.resolve({ orders: 2 });
      },
    });
    await vi.advanceTimersByTimeAsync(59_000);
    expect(pulled).toEqual(["hung"]);
    await vi.advanceTimersByTimeAsync(2_000);
    const results = await promise;
    expect(pulled).toEqual(["hung", "b", "c"]);
    expect(results.failed).toEqual([{ id: "hung", error: "TIMEOUT: no answer after 60 s" }]);
    expect(results.done.map((d) => d.id)).toEqual(["b", "c"]);
  });

  it("a store that fails after its time was up is not reported twice and leaves no stray rejection", async () => {
    vi.useFakeTimers();
    const late = runPulls(["slow"], { storeMs: 1_000, mayStart: () => true, pull: () => new Promise((_, reject) => setTimeout(() => reject(new Error("late failure")), 5_000)) });
    await vi.advanceTimersByTimeAsync(6_000);
    expect(await late).toEqual({ done: [], failed: [{ id: "slow", error: "TIMEOUT: no answer after 1 s" }], notReached: [] });
  });

  it("an empty list is nothing to do", async () => {
    expect(await runPulls([], { mayStart: () => true, pull: async () => ({ orders: 0 }) })).toEqual({ done: [], failed: [], notReached: [] });
  });
});

describe("the time budget", () => {
  it("fits inside the tick's 300 seconds even when the last store started is the slowest", () => {
    // last start at the budget, then a store's own limit; the fetch limit sits inside the store's limit with room for the database writes
    expect(TODAY_PULL_BUDGET_MS + TODAY_PULL_STORE_MS).toBeLessThan(300_000);
    expect(TODAY_PULL_FETCH_MS).toBeLessThan(TODAY_PULL_STORE_MS / 2);
  });

  it("reaches more than 30 stores in one tick at an ordinary pull time, and at least a couple of dozen when every store is at its slowest", () => {
    const perTick = (secondsPerStore: number) => Math.floor((TODAY_PULL_CONCURRENCY * TODAY_PULL_BUDGET_MS) / (secondsPerStore * 1000));
    expect(perTick(5)).toBeGreaterThanOrEqual(150);
    expect(perTick((TODAY_PULL_FETCH_MS + 5_000) / 1000)).toBeGreaterThanOrEqual(24);
  });
});

describe("pullSummary", () => {
  it("says how the pulls ended in one line", () => {
    const line = pullSummary({
      done: [
        { id: "a", result: { orders: 12 } },
        { id: "b", result: { orders: 900, partial: true } },
        { id: "c", result: { orders: 0, skipped: true } },
      ],
      failed: [{ id: "d", error: "Shopify 502" }],
      notReached: ["e", "f"],
    });
    expect(line).toBe("today's orders: 2 pulled (912 orders, 1 with more to load), 1 skipped (a sync job started), 1 failed: d Shopify 502, 2 not reached");
  });
});
