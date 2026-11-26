import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
interface Query {
  table: string;
  write: string | null;
  filters: [string, ...unknown[]][];
}

const state = vi.hoisted(() => ({
  integrations: [] as Row[],
  clients: [] as Row[],
  /** Daily ("recent") jobs of the last 48 hours. */
  recentJobs: [] as Row[],
  /** Jobs queued or running right now. */
  activeJobs: [] as Row[],
  runs: [] as Row[],
  activeJobsError: false,
  writes: [] as Query[],
}));

vi.mock("server-only", () => ({}));
const afterTasks: Array<() => unknown> = [];
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), after: (fn: () => unknown) => void afterTasks.push(fn) }));
const jobs = { createJob: vi.fn(), findIdleQueued: vi.fn(), kickRunner: vi.fn(), kickWaitingJobs: vi.fn(), requeueStalled: vi.fn() };
vi.mock("@/lib/jobs", () => jobs);
vi.mock("@/lib/sync/registry", () => ({ syncableProviderIds: () => ["shopify", "meta", "google_ads"] }));
const sync = { syncShopify: vi.fn() };
vi.mock("@/lib/sync/run-shopify", () => sync);
vi.mock("@/lib/supabase/server", () => ({
  getAdminClient: () => ({
    from: (table: string) => {
      const q: Query = { table, write: null, filters: [] };
      const has = (name: string, ...args: unknown[]) => q.filters.some((f) => f[0] === name && args.every((a, i) => JSON.stringify(f[i + 1]) === JSON.stringify(a)));
      const answer = () => {
        if (q.write) return { data: null, error: null };
        if (table === "integrations") return has("select", "id") ? { count: 0, data: null, error: null } : { data: state.integrations, error: null };
        if (table === "clients") return { data: state.clients, error: null };
        if (table === "sync_jobs") {
          if (has("eq", "kind", "recent")) return { data: state.recentJobs, error: null };
          if (has("in", "status", ["queued", "running"])) return state.activeJobsError ? { data: null, error: { message: "connection reset" } } : { data: state.activeJobs, error: null };
        }
        if (table === "sync_runs") return { data: state.runs, error: null };
        return { data: [], error: null };
      };
      const chain: Row = {};
      for (const write of ["insert", "update", "upsert", "delete"]) {
        chain[write] = () => {
          q.write = write;
          state.writes.push(q);
          return chain;
        };
      }
      for (const filter of ["select", "eq", "in", "gte", "lt", "order", "limit"]) {
        chain[filter] = (...args: unknown[]) => {
          q.filters.push([filter, ...args]);
          return chain;
        };
      }
      chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => Promise.resolve(answer()).then(resolve, reject);
      return chain;
    },
  }),
}));

process.env.CRON_SECRET = "cron-secret";
const { GET } = await import("@/app/api/jobs/tick/route");

