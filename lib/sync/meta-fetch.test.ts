import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { fetchAdDays, fetchAds, fetchActiveAds } = await import("./meta");

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
    expect(calls[0].params).toMatchObject({ level: "ad", time_increment: "1", limit: "100", action_attribution_windows: JSON.stringify(["7d_click"]) });
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

describe("fetchAdDays: pages, memory and the clock", () => {
  it("hands each page to onPage and keeps nothing itself, so a big account is never held in memory twice", async () => {
    const { graph } = pages([
      { data: [{ ad_id: "a1", date_start: "2026-09-01" }], paging: { next: "https://graph.test/p2" } },
      { data: [{ ad_id: "a2", date_start: "2026-09-01" }] },
    ]);
    const seen: string[][] = [];
    const rows = await fetchAdDays("act_1", "2026-09-01", "2026-09-07", ["7d_click"], graph, { onPage: (r) => seen.push(r.map((x) => x.ad_id)) });
    expect(seen).toEqual([["a1"], ["a2"]]);
    expect(rows).toEqual([]);
  });

  it("stops with a TIMEOUT before asking for another page once the deadline has passed", async () => {
    const { graph, calls } = pages([{ data: [{ ad_id: "a1", date_start: "2026-09-01" }], paging: { next: "https://graph.test/p2" } }, { data: [] }]);
    await expect(fetchAdDays("act_1", "2026-09-01", "2026-09-07", ["7d_click"], graph, { deadline: Date.now() - 1 })).rejects.toThrow(/^TIMEOUT/);
    expect(calls).toHaveLength(0);
  });

  it("stops between pages when the deadline passes while reading", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const deadline = Date.now() + 1000;
    let n = 0;
    const graph = (async () => {
      n += 1;
      vi.setSystemTime(deadline + 1);
      return { data: [{ ad_id: "a1", date_start: "2026-09-01" }], paging: { next: "https://graph.test/p2" } };
    }) as never;
    await expect(fetchAdDays("act_1", "2026-09-01", "2026-09-07", ["7d_click"], graph, { deadline })).rejects.toThrow(/^TIMEOUT/);
    vi.useRealTimers();
    expect(n).toBe(1);
  });
});

describe("fetchAdDays and fetchAds: transient Meta errors", () => {
  const noWait = async () => undefined;
  const flaky = (failures: string[], then: unknown) => {
    let n = 0;
    const graph = (async () => {
      if (n < failures.length) throw new Error(failures[n++]);
      return then;
    }) as never;
    return { graph, calls: () => n };
  };

  it("retries 'Service temporarily unavailable' and 'An unknown error occurred' and succeeds once Meta answers", async () => {
    const { graph, calls } = flaky(["Meta: Service temporarily unavailable", "Meta: An unknown error occurred"], { data: [{ ad_id: "a1", date_start: "2026-09-01" }] });
    const rows = await fetchAdDays("act_1", "2026-09-01", "2026-09-07", ["7d_click"], graph, { sleep: noWait });
    expect(rows.map((r) => r.ad_id)).toEqual(["a1"]);
    expect(calls()).toBe(2);
  });

  it("gives up after three attempts and rejects with Meta's message", async () => {
    let n = 0;
    const graph = (async () => {
      n += 1;
      throw new Error("Meta: Service temporarily unavailable");
    }) as never;
    await expect(fetchAdDays("act_1", "2026-09-01", "2026-09-07", ["7d_click"], graph, { sleep: noWait })).rejects.toThrow("Service temporarily unavailable");
    expect(n).toBe(3);
  });

  it("does not retry an error that retrying cannot fix, such as a missing permission", async () => {
    let n = 0;
    const graph = (async () => {
      n += 1;
      throw new Error("Meta: (#200) Requires ads_read permission");
    }) as never;
    await expect(fetchAdDays("act_1", "2026-09-01", "2026-09-07", ["7d_click"], graph, { sleep: noWait })).rejects.toThrow("permission");
    expect(n).toBe(1);
  });

  it("waits a little longer before each retry", async () => {
    const waits: number[] = [];
    const graph = (async () => {
      throw new Error("Meta: An unknown error occurred");
    }) as never;
    await fetchAdDays("act_1", "2026-09-01", "2026-09-07", ["7d_click"], graph, { sleep: async (ms) => void waits.push(ms) }).catch(() => undefined);
    expect(waits).toHaveLength(2);
    expect(waits[1]).toBeGreaterThan(waits[0]);
  });

  it("does not wait for a retry that would run past the deadline", async () => {
    const graph = (async () => {
      throw new Error("Meta: Service temporarily unavailable");
    }) as never;
    await expect(fetchAdDays("act_1", "2026-09-01", "2026-09-07", ["7d_click"], graph, { sleep: noWait, deadline: Date.now() + 5 })).rejects.toThrow();
  });

  it("asks for pages of 100 rows (smaller pages are less likely to fail on a big account)", async () => {
    const { graph, calls } = pages([{ data: [] }]);
    await fetchAdDays("act_1", "2026-09-01", "2026-09-07", ["7d_click"], graph);
    expect(calls[0].params!.limit).toBe("100");
  });

  it("fetchAds retries a transient error too", async () => {
    const { graph, calls } = flaky(["Meta: Service temporarily unavailable"], { data: [{ id: "a1" }] });
    expect((await fetchAds("act_1", ["a1"], graph, { sleep: noWait })).map((a) => a.id)).toEqual(["a1"]);
    expect(calls()).toBe(1);
  });
});

