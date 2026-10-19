import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { syncMetaAds } = await import("./run-meta-ads");
const { isRetryableAdError } = await import("./meta-ads");

interface Rec {
  table: string;
  op: string;
  rows?: Record<string, unknown>[];
  opts?: Record<string, unknown>;
  filters: [string, string, unknown][];
}

type Row = Record<string, unknown>;
const pk = (table: string, r: Row) => (table === "meta_ads" ? `${r.client_id}|${r.ad_id}` : `${r.client_id}|${r.ad_id}|${r.date}`);

/** A small stateful stand-in for the two tables: enforces the primary key like Postgres and applies delete filters. */
function fakeAdmin(o: { missingTables?: boolean; failInsertAt?: number; rpcError?: string } = {}) {
  const log: Rec[] = [];
  const rpcs: { fn: string; args: Row }[] = [];
  const tables: Record<string, Map<string, Row>> = { meta_ads: new Map(), meta_ad_daily: new Map() };
  let inserts = 0;
  const from = (table: string) => {
    const rec: Rec = { table, op: "", filters: [] };
    const b: Record<string, unknown> = {
      select: () => ((rec.op = "select"), b),
      limit: () => b,
      delete: () => ((rec.op = "delete"), b),
      eq: (c: string, v: unknown) => (rec.filters.push(["eq", c, v]), b),
      gte: (c: string, v: unknown) => (rec.filters.push(["gte", c, v]), b),
      lte: (c: string, v: unknown) => (rec.filters.push(["lte", c, v]), b),
      insert: (rows: Row[]) => {
        rec.op = "insert";
        rec.rows = rows;
        log.push(rec);
        inserts += 1;
        if (o.failInsertAt === inserts) return Promise.resolve({ error: { message: "connection reset" } });
        for (const r of rows) {
          const k = pk(table, r);
          if (tables[table].has(k)) return Promise.resolve({ error: { message: `duplicate key value violates unique constraint (${k})` } });
          tables[table].set(k, r);
        }
        return Promise.resolve({ error: null });
      },
      upsert: (rows: Row[], opts: Rec["opts"]) => {
        rec.op = "upsert";
        rec.rows = rows;
        rec.opts = opts;
        log.push(rec);
        for (const r of rows) {
          const k = pk(table, r);
          if (opts?.ignoreDuplicates && tables[table].has(k)) continue;
          tables[table].set(k, r);
        }
        return Promise.resolve({ error: null });
      },
      then: (resolve: (v: unknown) => unknown) => {
        if (rec.op === "select") return Promise.resolve({ data: [], error: o.missingTables ? { message: 'relation "meta_ads" does not exist' } : null }).then(resolve);
        if (rec.op === "delete") {
          for (const [k, r] of tables[table]) {
            const ok = rec.filters.every(([kind, col, v]) => (kind === "eq" ? r[col] === v : kind === "gte" ? String(r[col]) >= String(v) : String(r[col]) <= String(v)));
            if (ok) tables[table].delete(k);
          }
        }
        log.push(rec);
        return Promise.resolve({ error: null }).then(resolve);
      },
    };
    return b;
  };
  const rpc = (fn: string, args: Row) => {
    rpcs.push({ fn, args });
    log.push({ table: "rpc", op: fn, filters: [] });
    return Promise.resolve({ error: o.rpcError ? { message: o.rpcError } : null });
  };
  return { admin: { from, rpc } as never, log, rpcs, tables };
}

const integration = { client_id: "c1", account_id: "act_1" };
const dayRow = (id: string, date: string, spend = "10") => ({ ad_id: id, ad_name: `Ad ${id}`, campaign_id: "k1", campaign_name: "Prospecting", date_start: date, spend, impressions: "100", clicks: "2" });
const adRow = (id: string) => ({ id, name: `Ad ${id}`, campaign: { id: "k1", name: "Prospecting" }, effective_status: "ACTIVE", created_time: "2026-08-01T00:00:00+0000", creative: { video_id: "v" } });

/** The fetch dep the way the real one behaves: rows arrive page by page through onPage. */
const paged = (days: Row[], pageSize = 500) => async (_a: string, _s: string, _u: string, _w: string[], _g: unknown, opts?: { onPage?: (rows: Row[]) => void }) => {
  for (let i = 0; i < days.length; i += pageSize) opts?.onPage?.(days.slice(i, i + pageSize));
  return [];
};
const adsFor = async (_a: string, ids: string[]) => ids.map(adRow);
const run = (admin: never, deps: Record<string, unknown>, opts: { deadline?: number } = {}, account = integration) =>
  syncMetaAds(admin, account, "2026-09-01", "2026-09-07", ["7d_click"], "catalog, dpa", { deps: deps as never, ...opts });

