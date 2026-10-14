import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { fetchAdDays, fetchAds } = await import("./meta");

type Page = { data: unknown[]; paging?: { next?: string } };
const pages = (list: Page[]) => {
  const calls: { path: string; params?: Record<string, string> }[] = [];
  let i = 0;
  const graph = async (path: string, params?: Record<string, string>) => {
    calls.push({ path, params });
    const p = list[i++];
    if (!p) throw new Error("no more pages");
    return p;
  };
  return { graph: graph as never, calls };
};

describe("fetchAdDays", () => {
  it("asks for ad-level daily insights and follows every page in order", async () => {
    const { graph, calls } = pages([
      { data: [{ ad_id: "a1", date_start: "2026-09-01" }], paging: { next: "https://graph.test/page2" } },
      { data: [{ ad_id: "a2", date_start: "2026-09-01" }], paging: { next: "https://graph.test/page3" } },
      { data: [{ ad_id: "a3", date_start: "2026-09-02" }] },
    ]);
    const rows = await fetchAdDays("act_123", "2026-09-01", "2026-09-07", ["7d_click"], graph);
    expect(rows.map((r) => r.ad_id)).toEqual(["a1", "a2", "a3"]);
    expect(calls.map((c) => c.path)).toEqual(["act_123/insights", "https://graph.test/page2", "https://graph.test/page3"]);
    expect(calls[0].params).toMatchObject({ level: "ad", time_increment: "1", limit: "500", action_attribution_windows: JSON.stringify(["7d_click"]) });
    expect(JSON.parse(calls[0].params!.time_range)).toEqual({ since: "2026-09-01", until: "2026-09-07" });
    expect(calls[0].params!.fields).toContain("ad_id");
    expect(calls[0].params!.fields).toContain("impressions");
  });

  it("returns nothing for an account with no ads in the window", async () => {
    const { graph } = pages([{ data: [] }]);
    expect(await fetchAdDays("act_123", "2026-09-01", "2026-09-07", ["7d_click"], graph)).toEqual([]);
  });

  it("rejects with the Graph message when a later page fails, so the caller can decide what to do", async () => {
    let n = 0;
    const graph = (async () => {
      n += 1;
      if (n === 2) throw new Error("Meta: (#17) User request limit reached");
      return { data: [{ ad_id: "a1", date_start: "2026-09-01" }], paging: { next: "https://graph.test/p2" } };
    }) as never;
    await expect(fetchAdDays("act_123", "2026-09-01", "2026-09-07", ["7d_click"], graph)).rejects.toThrow("User request limit reached");
  });
});

describe("fetchAds", () => {
  const ids = (n: number) => Array.from({ length: n }, (_, i) => `ad${i}`);

  it("looks ads up 50 ids at a time and merges the answers", async () => {
    const { graph, calls } = pages([
      { data: ids(50).map((id) => ({ id })) },
      { data: ids(50).map((id) => ({ id: `b${id}` })) },
      { data: ids(20).map((id) => ({ id: `c${id}` })) },
    ]);
    const ads = await fetchAds("act_123", ids(120), graph);
    expect(calls).toHaveLength(3);
    const sent = calls.map((c) => (JSON.parse(c.params!.filtering) as { value: string[] }[])[0].value.length);
    expect(sent).toEqual([50, 50, 20]);
    expect(ads).toHaveLength(120);
    expect(calls[0].params!.fields).toContain("creative{");
    expect(JSON.parse(calls[0].params!.filtering)[0]).toMatchObject({ field: "id", operator: "IN" });
  });

  it("makes no request when there are no ids", async () => {
    const { graph, calls } = pages([]);
    expect(await fetchAds("act_123", [], graph)).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it("follows paging inside a batch", async () => {
    const { graph, calls } = pages([{ data: [{ id: "a" }], paging: { next: "https://graph.test/next" } }, { data: [{ id: "b" }] }]);
    expect((await fetchAds("act_123", ["a", "b"], graph)).map((a) => a.id)).toEqual(["a", "b"]);
    expect(calls[1].path).toBe("https://graph.test/next");
  });
});