const tick = (auth = "Bearer cron-secret") => GET(new Request("https://app.test/api/jobs/tick", { headers: { authorization: auth } }));
const runAfter = () => Promise.all(afterTasks.map((t) => t()));
const pulled = () => sync.syncShopify.mock.calls.map((c) => c[0] as string).sort();
const connection = (id: string, provider: string, status = "connected", client = "c-ny") => ({ id, client_id: client, provider, status });
/** Today's daily sync, done at 00:20 New York time: nothing is due. */
const doneToday = (integrationId: string) => ({ integration_id: integrationId, status: "done", created_at: "2026-11-27T05:20:00Z" });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-27T15:10:00Z")); // 10:10 on Black Friday in New York
  vi.clearAllMocks();
  afterTasks.length = 0;
  delete process.env.TODAY_ORDERS_PULL;
  state.integrations = [connection("s1", "shopify"), connection("s2", "shopify"), connection("m1", "meta"), connection("s3", "shopify", "error")];
  state.clients = [{ id: "c-ny", timezone: "America/New_York" }];
  state.recentJobs = ["s1", "s2", "m1", "s3"].map(doneToday);
  state.activeJobs = [];
  state.runs = [];
  state.activeJobsError = false;
  state.writes = [];
  jobs.requeueStalled.mockResolvedValue([]);
  jobs.findIdleQueued.mockResolvedValue([]);
  jobs.kickWaitingJobs.mockResolvedValue([]);
  jobs.kickRunner.mockResolvedValue(undefined);
  jobs.createJob.mockImplementation(async (id: string) => {
    state.activeJobs.push({ integration_id: id });
    return { id: `job-${id}`, alreadyRunning: false };
  });
  sync.syncShopify.mockResolvedValue({ orders: 3, range: { from: "2026-11-27", to: "2026-11-27" } });
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("hourly tick: today's orders", () => {
  it("refuses a call without the cron secret", async () => {
    expect((await tick("Bearer nope")).status).toBe(401);
    expect(afterTasks).toHaveLength(0);
  });

  it("answers first, then pulls today's orders for every Shopify store it keeps syncing that has no sync job", async () => {
    const res = await tick();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, started: 0, notDue: 4, todayPulls: 3 });
    expect(sync.syncShopify).not.toHaveBeenCalled(); // nothing is pulled before the answer is out

    await runAfter();
    expect(pulled()).toEqual(["s1", "s2", "s3"]); // not Meta; s3's last sync failed, its hours are still pulled
    const [, opts] = sync.syncShopify.mock.calls[0];
    expect(opts).toMatchObject({ todayPull: true });
    expect(opts.deadline).toBe(Date.now() + 25_000);
    expect(jobs.createJob).not.toHaveBeenCalled();
  });

  it("a store whose daily sync starts on this tick is left to that sync", async () => {
    state.recentJobs = ["s2", "m1", "s3"].map(doneToday); // s1 has not had today's daily sync yet
    const res = await tick();
    expect(await res.json()).toMatchObject({ started: 1, todayPulls: 2 });
    expect(jobs.createJob).toHaveBeenCalledTimes(1);
    expect(jobs.createJob).toHaveBeenCalledWith("s1", { kind: "recent" });
    await runAfter();
    expect(pulled()).toEqual(["s2", "s3"]);
  });

  it("a store with a job already queued or running (a history load, a manual sync) is not pulled", async () => {
    state.activeJobs = [{ integration_id: "s2" }];
    await tick();
    await runAfter();
    expect(pulled()).toEqual(["s1", "s3"]);
  });

  it("one store failing does not stop the others, does not fail the tick, and starts no job", async () => {
    sync.syncShopify.mockImplementation(async (id: string) => {
      if (id === "s1") throw new Error("Shopify 502");
      return { orders: 1, range: { from: "2026-11-27", to: "2026-11-27" } };
    });
    const res = await tick();
    expect(res.status).toBe(200);
    await expect(runAfter()).resolves.toBeDefined();
    expect(pulled()).toEqual(["s1", "s2", "s3"]);
    expect(jobs.createJob).not.toHaveBeenCalled();
    // the tick itself writes nothing: no job row, no change to a connection
    expect(state.writes).toEqual([]);
    expect(console.info).toHaveBeenCalledWith(expect.stringContaining("1 failed: s1 Shopify 502"));
  });

  it("failed pulls change nothing about when the daily sync is due: the next tick starts the same jobs it would have started anyway", async () => {
    sync.syncShopify.mockRejectedValue(new Error("Shopify 502"));
    await tick();
    await runAfter();
    afterTasks.length = 0;
    vi.setSystemTime(new Date("2026-11-27T16:10:00Z"));
    const res = await tick();
    expect(await res.json()).toMatchObject({ started: 0, notDue: 4, todayPulls: 3 }); // still pulled an hour later, still no daily job before the day is over
    expect(jobs.createJob).not.toHaveBeenCalled();
  });

  it("still pulls when starting the waiting jobs failed", async () => {
    jobs.kickWaitingJobs.mockRejectedValue(new Error("fetch failed"));
    await tick();
    await expect(runAfter()).rejects.toThrow("fetch failed");
    expect(pulled()).toEqual(["s1", "s2", "s3"]);
  });

  it("starts the stalled and waiting jobs before any pull", async () => {
    jobs.requeueStalled.mockResolvedValue(["job-9"]);
    const order: string[] = [];
    jobs.kickRunner.mockImplementation(async () => void order.push("kick"));
    jobs.kickWaitingJobs.mockImplementation(async () => (order.push("waiting"), []));
    sync.syncShopify.mockImplementation(async () => (order.push("pull"), { orders: 0, range: { from: "", to: "" } }));
    await tick();
    await runAfter();
    expect(order).toEqual(["kick", "waiting", "pull", "pull", "pull"]);
  });

  it("pulls nothing when it cannot tell which stores have a job: never blind next to a sync", async () => {
    state.activeJobsError = true;
    const res = await tick();
    expect(await res.json()).toMatchObject({ ok: true, todayPulls: 0 });
    await runAfter();
    expect(sync.syncShopify).not.toHaveBeenCalled();
  });

  it("skips a store another task is syncing right now", async () => {
    state.runs = [{ integration_id: "s1", status: "running", started_at: "2026-11-27T15:09:40Z" }];
    await tick();
    await runAfter();
    expect(pulled()).toEqual(["s2", "s3"]);
  });

  it("can be switched off without touching the daily syncs", async () => {
    process.env.TODAY_ORDERS_PULL = "off";
    state.recentJobs = ["s2", "m1", "s3"].map(doneToday);
    const res = await tick();
    expect(await res.json()).toMatchObject({ started: 1, todayPulls: 0 });
    await runAfter();
    expect(sync.syncShopify).not.toHaveBeenCalled();
    expect(jobs.kickWaitingJobs).toHaveBeenCalled();
  });

  it("stops starting stores when the tick's time is spent", async () => {
    state.integrations = Array.from({ length: 12 }, (_, i) => connection(`s${String(i).padStart(2, "0")}`, "shopify"));
    state.recentJobs = state.integrations.map((i) => doneToday(i.id as string));
    sync.syncShopify.mockImplementation(async () => {
      vi.setSystemTime(Date.now() + 60_000); // every store takes a minute
      return { orders: 0, range: { from: "", to: "" } };
    });
    await tick();
    await runAfter();
    // four at a time, a minute each, no new start after 200 seconds: the first four, and no more than a few after them
    expect(sync.syncShopify.mock.calls.length).toBeGreaterThanOrEqual(4);
    expect(sync.syncShopify.mock.calls.length).toBeLessThan(12);
    expect(console.info).toHaveBeenCalledWith(expect.stringContaining("not reached"));
  });
});
