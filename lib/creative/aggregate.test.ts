import { describe, expect, it } from "vitest";
import { aggregateAds, aggregateFormats, normalizeQuery, type AdDayRow, type AdInfo, type CreativeQuery } from "./aggregate";
import { wowWindows } from "./best-creatives";

const day = (adId: string, date: string, spend: number, revenue = 0, over: Partial<AdDayRow> = {}): AdDayRow => ({ adId, date, spend, impressions: spend * 100, clicks: spend, purchases: revenue > 0 ? 1 : 0, revenue, ...over });
const info = (adId: string, over: Partial<AdInfo> = {}): AdInfo => ({ adId, name: `Ad ${adId}`, campaignName: "Prospecting", format: "video", isCatalog: false, status: "ACTIVE", launched: "2026-08-01", ...over });
const query = (over: Partial<CreativeQuery> = {}): CreativeQuery => ({
  from: "2026-09-01", to: "2026-09-30", windows: null, format: "all", campaign: "", catalog: "all", live: "all", sort: "spend", margin: 0.5, limit: 50, offset: 0, ...over,
});
const ids = (rows: { adId: string }[]) => rows.map((r) => r.adId);

describe("aggregateAds: what is listed", () => {
  it("lists ads that spent in the range and totals them over it", () => {
    const page = aggregateAds([day("a", "2026-09-02", 10, 30), day("a", "2026-09-03", 20, 0), day("b", "2026-09-04", 5, 10)], [info("a"), info("b")], query());
    expect(page.total).toBe(2);
    const a = page.rows.find((r) => r.adId === "a")!;
    expect(a).toMatchObject({ spend: 30, revenue: 30, purchases: 1, firstSpend: "2026-09-02", lastSpend: "2026-09-03", activeDays: 2 });
  });

  it("does not list an ad whose spend is all outside the range", () => {
    const page = aggregateAds([day("a", "2026-08-15", 50), day("a", "2026-10-15", 50), day("b", "2026-09-05", 1)], [info("a"), info("b")], query());
    expect(ids(page.rows)).toEqual(["b"]);
  });

  it("an ad paused mid-range keeps its totals, its last spend day and the days it ran", () => {
    const days = Array.from({ length: 10 }, (_, i) => day("p", `2026-09-${String(i + 1).padStart(2, "0")}`, 10, 20));
    const [row] = aggregateAds(days, [info("p", { status: "PAUSED" })], query()).rows;
    expect(row).toMatchObject({ lastSpend: "2026-09-10", activeDays: 10, spend: 100, revenue: 200 });
  });

  it("ignores days with no spend when counting active days", () => {
    const [row] = aggregateAds([day("a", "2026-09-02", 10), day("a", "2026-09-03", 0), day("a", "2026-09-04", 10)], [info("a")], query()).rows;
    expect(row.activeDays).toBe(2);
  });

  it("an ad-day with no ad info becomes 'Other', not catalog, no status", () => {
    const [row] = aggregateAds([day("ghost", "2026-09-02", 10)], [], query()).rows;
    expect(row).toMatchObject({ adId: "ghost", name: "ghost", format: "other", isCatalog: false, status: null, campaignName: null, launched: null });
  });
});

describe("aggregateAds: filters", () => {
  const days = [day("v", "2026-09-02", 10), day("i", "2026-09-02", 20), day("c", "2026-09-02", 30), day("p", "2026-09-02", 40), day("n", "2026-09-02", 50)];
  const infos = [
    info("v", { format: "video" }),
    info("i", { format: "image", campaignName: "SPRING-DPA" }),
    info("c", { isCatalog: true, campaignName: "Catalog sales" }),
    info("p", { status: "PAUSED" }),
    info("n", { status: null }),
  ];
  it("keeps one format", () => expect(ids(aggregateAds(days, infos, query({ format: "image" })).rows)).toEqual(["i"]));
  it("excludes or keeps only catalog ads", () => {
    expect(ids(aggregateAds(days, infos, query({ catalog: "exclude" })).rows)).not.toContain("c");
    expect(ids(aggregateAds(days, infos, query({ catalog: "only" })).rows)).toEqual(["c"]);
  });
  it("live keeps ACTIVE ads; not live keeps paused ads and ads with no status", () => {
    expect(ids(aggregateAds(days, infos, query({ live: "live" })).rows).sort()).toEqual(["c", "i", "v"]);
    expect(ids(aggregateAds(days, infos, query({ live: "not_live" })).rows).sort()).toEqual(["n", "p"]);
  });
  it("matches the campaign name by 'contains', any case", () => {
    expect(ids(aggregateAds(days, infos, query({ campaign: "spring" })).rows)).toEqual(["i"]);
    expect(aggregateAds(days, infos, query({ campaign: "nothing like this" })).total).toBe(0);
  });
});

