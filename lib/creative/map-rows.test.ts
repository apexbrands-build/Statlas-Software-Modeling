import { describe, expect, it } from "vitest";
import { isMissingFunction, mapAdRow, mapFormatRow } from "./map-rows";

describe("mapAdRow", () => {
  const row = {
    ad_id: "a1", name: "UGC hook 07", campaign_name: "Prospecting", format: "video", is_catalog: false, status: "ACTIVE",
    launched: "2026-09-03", first_spend: "2026-09-03", last_spend: "2026-09-30", active_days: 28,
    spend: "12.50", revenue: "30", purchases: "2", impressions: "1000", clicks: "25",
    cur_spend: "5.5", cur_revenue: "11", prev_spend: "4", prev_revenue: null, total_count: "120",
  };

  it("turns numeric strings into numbers and puts the windows under cur and prev", () => {
    expect(mapAdRow(row)).toEqual({
      adId: "a1", name: "UGC hook 07", campaignName: "Prospecting", format: "video", isCatalog: false, status: "ACTIVE", launched: "2026-09-03",
      firstSpend: "2026-09-03", lastSpend: "2026-09-30", activeDays: 28, spend: 12.5, revenue: 30, purchases: 2, impressions: 1000, clicks: 25,
      cur: { spend: 5.5, revenue: 11 }, prev: { spend: 4, revenue: 0 },
    });
  });

  it("keeps a missing campaign name null, a missing format other, and a timestamp as a plain date", () => {
    const r = mapAdRow({ ...row, campaign_name: null, format: null, launched: "2026-09-03T00:00:00+00:00", status: null });
    expect(r).toMatchObject({ campaignName: null, format: "other", launched: "2026-09-03", status: null });
  });

  it("an unknown format becomes other and a missing launch date stays null", () => {
    expect(mapAdRow({ ...row, format: "gif", launched: null })).toMatchObject({ format: "other", launched: null });
  });

  it("a non-numeric value is 0, not NaN", () => {
    expect(mapAdRow({ ...row, spend: "oops", clicks: undefined }).spend).toBe(0);
    expect(mapAdRow({ ...row, clicks: undefined }).clicks).toBe(0);
  });
});

describe("mapFormatRow", () => {
  it("maps a format total with its windows", () => {
    expect(mapFormatRow({ format: "image", ads: "3", spend: "300", revenue: "900.5", purchases: "9", impressions: "3000", clicks: "30", cur_spend: "30", cur_revenue: "60", prev_spend: null, prev_revenue: "24" })).toEqual({
      format: "image", ads: 3, spend: 300, revenue: 900.5, purchases: 9, impressions: 3000, clicks: 30, cur: { spend: 30, revenue: 60 }, prev: { spend: 0, revenue: 24 },
    });
  });
  it("an unknown format is filed under other", () => {
    expect(mapFormatRow({ format: "reel", ads: 1 }).format).toBe("other");
  });
});

describe("isMissingFunction", () => {
  it("is true when the function or the tables are not there yet", () => {
    expect(isMissingFunction({ code: "PGRST202" })).toBe(true);
    expect(isMissingFunction({ code: "PGRST205" })).toBe(true);
    expect(isMissingFunction({ code: "42883" })).toBe(true);
    expect(isMissingFunction({ code: "42P01" })).toBe(true);
    expect(isMissingFunction({ message: 'relation "meta_ad_daily" does not exist' })).toBe(true);
    expect(isMissingFunction({ message: "Could not find the function public.creative_ads_report in the schema cache" })).toBe(true);
    expect(isMissingFunction({ message: "function creative_format_totals(uuid) does not exist" })).toBe(true);
  });
  it("is false for a real error such as a statement timeout, which the page must show", () => {
    expect(isMissingFunction({ code: "57014", message: "canceling statement due to statement timeout" })).toBe(false);
    expect(isMissingFunction({ message: "permission denied" })).toBe(false);
    expect(isMissingFunction({})).toBe(false);
  });
});
