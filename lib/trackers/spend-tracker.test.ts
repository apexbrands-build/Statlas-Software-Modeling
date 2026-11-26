import { describe, expect, it } from "vitest";
import { defaultSettings } from "../defaults";
import type { MarketingEvent } from "../planning/events";
import type { CampaignDay, ChannelKey, PlanTargetDay } from "../types";
import { buildTracker, trackerChannels, TRACKER_PLATFORMS, type TrackerInput } from "./spend-tracker";

const settings = { ...defaultSettings("t"), multipliers: { ...defaultSettings("t").multipliers, meta_acquisition: 1.2, meta_returning: 0.5, google_nonbrand: 0.65, google_brand: 0.15 } };
const row = (date: string, o: Partial<CampaignDay> = {}): CampaignDay => ({ date, platform: "meta", campaignId: "a", campaignName: "ACQ | Evergreen", category: "acquisition", audience: "new", spend: 100, platformRevenue: 200, platformPurchases: 4, ...o });
const plan = (date: string, by: Partial<Record<ChannelKey, number>>): PlanTargetDay => ({ planId: "p", clientId: "t", date, orderRevenue: 0, newRevenue: 0, returningRevenue: 0, orders: 0, newOrders: 0, spend: 0, cm: 0, spendByChannel: by });
const days = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => `2026-11-${String(from + i).padStart(2, "0")}`);
const base: TrackerInput = { platform: "meta", month: "2026-11", lastData: "2026-11-10", campaigns: [], plan: [], roasOf: null, settings, events: [], launches: [], shareDays: 28, excludeTests: false, campaignId: null };

describe("tracker platforms", () => {
  it("gives Google its returning channels too, and every platform its two channels", () => {
    expect(trackerChannels("meta")).toEqual(["meta_acquisition", "meta_returning"]);
    expect(trackerChannels("google")).toEqual(["google_nonbrand", "google_brand", "google_nonbrand_returning", "google_brand_returning"]);
    expect(TRACKER_PLATFORMS.map((p) => p.id)).not.toContain("google_returning");
    expect(TRACKER_PLATFORMS.find((p) => p.id === "meta")?.slug).toBe("facebook-tracker");
    expect(TRACKER_PLATFORMS.find((p) => p.id === "google")?.slug).toBe("google-tracker");
  });
});

describe("buildTracker: target, actual and projection", () => {
  const input: TrackerInput = {
    ...base,
    plan: days(1, 30).map((d) => plan(d, { meta_acquisition: 80, meta_returning: 20, google_nonbrand: 500 })),
    campaigns: days(1, 10).map((d) => row(d, { spend: 90 })),
  };
  const t = buildTracker(input);

  it("the day's target is the plan's spend for the platform's channels only", () => {
    expect(t.days).toHaveLength(30);
    expect(t.days[0]).toMatchObject({ date: "2026-11-01", target: 100, actual: 90, projected: 90, delta: -10, past: true });
    expect(t.summary.targetMonth).toBe(3000);
    expect(t.summary.targetToDate).toBe(1000);
    expect(t.summary.spentToDate).toBe(900);
  });
  it("a day still to come is its target times the pace so far", () => {
    expect(t.summary.pace).toBeCloseTo(0.9);
    expect(t.days[10]).toMatchObject({ date: "2026-11-11", target: 100, actual: null, delta: null, past: false });
    expect(t.days[10].projected).toBeCloseTo(90);
    expect(t.summary.projectedMonth).toBeCloseTo(900 + 20 * 90);
    expect(t.summary.daysElapsed).toBe(10);
    expect(t.summary.daysLeft).toBe(20);
  });
  it("a past day with no spend is zero, not empty", () => {
    const gap = buildTracker({ ...input, campaigns: input.campaigns.filter((c) => c.date !== "2026-11-05") });
    expect(gap.days[4]).toMatchObject({ actual: 0, projected: 0, delta: -100 });
  });
  it("leaves the other platforms' campaigns out", () => {
    const mixed = buildTracker({ ...input, campaigns: [...input.campaigns, row("2026-11-02", { platform: "google_ads", campaignId: "g", spend: 999 })] });
    expect(mixed.summary.spentToDate).toBe(900);
    expect(buildTracker({ ...input, platform: "google", campaigns: [row("2026-11-02", { platform: "google_ads", campaignId: "g", spend: 40, audience: "returning" })] }).days[1]).toMatchObject({ target: 500, actual: 40 });
  });
  it("with no plan, the days to come use the average of the last seven days, and there is no target", () => {
    const noPlan = buildTracker({ ...input, plan: [], campaigns: [...days(1, 3).map((d) => row(d, { spend: 10 })), ...days(4, 10).map((d) => row(d, { spend: 70 }))] });
    expect(noPlan.summary.hasPlan).toBe(false);
    expect(noPlan.summary.targetMonth).toBeNull();
    expect(noPlan.summary.pace).toBeNull();
    expect(noPlan.days[0]).toMatchObject({ target: null, delta: null, actual: 10 });
    expect(noPlan.days[20].projected).toBeCloseTo(70);
    expect(noPlan.summary.projectedMonth).toBeCloseTo(30 + 490 + 20 * 70);
  });
  it("a month that has not started is projected at its plan, and a finished month at what was spent", () => {
    const next = buildTracker({ ...input, month: "2026-12", plan: [plan("2026-12-01", { meta_acquisition: 50 })] });
    expect(next.summary.pace).toBeNull();
    expect(next.days[0]).toMatchObject({ target: 50, projected: 50, actual: null });
    expect(next.days[1].target).toBeNull();
    const done = buildTracker({ ...input, lastData: "2026-12-05" });
    expect(done.summary.daysLeft).toBe(0);
    expect(done.summary.projectedMonth).toBe(900);
  });
});

