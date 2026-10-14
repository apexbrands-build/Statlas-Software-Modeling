import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { adFormat, isCatalogCampaign, isRetryableAdError, mapAd, mapAdDay, RetryableAdError } = await import("./meta-ads");

describe("adFormat", () => {
  it("calls a video creative a video, from the object type, a video id, a video block or a feed of videos", () => {
    expect(adFormat({ object_type: "VIDEO" })).toBe("video");
    expect(adFormat({ video_id: "123" })).toBe("video");
    expect(adFormat({ object_story_spec: { video_data: { video_id: "1" } } })).toBe("video");
    expect(adFormat({ asset_feed_spec: { videos: [{}], images: [{}, {}] } })).toBe("video");
  });

  it("calls a creative with one picture an image", () => {
    expect(adFormat({ object_type: "PHOTO" })).toBe("image");
    expect(adFormat({ object_type: "SHARE", object_story_spec: { link_data: { image_hash: "abc" } } })).toBe("image");
    expect(adFormat({ object_story_spec: { photo_data: {} } })).toBe("image");
    expect(adFormat({ asset_feed_spec: { images: [{}] } })).toBe("image");
  });

  it("calls a creative with several cards or several feed images a carousel", () => {
    expect(adFormat({ object_type: "SHARE", object_story_spec: { link_data: { child_attachments: [{}, {}, {}] } } })).toBe("carousel");
    expect(adFormat({ asset_feed_spec: { images: [{}, {}] } })).toBe("carousel");
  });

  it("falls back to other for anything unknown, empty or missing", () => {
    expect(adFormat(null)).toBe("other");
    expect(adFormat(undefined)).toBe("other");
    expect(adFormat({})).toBe("other");
    expect(adFormat({ object_type: "STATUS" })).toBe("other");
  });
});

describe("isCatalogCampaign", () => {
  const kw = "catalog, dpa, daba";
  it("matches a keyword in any case inside the campaign name", () => {
    expect(isCatalogCampaign("Spring DPA - US", kw)).toBe(true);
    expect(isCatalogCampaign("DABA retargeting", kw)).toBe(true);
    expect(isCatalogCampaign("Always-on CATALOG sales", kw)).toBe(true);
  });
  it("does not flag an ordinary campaign, a missing name or an empty keyword list", () => {
    expect(isCatalogCampaign("Prospecting", kw)).toBe(false);
    expect(isCatalogCampaign(null, kw)).toBe(false);
    expect(isCatalogCampaign(undefined, kw)).toBe(false);
    expect(isCatalogCampaign("Spring DPA - US", "")).toBe(false);
    expect(isCatalogCampaign("Spring DPA - US", " , ,")).toBe(false);
  });
  it("ignores spaces around keywords", () => {
    expect(isCatalogCampaign("a dpa b", "  dpa  ")).toBe(true);
  });
});

describe("mapAdDay", () => {
  const row = {
    ad_id: "a1",
    ad_name: "UGC 01",
    date_start: "2026-09-01",
    spend: "12.50",
    impressions: "1000",
    clicks: "25",
    actions: [
      { action_type: "link_click", value: "25" },
      { action_type: "omni_purchase", value: "3", "7d_click": "2", "1d_view": "1" },
    ],
    action_values: [{ action_type: "omni_purchase", value: "300", "7d_click": "200", "1d_view": "100" }],
  };
  it("turns the Graph row into a table row with numbers", () => {
    expect(mapAdDay(row, ["7d_click"], "c1", "act_9")).toEqual({ client_id: "c1", account_id: "act_9", ad_id: "a1", date: "2026-09-01", spend: 12.5, impressions: 1000, clicks: 25, purchases: 2, revenue: 200 });
  });
  it("sums the requested attribution windows", () => {
    const r = mapAdDay(row, ["7d_click", "1d_view"], "c1", "act_9");
    expect([r.purchases, r.revenue]).toEqual([3, 300]);
  });
  it("gives 0 purchases and revenue when the ad has no actions, and 0 for missing numbers", () => {
    expect(mapAdDay({ ad_id: "a2", date_start: "2026-09-02" }, ["7d_click"], "c1", "act_9")).toEqual({ client_id: "c1", account_id: "act_9", ad_id: "a2", date: "2026-09-02", spend: 0, impressions: 0, clicks: 0, purchases: 0, revenue: 0 });
  });
});

describe("mapAd", () => {
  const ad = { id: "a1", name: "UGC 01", adset_id: "s1", campaign: { id: "c9", name: "Spring DPA" }, effective_status: "ACTIVE", created_time: "2026-08-20T10:00:00+0000", creative: { video_id: "v" } };
  it("maps the ad with its format, launch time, status and catalog flag", () => {
    expect(mapAd(ad, "c1", "catalog, dpa", "act_9")).toMatchObject({ client_id: "c1", account_id: "act_9", ad_id: "a1", name: "UGC 01", campaign_id: "c9", campaign_name: "Spring DPA", adset_id: "s1", created_at: "2026-08-20T10:00:00+0000", format: "video", is_catalog: true, status: "ACTIVE" });
  });
  it("stores format other when the creative is missing, and keeps going without a campaign", () => {
    const m = mapAd({ id: "a2", effective_status: "PAUSED" }, "c1", "dpa", "act_9");
    expect(m).toMatchObject({ ad_id: "a2", format: "other", is_catalog: false, status: "PAUSED", campaign_name: null, created_at: null, name: null });
  });
});

describe("isRetryableAdError", () => {
  it("is true for a timeout, Meta's rate limits and its too-much-data error", () => {
    for (const m of ["TIMEOUT: ad-level data did not fit", "Meta: (#17) User request limit reached", "Meta: (#4) Application request limit reached", "Meta: (#80004) There have been too many calls to this ad-account", "Meta: (#613) Calls to this api have exceeded the rate limit", "Meta: Please reduce the amount of data you're asking for, then retry your request", "Meta: Service temporarily unavailable", "Meta: An unknown error occurred"]) {
      expect(isRetryableAdError(new Error(m)), m).toBe(true);
    }
  });
  it("is true for a RetryableAdError whatever its message", () => {
    expect(isRetryableAdError(new RetryableAdError("connection reset"))).toBe(true);
  });
  it("is false for permission errors, unknown errors and values that are not errors", () => {
    expect(isRetryableAdError(new Error("Meta: (#200) Requires ads_read permission"))).toBe(false);
    expect(isRetryableAdError(new Error("Meta: (#100) Invalid parameter"))).toBe(false);
    expect(isRetryableAdError("TIMEOUT")).toBe(false);
    expect(isRetryableAdError(null)).toBe(false);
  });
});