describe("aggregateAds: paging and order", () => {
  const N = 2500;
  const id = (i: number) => `ad${String(i).padStart(4, "0")}`;
  const days = Array.from({ length: N }, (_, i) => day(id(i), "2026-09-10", 1 + (i % 50), i)).reverse();
  const infos = Array.from({ length: N }, (_, i) => info(id(i)));

  it("pages of 50 return every ad exactly once, in a stable order, with the same total each time", () => {
    const seen: string[] = [];
    for (let offset = 0; offset < N; offset += 50) {
      const page = aggregateAds(days, infos, query({ limit: 50, offset }));
      expect(page.total).toBe(N);
      expect(page.rows).toHaveLength(50);
      seen.push(...ids(page.rows));
    }
    expect(new Set(seen).size).toBe(N);
    const expected = Array.from({ length: N }, (_, i) => i).sort((a, b) => (1 + (b % 50)) - (1 + (a % 50)) || a - b).map(id);
    expect(seen).toEqual(expected);
    expect(aggregateAds(days, infos, query({ offset: N })).rows).toEqual([]);
  });

  it("ads with equal spend come out in ad id order whatever order the rows arrive in", () => {
    const ds = [day("b", "2026-09-02", 10), day("a", "2026-09-02", 10), day("c", "2026-09-02", 10)];
    expect(ids(aggregateAds(ds, [], query()).rows)).toEqual(["a", "b", "c"]);
    expect(ids(aggregateAds([...ds].reverse(), [], query()).rows)).toEqual(["a", "b", "c"]);
  });

  it("sorts by ROAS with a zero-revenue ad last, by purchases, by estimated CM and by the gain in spend", () => {
    const ds = [day("hi", "2026-09-10", 100, 300), day("mid", "2026-09-10", 100, 100), day("zero", "2026-09-10", 100, 0)];
    expect(ids(aggregateAds(ds, [], query({ sort: "roas" })).rows)).toEqual(["hi", "mid", "zero"]);
    expect(ids(aggregateAds(ds, [], query({ sort: "estCm" })).rows)).toEqual(["hi", "mid", "zero"]);
    expect(ids(aggregateAds(ds, [], query({ sort: "purchases" })).rows)).toEqual(["hi", "mid", "zero"]);

    const w = wowWindows("2026-09-30", "2026-09-30")!;
    const gain = [day("up", "2026-09-28", 300), day("up", "2026-09-20", 100), day("down", "2026-09-28", 50), day("down", "2026-09-20", 200)];
    expect(ids(aggregateAds(gain, [], query({ sort: "gain", windows: w })).rows)).toEqual(["up", "down"]);
  });
});

describe("aggregateAds: the two 7-day windows", () => {
  it("sum the window days even when they fall before the range starts", () => {
    const w = wowWindows("2026-09-12", "2026-09-12")!; // cur 09-06..09-12, prev 08-30..09-05
    const ds = [day("a", "2026-09-02", 40, 80), day("a", "2026-09-08", 10, 20), day("a", "2026-09-11", 30, 90)];
    const [row] = aggregateAds(ds, [], query({ from: "2026-09-10", to: "2026-09-12", windows: w })).rows;
    expect(row.spend).toBe(30);
    expect(row.cur).toEqual({ spend: 40, revenue: 110 });
    expect(row.prev).toEqual({ spend: 40, revenue: 80 });
  });
  it("are zero without windows", () => {
    const [row] = aggregateAds([day("a", "2026-09-11", 30)], [], query()).rows;
    expect(row.cur).toEqual({ spend: 0, revenue: 0 });
    expect(row.prev).toEqual({ spend: 0, revenue: 0 });
  });
});

describe("aggregateFormats", () => {
  it("sums per format over the range, ignoring the query filters, and files orphan ad-days under other", () => {
    const ds = [day("v", "2026-09-02", 10, 30), day("i", "2026-09-02", 20, 10), day("i", "2026-09-03", 5), day("x", "2026-09-02", 7), day("v", "2026-10-02", 99)];
    const infos = [info("v", { format: "video" }), info("i", { format: "image", isCatalog: true })];
    const rows = aggregateFormats(ds, infos, "2026-09-01", "2026-09-30", null);
    const by = Object.fromEntries(rows.map((r) => [r.format, r]));
    expect(by.video).toMatchObject({ ads: 1, spend: 10, revenue: 30, purchases: 1 });
    expect(by.image).toMatchObject({ ads: 1, spend: 25, revenue: 10 });
    expect(by.other).toMatchObject({ ads: 1, spend: 7 });
    expect(by.carousel).toMatchObject({ ads: 0, spend: 0 });
  });
  it("adds the windows' spend and revenue per format", () => {
    const w = wowWindows("2026-09-30", "2026-09-30")!;
    const rows = aggregateFormats([day("v", "2026-09-28", 10, 30), day("v", "2026-09-20", 4, 8)], [info("v")], "2026-09-01", "2026-09-30", w);
    const video = rows.find((r) => r.format === "video")!;
    expect(video.cur).toEqual({ spend: 10, revenue: 30 });
    expect(video.prev).toEqual({ spend: 4, revenue: 8 });
  });
});

describe("normalizeQuery", () => {
  it("clamps the page size to 1-200, keeps the offset a whole number of at least 0, and trims the campaign", () => {
    expect(normalizeQuery(query({ limit: 5000 })).limit).toBe(200);
    expect(normalizeQuery(query({ limit: 0 })).limit).toBe(1);
    expect(normalizeQuery(query({ offset: -3 })).offset).toBe(0);
    expect(normalizeQuery(query({ offset: 7.9 })).offset).toBe(7);
    expect(normalizeQuery(query({ campaign: "  spring " })).campaign).toBe("spring");
  });
  it("falls back from estimated CM to spend when there is no margin", () => {
    expect(normalizeQuery(query({ sort: "estCm", margin: null })).sort).toBe("spend");
    expect(normalizeQuery(query({ sort: "estCm", margin: 0.4 })).sort).toBe("estCm");
  });
});