describe("syncMetaAds", () => {
  it("clears the window, inserts the ad-days in batches of 500, then upserts the ads", async () => {
    const { admin, log, tables } = fakeAdmin();
    const days = Array.from({ length: 1200 }, (_, i) => dayRow(`a${i}`, `2026-09-0${(i % 7) + 1}`));
    const r = await run(admin, { fetchAdDays: paged(days, 400), fetchAds: adsFor });
    const ops = log.filter((l) => l.table !== "rpc").map((l) => `${l.table}:${l.op}`);
    expect(ops[0]).toBe("meta_ad_daily:delete");
    expect(log.find((l) => l.op === "delete")!.filters).toEqual([["eq", "client_id", "c1"], ["eq", "account_id", "act_1"], ["gte", "date", "2026-09-01"], ["lte", "date", "2026-09-07"]]);
    expect(log.filter((l) => l.table === "meta_ad_daily" && l.op === "insert").map((l) => l.rows!.length)).toEqual([500, 500, 200]);
    expect(ops.at(-1)).toBe("meta_ads:upsert");
    expect(r).toMatchObject({ ads: 1200, days: 1200 });
    expect(tables.meta_ad_daily.size).toBe(1200);
  });

  it("maps each page as it arrives and writes the account on every row", async () => {
    const { admin, tables } = fakeAdmin();
    await run(admin, { fetchAdDays: paged([dayRow("a1", "2026-09-01"), dayRow("gone", "2026-09-01")], 1), fetchAds: async () => [adRow("a1")] });
    expect([...tables.meta_ad_daily.values()].every((r) => r.account_id === "act_1")).toBe(true);
    expect([...tables.meta_ads.values()].map((r) => r.account_id)).toEqual(["act_1", "act_1"]);
  });

  it("leaves the same rows when the same window is synced twice (no duplicates)", async () => {
    const days = [dayRow("a1", "2026-09-01"), dayRow("a2", "2026-09-02")];
    const deps = { fetchAdDays: paged(days), fetchAds: adsFor };
    const { admin, tables } = fakeAdmin();
    await run(admin, deps);
    const first = JSON.stringify([...tables.meta_ad_daily.values()]);
    await run(admin, deps);
    expect(JSON.stringify([...tables.meta_ad_daily.values()])).toBe(first);
    expect(tables.meta_ad_daily.size).toBe(2);
    expect(tables.meta_ads.size).toBe(2);
  });

  it("removes a day that has lost its spend when the window is synced again", async () => {
    const { admin, tables } = fakeAdmin();
    await run(admin, { fetchAdDays: paged([dayRow("a1", "2026-09-01"), dayRow("a1", "2026-09-02")]), fetchAds: adsFor });
    expect(tables.meta_ad_daily.size).toBe(2);
    await run(admin, { fetchAdDays: paged([dayRow("a1", "2026-09-01")]), fetchAds: adsFor });
    expect([...tables.meta_ad_daily.values()].map((r) => r.date)).toEqual(["2026-09-01"]);
  });

  it("does not wipe another Meta account of the same client", async () => {
    const { admin, tables } = fakeAdmin();
    await run(admin, { fetchAdDays: paged([dayRow("other", "2026-09-02")]), fetchAds: adsFor }, {}, { client_id: "c1", account_id: "act_2" });
    await run(admin, { fetchAdDays: paged([dayRow("mine", "2026-09-01")]), fetchAds: adsFor });
    expect([...tables.meta_ad_daily.values()].map((r) => `${r.account_id}:${r.ad_id}`).sort()).toEqual(["act_1:mine", "act_2:other"]);
  });

  it("does not write days with no spend", async () => {
    const { admin, log } = fakeAdmin();
    const r = await run(admin, { fetchAdDays: paged([dayRow("a1", "2026-09-01", "0"), dayRow("a2", "2026-09-01", "5")]), fetchAds: adsFor });
    expect(log.find((l) => l.op === "insert")!.rows).toHaveLength(1);
    expect(r.days).toBe(1);
  });

  it("stores an ad Meta no longer returns as format other, without overwriting what is already saved", async () => {
    const { admin, log } = fakeAdmin();
    await run(admin, { fetchAdDays: paged([dayRow("a1", "2026-09-01"), dayRow("gone", "2026-09-01")]), fetchAds: async () => [adRow("a1")] });
    const ups = log.filter((l) => l.table === "meta_ads" && l.op === "upsert");
    const full = ups.find((u) => !u.opts?.ignoreDuplicates)!;
    const minimal = ups.find((u) => u.opts?.ignoreDuplicates)!;
    expect(full.rows!.map((r) => r.ad_id)).toEqual(["a1"]);
    expect(full.rows![0]).toMatchObject({ format: "video", is_catalog: false });
    expect(minimal.rows![0]).toMatchObject({ ad_id: "gone", name: "Ad gone", format: "other", campaign_name: "Prospecting", account_id: "act_1" });
  });

  it("still writes the ad-days when the ad details cannot be read, and says so", async () => {
    const { admin, log } = fakeAdmin();
    const r = await run(admin, { fetchAdDays: paged([dayRow("a1", "2026-09-01")]), fetchAds: async () => { throw new Error("Meta: (#10) permission"); } });
    expect(log.some((l) => l.table === "meta_ad_daily" && l.op === "insert")).toBe(true);
    expect(r.note).toMatch(/ad details/i);
    expect(log.filter((l) => l.table === "meta_ads" && l.op === "upsert").every((u) => u.opts?.ignoreDuplicates)).toBe(true);
  });

  it("rejects without deleting anything when the ad-day fetch fails", async () => {
    const { admin, log } = fakeAdmin();
    await expect(run(admin, { fetchAdDays: async () => { throw new Error("Meta: (#17) User request limit reached"); }, fetchAds: async () => [] })).rejects.toThrow("User request limit reached");
    expect(log.filter((l) => l.op === "delete" || l.op === "insert")).toEqual([]);
  });

  it("stops before calling Meta when the tables are not set up yet", async () => {
    const { admin } = fakeAdmin({ missingTables: true });
    const fetchAdDays = vi.fn(async () => []);
    await expect(run(admin, { fetchAdDays, fetchAds: async () => [] })).rejects.toThrow(/migration 0012/);
    expect(fetchAdDays).not.toHaveBeenCalled();
  });

  it("flags catalog ads by the client's keywords", async () => {
    const { admin, log } = fakeAdmin();
    await run(admin, { fetchAdDays: paged([dayRow("a1", "2026-09-01")]), fetchAds: async () => [{ ...adRow("a1"), campaign: { id: "k", name: "Spring DPA" } }] });
    expect(log.find((l) => l.table === "meta_ads" && l.op === "upsert")!.rows![0]).toMatchObject({ is_catalog: true });
  });

  it("re-flags the client's saved ads with the current keywords before it reads Meta, so a changed keyword list reaches old ads too", async () => {
    const { admin, rpcs, log } = fakeAdmin();
    await run(admin, { fetchAdDays: paged([dayRow("a1", "2026-09-01")]), fetchAds: adsFor });
    expect(rpcs).toEqual([{ fn: "refresh_meta_ad_catalog", args: { p_client: "c1", p_keywords: "catalog, dpa" } }]);
    expect(log[0]).toMatchObject({ table: "rpc", op: "refresh_meta_ad_catalog" });
  });

  it("keeps going when the re-flagging fails, and says so", async () => {
    const { admin, tables } = fakeAdmin({ rpcError: "function does not exist" });
    const r = await run(admin, { fetchAdDays: paged([dayRow("a1", "2026-09-01")]), fetchAds: adsFor });
    expect(r.note).toMatch(/catalog flags/i);
    expect(tables.meta_ad_daily.size).toBe(1);
  });
});

