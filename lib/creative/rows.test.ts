import { describe, expect, it } from "vitest";
import { mapCreativeDay, mapLaunchedAd, mapMonthAgg, mapScoreAd } from "./rows";

describe("database row mappers", () => {
  it("mapLaunchedAd turns numeric strings into numbers, null into 0, and keeps the launch date as YYYY-MM-DD", () => {
    const a = mapLaunchedAd({ ad_id: "a1", name: "UGC 01", format: "video", is_catalog: false, launch_date: "2026-09-03", spend_7d: "12.50", spend_30d: "100", revenue_30d: null, spend_total: "250.25", revenue_total: "600" });
    expect(a).toEqual({ adId: "a1", name: "UGC 01", format: "video", isCatalog: false, launchDate: "2026-09-03", spend7: 12.5, spend30: 100, revenue30: 0, spendTotal: 250.25, revenueTotal: 600 });
  });

  it("mapLaunchedAd tolerates a timestamp for the date, a missing name and an unknown format", () => {
    const a = mapLaunchedAd({ ad_id: "a2", name: null, format: "gif", is_catalog: true, launch_date: "2026-09-03T00:00:00+00:00", spend_7d: 0, spend_30d: 0, revenue_30d: 0, spend_total: 0, revenue_total: 0 });
    expect(a).toMatchObject({ name: "a2", format: "other", isCatalog: true, launchDate: "2026-09-03" });
  });

  it("mapMonthAgg reads the four launched columns and the carried spend", () => {
    const m = mapMonthAgg({ month: "2026-09-01", spend: "500", catalog_spend: "50", carried_spend: "350", launched_video: 3, launched_image: "2", launched_carousel: null, launched_other: 1 });
    expect(m).toEqual({ month: "2026-09-01", spend: 500, catalogSpend: 50, carriedSpend: 350, launched: { video: 3, image: 2, carousel: 0, other: 1 } });
  });

  it("mapCreativeDay maps a day with its launches by format", () => {
    const d = mapCreativeDay({ date: "2026-09-04", spend: "40", revenue: null, catalog_spend: "5", launched_video: 1, launched_image: 0, launched_carousel: 0, launched_other: 0 });
    expect(d).toEqual({ date: "2026-09-04", spend: 40, revenue: 0, catalogSpend: 5, launched: { video: 1, image: 0, carousel: 0, other: 0 } });
  });

  it("mapScoreAd maps the four weeks oldest first", () => {
    const s = mapScoreAd({ ad_id: "a3", launch_date: "2026-08-20", spend_30: "300", revenue_30: "450", w1: "10", w2: "20", w3: null, w4: "40" });
    expect(s).toEqual({ adId: "a3", launchDate: "2026-08-20", spend30: 300, revenue30: 450, weeks: [10, 20, 0, 40] });
  });

  it("a non-numeric value becomes 0 rather than NaN", () => {
    expect(mapScoreAd({ ad_id: "x", launch_date: "2026-08-20", spend_30: "oops", revenue_30: undefined, w1: "", w2: 0, w3: 0, w4: 0 }).spend30).toBe(0);
  });
});
