import { describe, expect, it } from "vitest";
import { defaultSettings } from "./defaults";
import { PLATFORMS, RETENTION_CHANNELS, platformOf } from "./channels";
import { aggregate, amerSpend, channelGroups, METRICS } from "./metrics";
import { channelOf } from "./reports/paid-media";
import { inputsFromFacts } from "./planning/history";
import { MER_SPECS } from "./reports/metric-spec";
import { campaignAudience, channelTotals, classifyGoogleDays, googleChannel, type GoogleCampaignDay } from "./sync/google-split";
import { CHANNEL_KEYS, CHANNEL_LABELS, type DailyFact } from "./types";

describe("campaignAudience: ACQ and RTN tags in the campaign name", () => {
  it("reads the tags as their own words, in any case", () => {
    expect(campaignAudience("US | RTN | Search | Brand", "ACQ", "RTN")).toBe("returning");
    expect(campaignAudience("us - rtn - shopping", "ACQ", "RTN")).toBe("returning");
    expect(campaignAudience("US | ACQ | Search", "ACQ", "RTN")).toBe("new");
  });
  it("does not match a tag inside another word", () => {
    expect(campaignAudience("Smartnet RTNX returns", "ACQ", "RTN")).toBe("unknown");
    expect(campaignAudience("Placqueworks", "ACQ", "RTN")).toBe("unknown");
  });
  it("an untagged campaign is unknown, which counts as new", () => {
    expect(campaignAudience("Search | Generic", "ACQ", "RTN")).toBe("unknown");
  });
  it("a name with both tags is unknown rather than guessed", () => {
    expect(campaignAudience("ACQ RTN mix", "ACQ", "RTN")).toBe("unknown");
  });
  it("an empty tag in the settings switches that tag off", () => {
    expect(campaignAudience("US | RTN | Search", "ACQ", "")).toBe("unknown");
    expect(campaignAudience("US | ACQ | Search", "", "RTN")).toBe("unknown");
  });
});

describe("googleChannel", () => {
  it("gives the four combinations of brand and audience", () => {
    expect(googleChannel(false, "new")).toBe("google_nonbrand");
    expect(googleChannel(false, "unknown")).toBe("google_nonbrand");
    expect(googleChannel(true, "new")).toBe("google_brand");
    expect(googleChannel(true, "unknown")).toBe("google_brand");
    expect(googleChannel(false, "returning")).toBe("google_nonbrand_returning");
    expect(googleChannel(true, "returning")).toBe("google_brand_returning");
  });
});

describe("the two returning Google channels", () => {
  const settings = defaultSettings("c");
  const channels = Object.fromEntries(CHANNEL_KEYS.map((k) => [k, { spend: 0, platformRevenue: 0, platformPurchases: 0 }])) as DailyFact["channels"];
  const fact = (spend: Partial<Record<(typeof CHANNEL_KEYS)[number], number>>, rev: Partial<Record<(typeof CHANNEL_KEYS)[number], number>> = {}): DailyFact => {
    const c = JSON.parse(JSON.stringify(channels)) as DailyFact["channels"];
    for (const [k, v] of Object.entries(spend)) c[k as keyof typeof c].spend = v!;
    for (const [k, v] of Object.entries(rev)) c[k as keyof typeof c].platformRevenue = v!;
    return { clientId: "c", date: "2026-10-01", grossSales: 1000, discounts: 0, netSales: 1000, shippingCollected: 0, tax: 0, newOrderRevenue: 600, returningOrderRevenue: 400, newOrders: 6, returningOrders: 4, refunds: 0, cogs: 0, cogsUnmappedSales: 0, emailRevenue: 0, emailCampaignRevenue: 0, emailFlowRevenue: 0, emailOrders: 0, emailSent: 0, channels: c };
  };

  it("exist as channels with names", () => {
    expect(CHANNEL_KEYS).toContain("google_nonbrand_returning");
    expect(CHANNEL_KEYS).toContain("google_brand_returning");
    expect(CHANNEL_LABELS.google_nonbrand_returning).toBe("Google Returning");
    expect(CHANNEL_LABELS.google_brand_returning).toBe("Google Brand Returning");
  });
  it("have a platform entry, so settings and the dashboard know them", () => {
    expect(platformOf("google_nonbrand_returning").platform.label).toBe("Google Returning");
    expect(platformOf("google_brand_returning").kind).toBe("NON-Acquisition");
  });
  it("are retention spend, taken out of aMER with the retention switch", () => {
    expect(RETENTION_CHANNELS).toEqual(expect.arrayContaining(["google_nonbrand_returning", "google_brand_returning"]));
    const t = aggregate([fact({ google_nonbrand: 100, google_nonbrand_returning: 30, google_brand_returning: 20 })]);
    expect(amerSpend(t, { ...settings, excludeMetaReturningFromAmer: true })).toBe(100);
    expect(amerSpend(t, settings)).toBe(150);
  });
  it("brand search left out of aMER includes returning brand, without being taken off twice", () => {
    const t = aggregate([fact({ google_nonbrand: 100, google_brand: 10, google_brand_returning: 20, meta_returning: 5 })]);
    expect(amerSpend(t, { ...settings, excludeBrandFromAmer: true })).toBe(105);
    expect(amerSpend(t, { ...settings, excludeBrandFromAmer: true, excludeMetaReturningFromAmer: true })).toBe(100);
  });
  it("come with incrementality defaults like the other returning and brand channels", () => {
    expect(settings.multipliers.google_nonbrand_returning).toBe(0.6);
    expect(settings.multipliers.google_brand_returning).toBe(0.3);
  });
  it("do not count as new-customer paid revenue", () => {
    const t = aggregate([fact({ google_nonbrand: 100, google_nonbrand_returning: 50 }, { google_nonbrand: 300, google_nonbrand_returning: 500 })]);
    expect(METRICS.newPaidIRevenue.value(t, settings)).toBeCloseTo(300 * 0.75, 8);
    expect(METRICS.paidIRevenue.value(t, settings)).toBeCloseTo(300 * 0.75 + 500 * 0.6, 8);
  });
  it("show as Google Returning rows on Home only in the breakout, and never in the acquisition-only view", () => {
    const ids = (breakout: boolean, acqOnly = false) => channelGroups(breakout, acqOnly).map((g) => g.id);
    expect(ids(true)).toEqual(expect.arrayContaining(["google_nonbrand_returning", "google_brand_returning"]));
    expect(ids(false)).toContain("google_returning");
    expect(ids(false, true)).not.toContain("google_nonbrand_returning");
    expect(PLATFORMS.filter((p) => p.returningOnly).map((p) => p.id)).toEqual(["google_returning"]);
  });
  it("route Google campaigns by brand and audience in the paid media report", () => {
    const c = (category: "acquisition" | "brand", audience: "new" | "returning" | "unknown") => channelOf({ platform: "google_ads", category, audience });
    expect(c("acquisition", "unknown")).toBe("google_nonbrand");
    expect(c("brand", "new")).toBe("google_brand");
    expect(c("acquisition", "returning")).toBe("google_nonbrand_returning");
    expect(c("brand", "returning")).toBe("google_brand_returning");
  });
});