describe("syncMetaAds: the ad-level pull is split into 7-day windows", () => {
  const range = (admin: never, deps: Record<string, unknown>, since: string, until: string) => syncMetaAds(admin, integration, since, until, ["7d_click"], "catalog", { deps: deps as never });

  it("asks Meta for one 7-day window at a time, covering the whole range exactly once", async () => {
    const { admin } = fakeAdmin();
    const asked: [string, string][] = [];
    const fetchAdDays = async (_a: string, since: string, until: string, _w: string[], _g: unknown, opts?: { onPage?: (rows: Row[]) => void }) => {
      asked.push([since, until]);
      opts?.onPage?.([dayRow(`ad-${since}`, since)]);
      return [];
    };
    const r = await range(admin, { fetchAdDays, fetchAds: adsFor }, "2026-09-01", "2026-09-15");
    expect(asked).toEqual([["2026-09-01", "2026-09-07"], ["2026-09-08", "2026-09-14"], ["2026-09-15", "2026-09-15"]]);
    expect(r.days).toBe(3);
  });

  it("a range of seven days or less is a single call", async () => {
    const { admin } = fakeAdmin();
    const fetchAdDays = vi.fn(async () => []);
    await range(admin, { fetchAdDays, fetchAds: adsFor }, "2026-09-01", "2026-09-07");
    expect(fetchAdDays).toHaveBeenCalledTimes(1);
  });

  it("a window that fails fails the whole pull before anything is deleted, so a chunk is never half loaded", async () => {
    const { admin, log } = fakeAdmin();
    let n = 0;
    const fetchAdDays = async (_a: string, since: string, _u: string, _w: string[], _g: unknown, opts?: { onPage?: (rows: Row[]) => void }) => {
      n += 1;
      if (n === 2) throw new Error("Meta: Service temporarily unavailable");
      opts?.onPage?.([dayRow(`ad-${since}`, since)]);
      return [];
    };
    const err = await range(admin, { fetchAdDays, fetchAds: adsFor }, "2026-09-01", "2026-09-21").catch((e) => e);
    expect(isRetryableAdError(err)).toBe(true);
    expect(log.filter((l) => l.op === "delete" || l.op === "insert")).toEqual([]);
  });

  it("passes the deadline to every window", async () => {
    const { admin } = fakeAdmin();
    const deadline = Date.now() + 30_000;
    const fetchAdDays = vi.fn(async () => []);
    await syncMetaAds(admin, integration, "2026-09-01", "2026-09-15", ["7d_click"], "catalog", { deps: { fetchAdDays, fetchAds: adsFor } as never, deadline });
    for (const call of fetchAdDays.mock.calls) expect((call as unknown[])[5]).toMatchObject({ deadline });
  });
});

