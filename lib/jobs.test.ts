import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ provider: "klaviyo", coverage: null as string | null, inserted: [] as { table: string; row: Record<string, unknown> }[] }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/sync/registry", () => ({ getSync: (p: string) => (p === "shopify" ? { chunkDays: 14 } : p === "meta" ? { chunkDays: 60, adsChunkDays: 28, adsAfterCampaign: true } : undefined) }));
vi.mock("@/lib/supabase/server", () => ({
  getAdminClient: () => ({
    from: (table: string) => {
      const b: Record<string, unknown> = {
        select: () => b,
        eq: () => b,
        in: () => b,
        update: () => b,
        insert: (row: Record<string, unknown>) => {
          state.inserted.push({ table, row });
          return b;
        },
        single: async () => (table === "integrations" ? { data: { id: "i1", client_id: "c1", provider: state.provider, coverage_start: state.coverage } } : { data: { id: "job1" }, error: null }),
        limit: async () => ({ data: [] }),
      };
      return b;
    },
  }),
}));

const { createJob, NothingToSyncError } = await import("./jobs");

beforeEach(() => {
  state.inserted = [];
  state.coverage = null;
});

describe("createJob", () => {
  it("refuses a connection whose provider has nothing to sync, and queues no job", async () => {
    for (const provider of ["klaviyo", "postscript", "omnisend", "nope"]) {
      state.provider = provider;
      const err = await createJob("i1", { kind: "recent" }).catch((e) => e);
      expect(err).toBeInstanceOf(NothingToSyncError);
      expect(err.message).toBe("This connection has nothing to sync yet");
    }
    expect(state.inserted).toEqual([]);
  });

  it("still queues a job for a provider that syncs, with its own chunk size", async () => {
    state.provider = "shopify";
    await expect(createJob("i1", { kind: "recent" })).resolves.toEqual({ id: "job1", alreadyRunning: false });
    expect(state.inserted).toHaveLength(1);
    expect(state.inserted[0].row).toMatchObject({ provider: "shopify", chunk_days: 14 });
  });

  it("history resumes after the covered days, and a reload takes the whole range again", async () => {
    state.provider = "shopify";
    state.coverage = "2026-09-01";
    await createJob("i1", { kind: "history", months: 3 });
    await createJob("i1", { kind: "history", months: 3, reload: true });
    const [resume, reload] = state.inserted.map((i) => i.row);
    expect(resume.cursor_end).toBe("2026-08-31");
    expect(reload.cursor_end).toBe(reload.to_date);
    expect(reload.done_days).toBe(0);
    expect(reload.message).toBeNull();
  });

  it("a Meta history load starts campaign-level with the full chunk size; the daily sync and an explicit ad-level job do not", async () => {
    state.provider = "meta";
    await createJob("i1", { kind: "history", months: 3 });
    await createJob("i1", { kind: "recent" });
    await createJob("i1", { kind: "history", months: 3, scope: "ads" });
    const [history, recent, ads] = state.inserted.map((i) => i.row);
    expect(history).toMatchObject({ scope: "campaign", chunk_days: 60 });
    expect(recent).toMatchObject({ scope: "all", chunk_days: 60 });
    expect(ads).toMatchObject({ scope: "ads", chunk_days: 28 });
  });

  it("a provider without a separate ad-level stage keeps scope all", async () => {
    state.provider = "shopify";
    await createJob("i1", { kind: "history", months: 3 });
    expect(state.inserted[0].row).toMatchObject({ scope: "all" });
  });
});

describe("kickRunner", () => {
  it("tries the start call up to three times and stops at the first success", async () => {
    vi.useFakeTimers();
    process.env.NEXT_PUBLIC_APP_URL = "https://app.test";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "k";
    const calls = vi.fn().mockRejectedValueOnce(new Error("network")).mockResolvedValueOnce({ ok: false }).mockResolvedValueOnce({ ok: true });
    vi.stubGlobal("fetch", calls);
    const { kickRunner } = await import("./jobs");
    const p = kickRunner("job1");
    await vi.advanceTimersByTimeAsync(5000);
    await p;
    expect(calls).toHaveBeenCalledTimes(3);
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("gives up after three failed tries instead of looping", async () => {
    vi.useFakeTimers();
    process.env.NEXT_PUBLIC_APP_URL = "https://app.test";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "k";
    const calls = vi.fn().mockRejectedValue(new Error("network"));
    vi.stubGlobal("fetch", calls);
    const { kickRunner } = await import("./jobs");
    const p = kickRunner("job1");
    await vi.advanceTimersByTimeAsync(10_000);
    await p;
    expect(calls).toHaveBeenCalledTimes(3);
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
});