describe("Google returning spend in the plan and the reports", () => {
  const settings = defaultSettings("c");
  const mk = (spend: Partial<Record<(typeof CHANNEL_KEYS)[number], number>>): DailyFact => {
    const c = Object.fromEntries(CHANNEL_KEYS.map((k) => [k, { spend: spend[k] ?? 0, platformRevenue: (spend[k] ?? 0) * 2, platformPurchases: 1 }])) as DailyFact["channels"];
    return { clientId: "c", date: "2025-09-01", grossSales: 1000, discounts: 0, netSales: 1000, shippingCollected: 0, tax: 0, newOrderRevenue: 600, returningOrderRevenue: 400, newOrders: 6, returningOrders: 4, refunds: 0, cogs: 0, cogsUnmappedSales: 0, emailRevenue: 0, emailCampaignRevenue: 0, emailFlowRevenue: 0, emailOrders: 0, emailSent: 0, channels: c };
  };
  it("the plan's starting spend is all the spend, returning Google campaigns included (the plan has no separate returning Google line)", () => {
    const i = inputsFromFacts([mk({ meta_acquisition: 100, google_nonbrand: 40, google_nonbrand_returning: 30, google_brand_returning: 30 })], 1, settings, "last_year")!;
    expect(i.spend).toBe(200);
    expect(i.platformPct.google).toBeCloseTo(50, 2);
    expect(i.altPct.google).toBeCloseTo(30, 2); // brand (here the returning brand 30) is 30% of Google's 100
  });
  it("the Marketing Efficiency Report's Google lines cover all four Google channels", () => {
    const t = aggregate([mk({ google_nonbrand: 10, google_brand: 20, google_nonbrand_returning: 30, google_brand_returning: 40 })]);
    const spec = (k: string) => MER_SPECS.find((m) => m.key === k)!;
    expect(spec("gSpend").value(t, settings)).toBe(100);
    expect(spec("gRoas").value(t, settings)).toBeCloseTo(2, 8);
  });
});

describe("classifyGoogleDays and channelTotals", () => {
  const rules = { keyword: "brand", nonBrandTag: "NB", acqTag: "ACQ", rtnTag: "RTN" };
  const day = (campaignName: string, spend: number, over: Partial<GoogleCampaignDay> = {}): GoogleCampaignDay => ({ date: "2026-10-01", campaignId: campaignName, campaignName, spend, purchases: 1, revenue: spend * 3, ...over });

  it("puts each campaign day in one of the four channels by its name", () => {
    const out = classifyGoogleDays(
      [day("US | ACQ | NB | Search", 10), day("US | RTN | NB | Search", 20), day("US | ACQ | Brand", 30), day("US | RTN | Brand", 40), day("Shopping generic", 50), day("Search | Brand", 60)],
      rules,
    );
    expect(out.map((d) => d.channel)).toEqual(["google_nonbrand", "google_nonbrand_returning", "google_brand", "google_brand_returning", "google_nonbrand", "google_brand"]);
    expect(out.map((d) => d.audience)).toEqual(["new", "returning", "new", "returning", "unknown", "unknown"]);
    expect(out.map((d) => d.category)).toEqual(["acquisition", "acquisition", "brand", "brand", "acquisition", "brand"]);
  });
  it("sums spend, revenue and purchases per date and channel", () => {
    const out = classifyGoogleDays([day("US | RTN | Search", 20), day("US | RTN | Shopping", 5), day("US | RTN | Search", 7, { date: "2026-10-02" })], rules);
    const totals = channelTotals(out);
    expect(totals).toContainEqual({ date: "2026-10-01", channel: "google_nonbrand_returning", spend: 25, platformRevenue: 75, platformPurchases: 2 });
    expect(totals).toContainEqual({ date: "2026-10-02", channel: "google_nonbrand_returning", spend: 7, platformRevenue: 21, platformPurchases: 1 });
    expect(totals).toHaveLength(2);
  });
});