describe("fetchAds: deleted and archived ads, and the clock", () => {
  it("asks for every effective status, including archived and deleted ads, so old ads still get their launch date and format", async () => {
    const { graph, calls } = pages([{ data: [] }]);
    await fetchAds("act_1", ["a1"], graph);
    const filtering = JSON.parse(calls[0].params!.filtering) as { field: string; operator: string; value: string[] }[];
    const status = filtering.find((f) => f.field === "effective_status")!;
    expect(status.operator).toBe("IN");
    expect(status.value).toEqual(expect.arrayContaining(["ACTIVE", "PAUSED", "ARCHIVED", "DELETED"]));
    expect(filtering.find((f) => f.field === "id")!.value).toEqual(["a1"]);
  });

  it("stops with a TIMEOUT before the next batch once the deadline has passed", async () => {
    const { graph, calls } = pages([{ data: [] }]);
    await expect(fetchAds("act_1", ["a1"], graph, { deadline: Date.now() - 1 })).rejects.toThrow(/^TIMEOUT/);
    expect(calls).toHaveLength(0);
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

describe("fetchActiveAds", () => {
  it("asks the account for its ads that are active right now, details included, and follows every page", async () => {
    const { graph, calls } = pages([
      { data: [{ id: "a1" }], paging: { next: "https://graph.test/p2" } },
      { data: [{ id: "a2" }] },
    ]);
    const ads = await fetchActiveAds("act_9", graph);
    expect(ads.map((a) => a.id)).toEqual(["a1", "a2"]);
    expect(calls.map((c) => c.path)).toEqual(["act_9/ads", "https://graph.test/p2"]);
    expect(JSON.parse(calls[0].params!.filtering)).toEqual([{ field: "effective_status", operator: "IN", value: ["ACTIVE"] }]);
    expect(calls[0].params).toMatchObject({ limit: "100" });
    expect(calls[0].params!.fields).toContain("effective_status");
    expect(calls[0].params!.fields).toContain("created_time");
  });
  it("is empty for an account with nothing running", async () => {
    expect(await fetchActiveAds("act_9", pages([{ data: [] }]).graph)).toEqual([]);
  });
  it("retries a transient Meta error and stops at the deadline", async () => {
    let n = 0;
    const flaky = (async () => {
      if (n++ === 0) throw new Error("Meta: An unknown error occurred");
      return { data: [{ id: "a1" }] };
    }) as never;
    expect((await fetchActiveAds("act_9", flaky, { sleep: async () => {} })).map((a) => a.id)).toEqual(["a1"]);
    await expect(fetchActiveAds("act_9", pages([{ data: [{ id: "a1" }], paging: { next: "https://graph.test/p2" } }]).graph, { deadline: Date.now() - 1 })).rejects.toThrow(/^TIMEOUT/);
  });
});