describe("buildTracker: campaigns", () => {
  const campaigns = [
    ...days(1, 10).map((d) => row(d, { spend: 60, platformRevenue: 120 })),
    ...days(1, 10).map((d) => row(d, { campaignId: "b", campaignName: "RTN | Evergreen", category: "retention", audience: "returning", spend: 30, platformRevenue: 150 })),
    ...days(1, 10).map((d) => row(d, { campaignId: "t", campaignName: "TEST | hooks", category: "test", spend: 10, platformRevenue: 5 })),
    // October: inside a 28-day window that ends on 10 November, outside a 7-day one.
    row("2026-10-20", { campaignId: "old", campaignName: "ACQ | October promo", spend: 1000, platformRevenue: 0 }),
  ];
  const input: TrackerInput = { ...base, plan: days(1, 30).map((d) => plan(d, { meta_acquisition: 100 })), campaigns, shareDays: 7 };

  it("a campaign's share is its part of the platform's spend over the last days with data", () => {
    const t = buildTracker(input);
    expect(t.shareFrom).toBe("2026-11-04");
    expect(t.shareTo).toBe("2026-11-10");
    expect(t.campaigns.map((c) => c.id)).toEqual(["a", "b", "t"]);
    expect(t.campaigns[0].share).toBeCloseTo(0.6);
    expect(t.campaigns.reduce((a, c) => a + (c.share ?? 0), 0)).toBeCloseTo(1);
    const wide = buildTracker({ ...input, shareDays: 28 });
    expect(wide.shareFrom).toBe("2026-10-14");
    expect(wide.campaigns.find((c) => c.id === "old")?.share).toBeCloseTo(0.5);
    expect(wide.campaigns.find((c) => c.id === "old")?.actual).toBe(0);
  });
  it("a campaign's target and projection are the platform's times its share", () => {
    const t = buildTracker(input);
    expect(t.summary.targetMonth).toBe(3000);
    expect(t.campaigns[0].target).toBeCloseTo(1800);
    expect(t.campaigns[0].projected).toBeCloseTo((t.summary.projectedMonth ?? 0) * 0.6);
    expect(t.campaigns[0].actual).toBe(600);
  });
  it("reads each campaign's return against its own channel", () => {
    const roasOf = (_d: string, k: ChannelKey) => (k === "meta_acquisition" ? 1.8 : k === "meta_returning" ? 4 : null);
    const t = buildTracker({ ...input, roasOf });
    const a = t.campaigns[0];
    const b = t.campaigns[1];
    expect(a).toMatchObject({ channel: "meta_acquisition", type: "Meta", roasTarget: 1.8 });
    expect(a.roas).toBeCloseTo(2);
    expect(a.iRoas).toBeCloseTo(2.4);
    expect(b).toMatchObject({ channel: "meta_returning", type: "Meta Returning", roasTarget: 4 });
    expect(b.roas).toBeCloseTo(5);
    expect(b.iRoas).toBeCloseTo(2.5);
  });
  it("leaves test campaigns out when asked", () => {
    const t = buildTracker({ ...input, excludeTests: true });
    expect(t.campaigns.map((c) => c.id)).toEqual(["a", "b"]);
    expect(t.summary.spentToDate).toBe(900);
    expect(t.campaigns[0].share).toBeCloseTo(60 / 90);
  });
  it("shows a picked campaign's own days", () => {
    const t = buildTracker({ ...input, campaignId: "b" });
    expect(t.picked).toBe("RTN | Evergreen");
    expect(t.days[0]).toMatchObject({ actual: 30, projected: 30 });
    expect(t.days[0].target).toBeCloseTo(30);
    expect(t.days[0].delta).toBeCloseTo(0);
    expect(t.days[15].projected).toBeCloseTo(100 * 1 * 0.3);
    // The tiles stay on the whole platform.
    expect(t.summary.spentToDate).toBe(1000);
  });
});

