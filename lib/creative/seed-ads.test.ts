import { describe, expect, it } from "vitest";
import { SeedRepository } from "../repository/seed";
import { sumFormats, wowWindows } from "./best-creatives";
import { demoAdRows } from "./demo";
import type { CreativeQuery } from "./aggregate";

describe("demo ads for Best Creatives", () => {
  const { days, ads } = demoAdRows("client-1", "2026-10-13");

  it("are the same ads the Creative Score demo uses, with names, campaigns and a live or paused status", () => {
    expect(ads.length).toBeGreaterThan(100);
    expect(ads.some((a) => a.status === "ACTIVE")).toBe(true);
    expect(ads.some((a) => a.status === "PAUSED")).toBe(true);
    expect(ads.every((a) => /\S+ \d\d$/.test(a.name))).toBe(true);
    expect(ads.some((a) => a.isCatalog && a.campaignName === "Catalog sales (DPA)")).toBe(true);
  });

  it("a live ad spent on the last day and a paused ad did not", () => {
    const lastDay = new Set(days.filter((d) => d.date === "2026-10-13").map((d) => d.adId));
    for (const a of ads) expect(lastDay.has(a.adId)).toBe(a.status === "ACTIVE" && days.some((d) => d.adId === a.adId));
  });

  it("is deterministic", () => {
    expect(demoAdRows("client-1", "2026-10-13")).toEqual({ days, ads });
  });
});

describe("SeedRepository ad methods", () => {
  const repo = new SeedRepository();
  const query = (over: Partial<CreativeQuery> = {}): CreativeQuery => ({ from: "2026-01-01", to: "2026-12-31", windows: null, format: "all", campaign: "", catalog: "all", live: "all", sort: "spend", margin: 0.5, limit: 50, offset: 0, ...over });

  it("knows the last day with ad data and answers pages and format totals", async () => {
    const [client] = await repo.listClients();
    const last = await repo.getLastAdDate(client.id);
    expect(last).toBe(await repo.getLastDataDate(client.id));
    const page = await repo.getCreativeAds(client.id, query());
    expect(page!.rows).toHaveLength(50);
    expect(page!.total).toBeGreaterThan(50);
    const next = await repo.getCreativeAds(client.id, query({ offset: 50 }));
    expect(next!.rows[0].adId).not.toBe(page!.rows[0].adId);
    const w = wowWindows(last!, last!);
    const formats = await repo.getCreativeFormats(client.id, "2026-01-01", "2026-12-31", w);
    expect(formats).toHaveLength(4);
    expect(sumFormats(formats!).ads).toBe(page!.total);
  });

  it("includes ads launched in the last days and ads that stopped, so Trend can show New and Stopped", async () => {
    const [client] = await repo.listClients();
    const last = (await repo.getLastAdDate(client.id))!;
    const w = wowWindows(last, last)!;
    const page = await repo.getCreativeAds(client.id, query({ from: w.prev.from, to: last, windows: w, limit: 200 }));
    expect(page!.rows.some((r) => r.launched && r.launched >= w.cur.from)).toBe(true);
    expect(page!.rows.some((r) => r.cur.spend === 0 && r.prev.spend > 0)).toBe(true);
  });
});
