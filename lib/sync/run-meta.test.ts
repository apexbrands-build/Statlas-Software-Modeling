import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ updates: [] as { table: string; values: Record<string, unknown> }[], adStep: vi.fn(), extra: { catalogKeywords: "dpa" } as Record<string, unknown> }));

vi.mock("server-only", () => ({}));
vi.mock("./meta", () => ({
  fetchCampaignDays: async () => [{ date: "2026-09-01", campaignId: "k1", campaignName: "Prospecting", spend: 10, purchases: 1, revenue: 20 }],
  isExistingSegment: () => false,
}));
vi.mock("./run-meta-ads", () => ({ syncMetaAds: state.adStep }));
vi.mock("@/lib/supabase/server", () => ({
  getAdminClient: () => ({
    from: (table: string) => {
      const row: Record<string, unknown> = {
        integrations: { id: "i1", client_id: "c1", provider: "meta", account_id: "act_1", coverage_start: null, coverage_end: null },
        sync_runs: { id: "run1" },
        client_settings: { extra: state.extra },
      };
      const chain: unknown = new Proxy(function () {}, {
        get(_t, prop: string) {
          if (prop === "then") return (resolve: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(resolve);
          if (prop === "single" || prop === "maybeSingle") return async () => ({ data: row[table] ?? null, error: null });
          if (prop === "update") return (values: Record<string, unknown>) => (state.updates.push({ table, values }), chain);
          return () => chain;
        },
      });
      return chain;
    },
  }),
}));

const { syncMeta } = await import("./run-meta");
const lastRunMessage = () => String(state.updates.filter((u) => u.table === "sync_runs").at(-1)?.values.message ?? "");

beforeEach(() => {
  state.updates = [];
  state.extra = { catalogKeywords: "dpa" };
  state.adStep.mockReset();
});

describe("syncMeta with the ad-level step", () => {
  it("keeps the campaign sync, the connection status and the run result when the ad-level step fails, and says so in the run message", async () => {
    state.adStep.mockRejectedValue(new Error("Meta: (#17) User request limit reached"));
    const r = await syncMeta("i1", { from: "2026-09-01", to: "2026-09-07" });
    expect(r.rows).toBeGreaterThan(0);
    const status = state.updates.filter((u) => u.table === "integrations").map((u) => u.values.status);
    expect(status).toEqual(["connected"]);
    const run = state.updates.filter((u) => u.table === "sync_runs").at(-1)!.values;
    expect(run.status).toBe("ok");
    expect(lastRunMessage()).toContain("Ad-level step failed: Meta: (#17) User request limit reached");
    const integration = state.updates.find((u) => u.table === "integrations")!.values;
    expect(String(integration.last_error ?? "")).not.toContain("Ad-level");
  });

  it("reports how many ads and ad-days were stored", async () => {
    state.adStep.mockResolvedValue({ ads: 3, days: 9 });
    await syncMeta("i1", { from: "2026-09-01", to: "2026-09-07" });
    expect(lastRunMessage()).toContain("Ad-level: 3 ads, 9 ad-days");
  });

  it("passes the client's catalog keywords and the attribution windows to the ad-level step", async () => {
    state.adStep.mockResolvedValue({ ads: 0, days: 0 });
    await syncMeta("i1", { from: "2026-09-01", to: "2026-09-07" });
    const args = state.adStep.mock.calls[0];
    expect(args[1]).toMatchObject({ client_id: "c1", account_id: "act_1" });
    expect(args.slice(2, 6)).toEqual(["2026-09-01", "2026-09-07", ["7d_click"], "dpa"]);
  });

  it("uses the default catalog keywords when the client has never saved any", async () => {
    state.extra = {};
    state.adStep.mockResolvedValue({ ads: 0, days: 0 });
    await syncMeta("i1", { from: "2026-09-01", to: "2026-09-07" });
    expect(state.adStep.mock.calls[0][5]).toBe("catalog, dpa, daba");
  });
});