describe("buildTracker: return", () => {
  const roasOf = (_d: string, k: ChannelKey) => (k === "meta_acquisition" ? 2 : k === "meta_returning" ? 4 : null);
  const input: TrackerInput = {
    ...base,
    roasOf,
    plan: days(1, 30).map((d) => plan(d, { meta_acquisition: 80, meta_returning: 20 })),
    campaigns: [...days(1, 10).map((d) => row(d, { spend: 80, platformRevenue: 120 })), ...days(1, 10).map((d) => row(d, { campaignId: "b", category: "retention", audience: "returning", spend: 20, platformRevenue: 60 }))],
  };
  const t = buildTracker(input);
  it("ROAS so far is platform revenue over spend; iROAS weights each campaign by its channel's factor", () => {
    expect(t.summary.revenueToDate).toBe(1800);
    expect(t.summary.roas).toBeCloseTo(1.8);
    expect(t.summary.iRoas).toBeCloseTo((1200 * 1.2 + 600 * 0.5) / 1000);
  });
  it("the ROAS target is the planned revenue over the planned spend, so far", () => {
    expect(t.summary.roasTarget).toBeCloseTo((80 * 2 + 20 * 4) / 100);
    expect(t.summary.iRoasTarget).toBeCloseTo((80 * 2 * 1.2 + 20 * 4 * 0.5) / 100);
  });
  it("the ROAS needed on the days left makes up the month's planned revenue", () => {
    // planned revenue 30 x 240 = 7,200; made 1,800; planned spend left 20 x 100 = 2,000
    expect(t.summary.roasNeeded).toBeCloseTo((7200 - 1800) / 2000);
    expect(buildTracker({ ...input, roasOf: null }).summary.roasNeeded).toBeNull();
    expect(buildTracker({ ...input, lastData: "2026-11-30" }).summary.roasNeeded).toBeNull();
  });
});

describe("buildTracker: moments", () => {
  const ev = (name: string, date: string, endDate = date): MarketingEvent => ({ id: name, clientId: "t", date, endDate, type: "sale", name, source: "manual" });
  it("tags each day with the calendar's events and the ads launched", () => {
    const t = buildTracker({ ...base, events: [ev("Black Friday", "2026-11-27", "2026-11-30"), ev("Singles Day", "2026-11-11"), ev("Cyber week", "2026-12-01")], launches: [{ date: "2026-11-11", campaign: "x" }, { date: "2026-11-11", campaign: "y" }, { date: "2026-10-30", campaign: "z" }] });
    expect(t.days[10].moments).toEqual(["Singles Day"]);
    expect(t.days[10].launches).toBe(2);
    expect(t.days[26].moments).toEqual(["Black Friday"]);
    expect(t.days[29].moments).toEqual(["Black Friday"]);
    expect(t.days[0].moments).toEqual([]);
    expect(t.summary.launches).toBe(2);
  });
});
