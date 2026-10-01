import { describe, expect, it } from "vitest";
import { defaultSettings } from "../defaults";
import type { CampaignDay } from "../types";
import { buildPaidMedia, channelOf, filterCampaigns, type PmFilters } from "./paid-media";

const s = { ...defaultSettings("t"), multipliers: { meta_acquisition: 1.2, meta_returning: 0.6, google_nonbrand: 0.75, google_brand: 0.3 } };
const row = (o: Partial<CampaignDay>): CampaignDay => ({ date: "2026-09-01", platform: "meta", campaignId: "a", campaignName: "ACQ | Broad", category: "acquisition", audience: "new", spend: 100, platformRevenue: 300, platformPurchases: 4, ...o });
const none: PmFilters = { platform: "all", nameContains: "", removeNames: [], excludeTests: false };

describe("paid media", () => {
  it("maps campaigns to incrementality channels", () => {
    expect(channelOf(row({}))).toBe("meta_acquisition");
    expect(channelOf(row({ audience: "returning", category: "retention" }))).toBe("meta_returning");
    expect(channelOf(row({ platform: "google_ads", category: "brand", audience: "unknown" }))).toBe("google_brand");
    expect(channelOf(row({ platform: "google_ads", audience: "unknown" }))).toBe("google_nonbrand");
  });
  it("iROAS = platform revenue x multiplier / spend; iCPA = spend / (purchases x multiplier)", () => {
    const { total } = buildPaidMedia([row({})], null, "campaign", s);
    expect(total.roas).toBeCloseTo(3);
    expect(total.iRoas).toBeCloseTo(3.6);
    expect(total.iCpa).toBeCloseTo(100 / 4.8);
  });
  it("blends multipliers across campaigns and sums to the total", () => {
    const rows = [row({}), row({ campaignId: "b", platform: "google_ads", category: "brand", audience: "unknown", campaignName: "Search | Brand" })];
    const r = buildPaidMedia(rows, null, "platform", s);
    expect(r.rows).toHaveLength(2);
    expect(r.rows.reduce((a, x) => a + x.spend, 0)).toBe(r.total.spend);
    expect(r.total.iRoas).toBeCloseTo((300 * 1.2 + 300 * 0.3) / 200);
  });
  it("filters by platform, name, removed names and tests", () => {
    const rows = [row({}), row({ campaignId: "t", campaignName: "TEST | us11 | x" }), row({ campaignId: "g", platform: "google_ads", campaignName: "PMax" })];
    expect(filterCampaigns(rows, { ...none, platform: "google" }, s)).toHaveLength(1);
    expect(filterCampaigns(rows, { ...none, nameContains: "acq" }, s)).toHaveLength(1);
    expect(filterCampaigns(rows, { ...none, removeNames: ["pmax"] }, s)).toHaveLength(2);
    expect(filterCampaigns(rows, { ...none, excludeTests: true }, { ...s, extra: { ...s.extra, testKeyword: "us11" } })).toHaveLength(2);
  });
  it("compares a campaign with the same campaign in the other period", () => {
    const r = buildPaidMedia([row({ spend: 200 })], [row({ spend: 100 })], "campaign", s);
    expect(r.rows[0].cmp?.spend).toBe(100);
  });
});