describe("syncMetaAds: failures that must make the runner retry", () => {
  it("treats a rate limit from Meta as retryable, so the runner retries a smaller piece instead of leaving a silent gap", async () => {
    const { admin } = fakeAdmin();
    const err = await run(admin, { fetchAdDays: async () => { throw new Error("Meta: (#17) User request limit reached"); }, fetchAds: adsFor }).catch((e) => e);
    expect(isRetryableAdError(err)).toBe(true);
  });

  it("treats 'reduce the amount of data' as retryable", async () => {
    const { admin } = fakeAdmin();
    const err = await run(admin, { fetchAdDays: async () => { throw new Error("Meta: Please reduce the amount of data you're asking for, then retry your request"); }, fetchAds: adsFor }).catch((e) => e);
    expect(isRetryableAdError(err)).toBe(true);
  });

  it("does not treat a permission error as retryable (the account may simply have no ad access)", async () => {
    const { admin } = fakeAdmin();
    const err = await run(admin, { fetchAdDays: async () => { throw new Error("Meta: (#200) Requires ads_read permission"); }, fetchAds: adsFor }).catch((e) => e);
    expect(isRetryableAdError(err)).toBe(false);
  });

  it("passes the deadline to both Graph readers", async () => {
    const { admin } = fakeAdmin();
    const fetchAdDays = vi.fn(paged([dayRow("a1", "2026-09-01")]));
    const fetchAds = vi.fn(adsFor);
    const deadline = Date.now() + 30_000;
    await run(admin, { fetchAdDays, fetchAds }, { deadline });
    expect((fetchAdDays.mock.calls[0] as unknown[])[5]).toMatchObject({ deadline });
    expect((fetchAds.mock.calls[0] as unknown[])[3]).toMatchObject({ deadline });
  });

  it("rejects with a retryable TIMEOUT when the clock runs out between insert batches, instead of finishing after the task was killed", async () => {
    const days = Array.from({ length: 1200 }, (_, i) => dayRow(`a${i}`, "2026-09-01"));
    const { admin } = fakeAdmin();
    const deadline = Date.now() + 100;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(deadline - 50);
    const err = await run(admin, { fetchAdDays: async (...a: unknown[]) => { await paged(days)(...(a as Parameters<ReturnType<typeof paged>>)); vi.setSystemTime(deadline + 1); return []; }, fetchAds: adsFor }, { deadline }).catch((e) => e);
    vi.useRealTimers();
    expect(String(err.message)).toMatch(/^TIMEOUT/);
    expect(isRetryableAdError(err)).toBe(true);
  });

  it("makes a database failure after the window was cleared retryable, so a half-written window is redone rather than left behind", async () => {
    const days = Array.from({ length: 1200 }, (_, i) => dayRow(`a${i}`, "2026-09-01"));
    const { admin, tables } = fakeAdmin({ failInsertAt: 2 });
    const err = await run(admin, { fetchAdDays: paged(days), fetchAds: adsFor }).catch((e) => e);
    expect(isRetryableAdError(err)).toBe(true);
    expect(err.message).toMatch(/connection reset/);
    expect(tables.meta_ad_daily.size).toBe(500);
  });
});
