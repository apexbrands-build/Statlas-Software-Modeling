import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { syncMetaAds } = await import("./run-meta-ads");

interface Rec {
  table: string;
  op: string;
  rows?: Record<string, unknown>[];
  opts?: Record<string, unknown>;
  filters: [string, string, unknown][];
}

function fakeAdmin(o: { missingTables?: boolean } = {}) {
  const log: Rec[] = [];
  const from = (table: string) => {
    const rec: Rec = { table, op: "", filters: [] };
    const b: Record<string, unknown> = {
      select: () => ((rec.op = "select"), b),
      limit: () => b,
      delete: () => ((rec.op = "delete"), b),
      eq: (c: string, v: unknown) => (rec.filters.push(["eq", c, v]), b),
      gte: (c: string, v: unknown) => (rec.filters.push(["gte", c, v]), b),
      lte: (c: string, v: unknown) => (rec.filters.push(["lte", c, v]), b),
      insert: (rows: Rec["rows"]) => ((rec.op = "insert"), (rec.rows = rows), log.push(rec), Promise.resolve({ error: null })),
      upsert: (rows: Rec["rows"], opts: Rec["opts"]) => ((rec.op = "upsert"), (rec.rows = rows), (rec.opts = opts), log.push(rec), Promise.resolve({ error: null })),
      then: (resolve: (v: unknown) => unknown) => {
        if (rec.op === "select") return Promise.resolve({ data: [], error: o.missingTables ? { message: 'relation "meta_ads" does not exist' } : null }).then(resolve);
        log.push(rec);
        return Promise.resolve({ error: null }).then(resolve);
      },
    };
    return b;
  };
  return { admin: { from } as never, log };
}

const integration = { client_id: "c1", account_id: "act_1" };
const dayRow = (id: string, date: string, spend = "10") => ({ ad_id: id, ad_name: `Ad ${id}`, campaign_id: "k1", campaign_name: "Prospecting", date_start: date, spend, impressions: "100", clicks: "2" });
const adRow = (id: string) => ({ id, name: `Ad ${id}`, campaign: { id: "k1", name: "Prospecting" }, effective_status: "ACTIVE", created_time: "2026-08-01T00:00:00+0000", creative: { video_id: "v" } });
const run = (admin: never, deps: Record<string, unknown>) => syncMetaAds(admin, integration, "2026-09-01", "2026-09-07", ["7d_click"], "catalog, dpa", deps as never);

describe("syncMetaAds", () => {
  it("clears the window, inserts the ad-days in batches of 500, then upserts the ads", async () => {
    const days = Array.from({ length: 1200 }, (_, i) => dayRow(`a${i % 40}`, `2026-09-0${(i % 7) + 1}`));
    const { admin, log } = fakeAdmin();
    const r = await run(admin, { fetchAdDays: async () => days, fetchAds: async (_a: string, ids: string[]) => ids.map(adRow) });
    const ops = log.map((l) => `${l.table}:${l.op}`);
    expect(ops[0]).toBe("meta_ad_daily:delete");
    expect(log[0].filters).toEqual([["eq", "client_id", "c1"], ["gte", "date", "2026-09-01"], ["lte", "date", "2026-09-07"]]);
    expect(log.filter((l) => l.table === "meta_ad_daily" && l.op === "insert").map((l) => l.rows!.length)).toEqual([500, 500, 200]);
    expect(ops.at(-1)).toBe("meta_ads:upsert");
    expect(r).toMatchObject({ ads: 40, days: 1200 });
  });

  it("leaves the same rows when the same window is synced twice", async () => {
    const days = [dayRow("a1", "2026-09-01"), dayRow("a2", "2026-09-02")];
    const deps = { fetchAdDays: async () => days, fetchAds: async (_a: string, ids: string[]) => ids.map(adRow) };
    const one = fakeAdmin();
    const two = fakeAdmin();
    await run(one.admin, deps);
    await run(two.admin, deps);
    await run(two.admin, deps);
    const inserted = (l: Rec[]) => l.filter((x) => x.op === "insert").flatMap((x) => x.rows);
    expect(inserted(two.log).slice(0, 2)).toEqual(inserted(one.log));
    expect(inserted(two.log).slice(2)).toEqual(inserted(one.log));
    expect(two.log.filter((l) => l.op === "delete")).toHaveLength(2);
  });

  it("does not write days with no spend", async () => {
    const { admin, log } = fakeAdmin();
    const r = await run(admin, { fetchAdDays: async () => [dayRow("a1", "2026-09-01", "0"), dayRow("a2", "2026-09-01", "5")], fetchAds: async (_a: string, ids: string[]) => ids.map(adRow) });
    expect(log.find((l) => l.op === "insert")!.rows).toHaveLength(1);
    expect(r.days).toBe(1);
  });

  it("stores an ad Meta no longer returns as format other, without overwriting what is already saved", async () => {
    const { admin, log } = fakeAdmin();
    await run(admin, { fetchAdDays: async () => [dayRow("a1", "2026-09-01"), dayRow("gone", "2026-09-01")], fetchAds: async () => [adRow("a1")] });
    const ups = log.filter((l) => l.table === "meta_ads" && l.op === "upsert");
    const full = ups.find((u) => !u.opts?.ignoreDuplicates)!;
    const minimal = ups.find((u) => u.opts?.ignoreDuplicates)!;
    expect(full.rows!.map((r) => r.ad_id)).toEqual(["a1"]);
    expect(full.rows![0]).toMatchObject({ format: "video", is_catalog: false });
    expect(minimal.rows![0]).toMatchObject({ ad_id: "gone", name: "Ad gone", format: "other", campaign_name: "Prospecting" });
  });

  it("still writes the ad-days when the ad details cannot be read, and says so", async () => {
    const { admin, log } = fakeAdmin();
    const r = await run(admin, { fetchAdDays: async () => [dayRow("a1", "2026-09-01")], fetchAds: async () => { throw new Error("Meta: (#10) permission"); } });
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
    await run(admin, { fetchAdDays: async () => [dayRow("a1", "2026-09-01")], fetchAds: async () => [{ ...adRow("a1"), campaign: { id: "k", name: "Spring DPA" } }] });
    expect(log.find((l) => l.table === "meta_ads" && l.op === "upsert")!.rows![0]).toMatchObject({ is_catalog: true });
  });
});
