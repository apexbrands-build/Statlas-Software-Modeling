import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ provider: "klaviyo", coverage: null as string | null, inserted: [] as { table: string; row: Record<string, unknown> }[] }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/sync/registry", () => ({ getSync: (p: string) => (p === "shopify" ? { chunkDays: 14 } : undefined) }));
vi.mock("@/lib/supabase/server", () => ({
  getAdminClient: () => ({
    from: (table: string) => {
      const b: Record<string, unknown> = {
        select: () => b,
        eq: () => b,
        in: () => b,
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
});
