import { describe, expect, it } from "vitest";
import { defaultSettings } from "../defaults";
import type { MarketingEvent } from "../planning/events";
import type { CampaignDay, ChannelKey, PlanTargetDay } from "../types";
import { buildTracker, trackerChannels, trackerLoadTo, TRACKER_PLATFORMS, typeName, type Tracker, type TrackerInput } from "./spend-tracker";

const settings = { ...defaultSettings("t"), multipliers: { ...defaultSettings("t").multipliers, meta_acquisition: 1.2, meta_returning: 0.5, google_nonbrand: 0.65, google_brand: 0.15 } };
const row = (date: string, o: Partial<CampaignDay> = {}): CampaignDay => ({ date, platform: "meta", campaignId: "a", campaignName: "ACQ | Evergreen", category: "acquisition", audience: "new", spend: 100, platformRevenue: 200, platformPurchases: 4, ...o });
const rtn = (date: string, o: Partial<CampaignDay> = {}) => row(date, { campaignId: "b", campaignName: "RTN | Evergreen", category: "retention", audience: "returning", ...o });
const plan = (date: string, by: Partial<Record<ChannelKey, number>>): PlanTargetDay => ({ planId: "p", clientId: "t", date, orderRevenue: 0, newRevenue: 0, returningRevenue: 0, orders: 0, newOrders: 0, spend: 0, cm: 0, spendByChannel: by });
const days = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => `2026-11-${String(from + i).padStart(2, "0")}`);
const month = (by: Partial<Record<ChannelKey, number>>) => days(1, 30).map((d) => plan(d, by));
const base: TrackerInput = { platform: "meta", month: "2026-11", lastData: "2026-11-10", campaigns: [], plan: [], roasOf: null, settings, events: [], launches: [], shareDays: 28, excludeTests: false };
const camp = (t: Tracker, id: string) => {
  const c = t.campaigns.find((x) => x.id === id);
  if (!c) throw new Error(`no campaign ${id}`);
  return c;
};
/** On every day the campaigns add up to the platform. */
const expectSums = (t: Tracker) =>
  t.days.forEach((d, i) => {
    for (const k of ["target", "projected", "actual"] as const) expect(t.campaigns.reduce((a, c) => a + (c.days[i][k] ?? 0), 0)).toBeCloseTo(d[k] ?? 0);
  });

describe("tracker platforms", () => {
  it("gives Google its returning channels too, and every platform its two channels", () => {
    expect(trackerChannels("meta")).toEqual(["meta_acquisition", "meta_returning"]);
    expect(trackerChannels("google")).toEqual(["google_nonbrand", "google_brand", "google_nonbrand_returning", "google_brand_returning"]);
    expect(TRACKER_PLATFORMS.map((p) => p.id)).not.toContain("google_returning");
    expect(TRACKER_PLATFORMS.find((p) => p.id === "meta")?.slug).toBe("facebook-tracker");
    expect(TRACKER_PLATFORMS.find((p) => p.id === "google")?.slug).toBe("google-tracker");
  });
  it("names each type the way a media buyer says it", () => {
    expect((["meta_acquisition", "meta_returning", "google_nonbrand", "google_brand", "google_nonbrand_returning", "google_brand_returning", "pinterest"] as const).map(typeName)).toEqual(["New customers", "Returning customers", "Non-brand", "Brand", "Non-brand, returning", "Brand, returning", "New customers"]);
  });
});

describe("buildTracker: the platform's target, actual and projection", () => {
  const input: TrackerInput = { ...base, plan: month({ meta_acquisition: 80, meta_returning: 20, google_nonbrand: 500 }), campaigns: days(1, 10).map((d) => row(d, { spend: 90 })) };
  const t = buildTracker(input);

  it("the day's target is the plan's spend for the platform's channels only", () => {
    expect(t.days).toHaveLength(30);
    expect(t.days[0]).toMatchObject({ date: "2026-11-01", target: 100, actual: 90, projected: 90, delta: -10, past: true });
    expect(t.summary.targetMonth).toBe(3000);
    expect(t.summary.targetToDate).toBe(1000);
    expect(t.summary.spentToDate).toBe(900);
  });
  it("a day still to come is each type's target times that type's pace so far", () => {
    expect(t.summary.pace).toBeCloseTo(0.9);
    expect(t.days[10]).toMatchObject({ date: "2026-11-11", target: 100, actual: null, delta: null, past: false });
    // New customers run at 90 / 80 of their target, returning at 0 / 20: 80 x 1.125 + 20 x 0
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
    expectSums(noPlan);
  });
  it("with no plan and fewer than seven days of data, the run rate is the average of the days there are", () => {
    expect(buildTracker({ ...base, lastData: "2026-11-03", campaigns: days(1, 3).map((d) => row(d, { spend: 70 })) }).days[10].projected).toBeCloseTo(70);
  });
  it("a plan that holds no spend for this platform is read as no plan, so the projection follows what is being spent", () => {
    const other = buildTracker({ ...input, plan: month({ google_nonbrand: 500 }) });
    expect(other.summary.hasPlan).toBe(false);
    expect(other.days[0].target).toBeNull();
    expect(other.summary.projectedMonth).toBeCloseTo(900 + 20 * 90);
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
  it("reads the days up to the last day the ad platform has data for, when its sync is a day or two behind the store", () => {
    const late = { ...base, lastData: "2026-11-11", plan: month({ meta_acquisition: 100 }), campaigns: days(1, 10).map((d) => row(d, { spend: 100 })) };
    const x = buildTracker(late);
    expect(x.through).toBe("2026-11-10");
    expect(x.days[10]).toMatchObject({ date: "2026-11-11", past: false, actual: null, delta: null });
    expect(x.summary.projectedMonth).toBeCloseTo(3000);
    // An account that stopped spending is not a late sync: after three days the store's day counts.
    const stopped = buildTracker({ ...late, lastData: "2026-11-20" });
    expect(stopped.through).toBe("2026-11-20");
    expect(stopped.days[14]).toMatchObject({ past: true, actual: 0 });
  });
});

describe("a month that is over, seen in the first days of the next one", () => {
  const october = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => `2026-10-${String(from + i).padStart(2, "0")}`);
  const existing = (date: string, spend: number) => row(date, { campaignId: "a:existing", category: "retention", audience: "returning", spend, platformRevenue: 0 });

  it("loads the platform's rows up to three days past the month, never past the store's last day", () => {
    expect(trackerLoadTo("2026-11", "2026-11-10")).toBe("2026-11-30");
    expect(trackerLoadTo("2026-10", "2026-11-02")).toBe("2026-11-02");
    expect(trackerLoadTo("2026-10", "2026-12-15")).toBe("2026-11-03");
    expect(trackerLoadTo("2026-12", "2026-11-10")).toBe("2026-12-31");
  });
  it("reads a quiet month end as days of no spend when the platform has data after it", () => {
    const t = buildTracker({ ...base, month: "2026-10", lastData: "2026-11-01", plan: october(1, 31).map((d) => plan(d, { meta_acquisition: 100 })), campaigns: [...october(1, 29).map((d) => row(d)), row("2026-11-01")] });
    expect(t.through).toBe("2026-11-01");
    expect(t.days[29]).toMatchObject({ date: "2026-10-30", past: true, actual: 0, projected: 0 });
    expect(t.summary).toMatchObject({ daysLeft: 0, spentToDate: 2900, projectedMonth: 2900, lateSync: false });
  });
  it("rows after the month only move the cut-off: they change no campaign's type, share or spend", () => {
    // In October the campaign mostly spends on new customers. On 1 November it spends a lot on existing customers.
    const campaigns = [...october(1, 31).map((d) => row(d, { spend: 60 })), ...october(1, 31).map((d) => existing(d, 10)), existing("2026-11-01", 5000)];
    const t = buildTracker({ ...base, month: "2026-10", lastData: "2026-11-01", campaigns });
    expect(camp(t, "a")).toMatchObject({ channel: "meta_acquisition", actual: 31 * 70 });
    expect(t.shareTo).toBe("2026-10-31");
    expect(t.summary.spentToDate).toBe(31 * 70);
  });
  it("says the platform's sync is late only when a day of the month is waiting on it", () => {
    const late = buildTracker({ ...base, lastData: "2026-11-11", plan: month({ meta_acquisition: 100 }), campaigns: days(1, 10).map((d) => row(d)) });
    expect(late.summary.lateSync).toBe(true);
    // October seen on 2 November, the platform's data ending on 31 October: no day of October is waiting.
    const done = buildTracker({ ...base, month: "2026-10", lastData: "2026-11-02", campaigns: [row("2026-10-31")] });
    expect(done.through).toBe("2026-10-31");
    expect(done.summary.lateSync).toBe(false);
    expect(buildTracker({ ...base, campaigns: days(1, 10).map((d) => row(d)) }).summary.lateSync).toBe(false);
    // A month that has not started waits on nothing.
    expect(buildTracker({ ...base, month: "2026-12", lastData: "2026-11-11", campaigns: days(1, 10).map((d) => row(d)) }).summary.lateSync).toBe(false);
  });
});

describe("buildTracker: the plan is split by type, then by campaign", () => {
  // New customers: a 60 a day and a test campaign 20 a day. Returning: b 30 a day. "old" spent 800 on 20 October only.
  const campaigns = [
    ...days(1, 10).map((d) => row(d, { spend: 60, platformRevenue: 120 })),
    ...days(1, 10).map((d) => row(d, { campaignId: "t", campaignName: "TEST | hooks", category: "test", spend: 20, platformRevenue: 10 })),
    ...days(1, 10).map((d) => rtn(d, { spend: 30, platformRevenue: 150 })),
    row("2026-10-20", { campaignId: "old", campaignName: "ACQ | October promo", spend: 800, platformRevenue: 0 }),
  ];
  const input: TrackerInput = { ...base, plan: month({ meta_acquisition: 100, meta_returning: 50 }), campaigns, shareDays: 7 };
  const t = buildTracker(input);

  it("shows each type of the platform with its own target, spend and pace", () => {
    expect(t.channels.map((c) => c.key)).toEqual(["meta_acquisition", "meta_returning"]);
    expect(t.channels[0]).toMatchObject({ label: "New customers", target: 3000, actual: 800 });
    expect(t.channels[0].pace).toBeCloseTo(0.8);
    expect(t.channels[1]).toMatchObject({ label: "Returning customers", target: 1500, actual: 300 });
    expect(t.channels[1].pace).toBeCloseTo(0.6);
    expect(t.channels[0].days[0]).toMatchObject({ target: 100, actual: 80 });
    expect(t.channels[0].days[15].projected).toBeCloseTo(80);
    expect(t.channels[1].days[15].projected).toBeCloseTo(30);
  });
  it("a campaign carries its share of its own type's plan, read over the last days with data", () => {
    expect(t.shareFrom).toBe("2026-11-04");
    expect(t.shareTo).toBe("2026-11-10");
    // Of the new-customer spend of the last 7 days, a has 60 of 80; b has all the returning spend.
    expect(camp(t, "a").target).toBeCloseTo(3000 * 0.75);
    expect(camp(t, "a").days[0].target).toBeCloseTo(75);
    expect(camp(t, "t").target).toBeCloseTo(3000 * 0.25);
    expect(camp(t, "b").target).toBeCloseTo(1500);
    expect(camp(t, "b").days[0].target).toBeCloseTo(50);
    expect(camp(t, "a").share).toBeCloseTo(420 / 770);
    expect(t.campaigns.map((c) => c.id)).toEqual(["a", "b", "t"]);
  });
  it("a campaign's projection is what it spent plus its share of its type's projection for the days left", () => {
    expect(camp(t, "a").projected).toBeCloseTo(600 + 20 * 80 * 0.75);
    expect(camp(t, "b").projected).toBeCloseTo(300 + 20 * 30);
    expect(camp(t, "a").days[15].projected).toBeCloseTo(60);
    expect(camp(t, "a").days[15].actual).toBeNull();
    expect(t.summary.projectedMonth).toBeCloseTo(1100 + 20 * 110);
    for (const c of t.campaigns) expect(c.projected).toBeCloseTo(c.days.reduce((a, d) => a + (d.projected ?? 0), 0));
  });
  it("on every day the campaigns add up to the platform", () => {
    expectSums(t);
    expectSums(buildTracker({ ...input, shareDays: 28 }));
  });
  it("a wider window brings in a campaign that ran before the month", () => {
    const wide = buildTracker({ ...input, shareDays: 28 });
    expect(wide.shareFrom).toBe("2026-10-14");
    expect(camp(wide, "old")).toMatchObject({ actual: 0 });
    expect(camp(wide, "old").target).toBeCloseTo(3000 * 0.5);
    expect(camp(wide, "a").target).toBeCloseTo(3000 * (600 / 1600));
  });
  it("a campaign that stopped keeps what it spent and carries nothing of the days left", () => {
    const stopped = buildTracker({ ...base, shareDays: 7, plan: month({ meta_acquisition: 250 }), campaigns: [...days(1, 10).map((d) => row(d, { spend: 100 })), ...days(1, 3).map((d) => row(d, { campaignId: "p", campaignName: "ACQ | Paused", spend: 500 }))] });
    expect(camp(stopped, "p")).toMatchObject({ actual: 1500, share: 0, projected: 1500 });
    expect((camp(stopped, "a").projected ?? 0) + 1500).toBeCloseTo(stopped.summary.projectedMonth ?? 0);
  });
  it("shows planned spend of a type that no campaign carries, so the grid still adds up", () => {
    const g = buildTracker({ ...base, platform: "google", plan: month({ google_nonbrand: 70, google_brand: 30 }), campaigns: days(1, 10).map((d) => row(d, { platform: "google_ads", campaignId: "nb", campaignName: "PMax", audience: "unknown", spend: 70 })) });
    const none = camp(g, "none:google_brand");
    expect(none).toMatchObject({ name: "No campaign (Brand)", type: "Brand", placeholder: true, actual: 0, target: 900 });
    expect(g.channels.map((c) => c.label)).toEqual(["Non-brand", "Brand"]);
    expect(none.days[0]).toMatchObject({ target: 30, actual: 0 });
    expect(g.campaigns[g.campaigns.length - 1].id).toBe("none:google_brand");
    expectSums(g);
  });
  it("leaves test campaigns out when asked, and says how much", () => {
    const x = buildTracker({ ...input, excludeTests: true });
    expect(x.campaigns.map((c) => c.id)).toEqual(["a", "b"]);
    expect(x.summary.spentToDate).toBe(900);
    expect(camp(x, "a").target).toBeCloseTo(3000);
    // The plan's target still holds the tests' budget, so the screen has to say how much was left out.
    expect(x.summary.testsLeftOut).toBe(200);
    expect(t.summary.testsLeftOut).toBe(0);
  });
  it("shows Meta's new-customer and existing-customer rows of a campaign as one campaign, with both parts of the plan", () => {
    const m = buildTracker({
      ...base,
      roasOf: (_d, k) => (k === "meta_acquisition" ? 2 : null),
      plan: month({ meta_acquisition: 80, meta_returning: 20 }),
      campaigns: [...days(1, 10).map((d) => row(d, { spend: 80, platformRevenue: 200 })), ...days(1, 10).map((d) => row(d, { campaignId: "a:existing", category: "retention", audience: "returning", spend: 20, platformRevenue: 100 }))],
    });
    expect(m.campaigns).toHaveLength(1);
    const c = m.campaigns[0];
    expect(c).toMatchObject({ id: "a", name: "ACQ | Evergreen", channel: "meta_acquisition", actual: 1000, revenue: 3000, placeholder: false });
    expect(c.share).toBeCloseTo(1);
    expect(c.days[0]).toMatchObject({ actual: 100, target: 100 });
    // With a target on the new-customer part only, its return is read on that part.
    expect(c.roas).toBeCloseTo(2.5);
    expect(c.roasTarget).toBeCloseTo(2);
  });
});

describe("buildTracker: campaigns grouped by the type they mostly spend on", () => {
  const existing = (date: string, id: string, spend: number, platformRevenue = 0) => row(date, { campaignId: `${id}:existing`, campaignName: id === "a" ? "ACQ | Evergreen" : "ACQ | Catalog", category: "retention", audience: "returning", spend, platformRevenue });
  // Two prospecting campaigns that also reach existing customers (Meta reports that part apart), and one retention campaign.
  const campaigns = [
    ...days(1, 10).map((d) => row(d, { spend: 60, platformRevenue: 120 })),
    ...days(1, 10).map((d) => existing(d, "a", 10, 40)),
    ...days(1, 10).map((d) => row(d, { campaignId: "c", campaignName: "ACQ | Catalog", spend: 20, platformRevenue: 20 })),
    ...days(1, 10).map((d) => existing(d, "c", 10, 40)),
    ...days(1, 10).map((d) => rtn(d, { campaignId: "r", campaignName: "RTN | Winback", spend: 5, platformRevenue: 30 })),
  ];
  const t = buildTracker({ ...base, roasOf: (_d, k) => (k === "meta_acquisition" ? 2 : 4), plan: month({ meta_acquisition: 80, meta_returning: 25 }), campaigns });

  it("makes one group per type, in the platform's order, each campaign once", () => {
    expect(t.groups.map((g) => [g.key, g.label, g.campaigns.map((c) => c.id)])).toEqual([
      ["meta_acquisition", "New customers", ["a", "c"]],
      ["meta_returning", "Returning customers", ["r"]],
    ]);
  });
  it("a group's subtotal is the sum of its campaigns, the part they spend on other types included", () => {
    const sub = t.groups[0].subtotal;
    // a: 60 of 80 new + 10 of 25 returning; c: 20 of 80 + 10 of 25. Together 80 + 25 x 20/25 = 100 a day of the plan.
    expect(sub?.days[0]).toMatchObject({ target: 100, actual: 100 });
    expect(sub).toMatchObject({ actual: 1000, revenue: 2200 });
    expect(sub?.target).toBeCloseTo(3000);
    t.days.forEach((_d, i) => {
      for (const k of ["target", "projected", "actual"] as const) expect(sub?.days[i][k] ?? 0).toBeCloseTo(t.groups[0].campaigns.reduce((a, c) => a + (c.days[i][k] ?? 0), 0));
    });
    // Return: 2,200 on 1,000, against what that spend should have returned (800 x 2 + 200 x 4).
    expect(sub?.roas).toBeCloseTo(2.2);
    expect(sub?.roasTarget).toBeCloseTo(2.4);
    expect(sub?.days[0].roas).toBeCloseTo(2.2);
    expect(sub?.days[15].roas).toBeNull();
  });
  it("a group with one block has no subtotal: it would repeat it", () => {
    expect(t.groups[1].subtotal).toBeNull();
  });
  it("the groups add up to the platform on every day", () => {
    t.days.forEach((d, i) => {
      const of = (k: "target" | "projected" | "actual") => t.groups.reduce((a, g) => a + g.campaigns.reduce((x, c) => x + (c.days[i][k] ?? 0), 0), 0);
      expect(of("target")).toBeCloseTo(d.target ?? 0);
      expect(of("projected")).toBeCloseTo(d.projected ?? 0);
      expect(of("actual")).toBeCloseTo(d.actual ?? 0);
    });
  });
  it("with one type only there is one group and no subtotal: it would repeat the total", () => {
    const one = buildTracker({ ...base, campaigns: [...days(1, 10).map((d) => row(d)), ...days(1, 10).map((d) => row(d, { campaignId: "c", campaignName: "ACQ | Catalog" }))] });
    expect(one.groups).toHaveLength(1);
    expect(one.groups[0].subtotal).toBeNull();
    expect(buildTracker(base).groups).toEqual([]);
  });
  it("says when a group is not its type's own spend: a campaign in it carries another type, or another group carries part of this one", () => {
    // a and c also reach existing customers, so neither group's numbers are its type's own plan and spend.
    expect(t.groups.map((g) => g.matchesType)).toEqual([false, false]);
    const pure = buildTracker({ ...base, plan: month({ meta_acquisition: 80, meta_returning: 20 }), campaigns: [...days(1, 10).map((d) => row(d)), ...days(1, 10).map((d) => rtn(d))] });
    expect(pure.groups.map((g) => g.matchesType)).toEqual([true, true]);
  });
  it("planned spend that no campaign carries sits in its own type's group", () => {
    const g = buildTracker({ ...base, platform: "google", plan: month({ google_nonbrand: 70, google_brand: 30 }), campaigns: days(1, 10).map((d) => row(d, { platform: "google_ads", campaignId: "nb", campaignName: "PMax", audience: "unknown", spend: 70 })) });
    expect(g.groups.map((x) => [x.label, x.campaigns.map((c) => c.id)])).toEqual([
      ["Non-brand", ["nb"]],
      ["Brand", ["none:google_brand"]],
    ]);
  });
});

describe("buildTracker: return", () => {
  const roasOf = (_d: string, k: ChannelKey) => (k === "meta_acquisition" ? 2 : k === "meta_returning" ? 4 : null);
  const input: TrackerInput = {
    ...base,
    roasOf,
    plan: month({ meta_acquisition: 80, meta_returning: 20 }),
    campaigns: [...days(1, 10).map((d) => row(d, { spend: 80, platformRevenue: 120 })), ...days(1, 10).map((d) => rtn(d, { spend: 20, platformRevenue: 100 }))],
  };
  const t = buildTracker(input);

  it("reads each campaign and each type against its own target, through its own factor", () => {
    const a = camp(t, "a");
    const b = camp(t, "b");
    expect(a).toMatchObject({ channel: "meta_acquisition", type: "New customers" });
    expect(a.roas).toBeCloseTo(1.5);
    expect(a.roasTarget).toBeCloseTo(2);
    expect(a.iRoas).toBeCloseTo(1.5 * 1.2);
    expect(a.iRoasTarget).toBeCloseTo(2 * 1.2);
    expect(b).toMatchObject({ channel: "meta_returning", type: "Returning customers" });
    expect(b.roas).toBeCloseTo(5);
    expect(b.roasTarget).toBeCloseTo(4);
    expect(b.iRoas).toBeCloseTo(2.5);
    expect(b.iRoasTarget).toBeCloseTo(2);
    expect(t.channels[1].roas).toBeCloseTo(5);
    expect(t.channels[1].roasTarget).toBeCloseTo(4);
  });
  it("ROAS so far is platform revenue over spend; iROAS weights each campaign by its type's factor", () => {
    expect(t.summary.revenueToDate).toBe(2200);
    expect(t.summary.roas).toBeCloseTo(2.2);
    expect(t.summary.iRoas).toBeCloseTo((1200 * 1.2 + 1000 * 0.5) / 1000);
    expect(t.summary.targetedShare).toBeCloseTo(1);
  });
  it("the target is what the spend so far should have returned, each part at its own target", () => {
    expect(t.summary.roasTarget).toBeCloseTo((80 * 2 + 20 * 4) / 100);
    expect(t.summary.iRoasTarget).toBeCloseTo((80 * 2 * 1.2 + 20 * 4 * 0.5) / 100);
  });
  it("the ROAS needed on the days left makes up the month's planned revenue", () => {
    // planned revenue 30 x 240 = 7,200; made 2,200; planned spend left 20 x 100 = 2,000
    expect(t.summary.roasNeeded).toBeCloseTo((7200 - 2200) / 2000);
    expect(t.summary.roasPlanLeft).toBeCloseTo(2.4);
    expect(t.summary.planMet).toBe(false);
    expect(buildTracker({ ...input, roasOf: null }).summary.roasNeeded).toBeNull();
    expect(buildTracker({ ...input, lastData: "2026-11-30" }).summary.roasNeeded).toBeNull();
  });
  it("says the plan is met when the revenue so far already covers the month", () => {
    const met = buildTracker({ ...input, campaigns: days(1, 10).map((d) => row(d, { spend: 80, platformRevenue: 800 })) });
    expect(met.summary.planMet).toBe(true);
    expect(met.summary.roasNeeded).toBe(0);
  });
  it("the ROAS needed leaves out the revenue of a type the plan holds no spend for (Meta's reach to existing customers)", () => {
    // Plan: 100 a day to new customers only. The campaign spends 80 a day on new customers at 1.8 and 20 a day on existing customers at 6.
    const m = buildTracker({
      ...base,
      lastData: "2026-11-20",
      roasOf: (_d, k) => (k === "meta_acquisition" ? 2 : k === "meta_returning" ? 3.83 : null),
      plan: month({ meta_acquisition: 100 }),
      campaigns: [...days(1, 20).map((d) => row(d, { spend: 80, platformRevenue: 144 })), ...days(1, 20).map((d) => row(d, { campaignId: "a:existing", category: "retention", audience: "returning", spend: 20, platformRevenue: 120 }))],
    });
    // The plan expects 30 x 100 x 2 = 6,000. New-customer spend made 2,880, and 1,000 of planned spend is left.
    expect(m.summary.roasNeeded).toBeCloseTo(3.12);
    expect(m.summary.planMet).toBe(false);
    expect(m.summary.planTypes).toEqual(["meta_acquisition"]);
    // The return so far is still read on everything that has a target.
    expect(m.summary.roas).toBeCloseTo((2880 + 2400) / 2000);
  });
  it("the plan is not met by the revenue of campaigns it holds no spend for (Google, returning customers)", () => {
    const g = buildTracker({
      ...base,
      platform: "google",
      lastData: "2026-11-20",
      roasOf: (_d, k) => (k === "google_nonbrand" ? 3.5 : k === "google_nonbrand_returning" ? 5 : null),
      plan: month({ google_nonbrand: 100 }),
      campaigns: [
        ...days(1, 20).map((d) => row(d, { platform: "google_ads", campaignId: "pm", campaignName: "PMax", audience: "unknown", spend: 100, platformRevenue: 300 })),
        ...days(1, 20).map((d) => row(d, { platform: "google_ads", campaignId: "rt", campaignName: "RTN | Search", audience: "returning", spend: 50, platformRevenue: 400 })),
      ],
    });
    // Non-brand made 6,000 of the 10,500 the plan expects; the 8,000 of the returning campaign is not the plan's.
    expect(g.summary.planMet).toBe(false);
    expect(g.summary.roasNeeded).toBeCloseTo(4.5);
    expect(g.summary.planTypes).toEqual(["google_nonbrand"]);
  });
  it("reads the target at the mix that was really spent, so campaigns that are each on target show on target", () => {
    const g = buildTracker({
      ...base,
      platform: "google",
      roasOf: (_d, k) => (k === "google_nonbrand" ? 3.5 : k === "google_brand" ? 15 : null),
      plan: month({ google_nonbrand: 70, google_brand: 30 }),
      campaigns: [
        ...days(1, 10).map((d) => row(d, { platform: "google_ads", campaignId: "nb", campaignName: "PMax", audience: "unknown", spend: 85, platformRevenue: 85 * 3.5 })),
        ...days(1, 10).map((d) => row(d, { platform: "google_ads", campaignId: "br", campaignName: "Search | Brand", category: "brand", audience: "unknown", spend: 15, platformRevenue: 15 * 15 })),
      ],
    });
    expect(g.summary.roas).toBeCloseTo(g.summary.roasTarget ?? 0);
    expect(g.summary.roasTarget).toBeCloseTo((85 * 3.5 + 15 * 15) / 100);
  });
  it("when a type has no target, only the spend that has one is read against the target", () => {
    const part = buildTracker({ ...input, roasOf: (_d, k) => (k === "meta_acquisition" ? 2 : null), campaigns: [...days(1, 10).map((d) => row(d, { spend: 80, platformRevenue: 160 })), ...days(1, 10).map((d) => rtn(d, { spend: 20, platformRevenue: 100 }))] });
    expect(part.summary.roas).toBeCloseTo(2);
    expect(part.summary.roasTarget).toBeCloseTo(2);
    expect(part.summary.roasAll).toBeCloseTo(2.6);
    expect(part.summary.targetedShare).toBeCloseTo(0.8);
    expect(part.summary.roasNeeded).toBeCloseTo((4800 - 1600) / 1600);
  });
  it("reads the return of each day, for the platform and for each campaign", () => {
    expect(t.days[0].roas).toBeCloseTo(2.2);
    expect(t.days[0].roasTarget).toBeCloseTo(2.4);
    expect(t.days[15].roas).toBeNull();
    expect(camp(t, "a").days[0].roas).toBeCloseTo(1.5);
    expect(camp(t, "a").days[0].iRoas).toBeCloseTo(1.8);
  });
});

describe("buildTracker: moments and launches", () => {
  const ev = (name: string, date: string, endDate = date): MarketingEvent => ({ id: name, clientId: "t", date, endDate, type: "sale", name, source: "manual" });
  it("tags each day with the calendar's events", () => {
    const t = buildTracker({ ...base, events: [ev("Black Friday", "2026-11-27", "2026-11-30"), ev("Singles Day", "2026-11-11"), ev("Cyber week", "2026-12-01")] });
    expect(t.days[10].moments).toEqual(["Singles Day"]);
    expect(t.days[26].moments).toEqual(["Black Friday"]);
    expect(t.days[29].moments).toEqual(["Black Friday"]);
    expect(t.days[0].moments).toEqual([]);
  });
  it("marks the days a campaign got new ads on that campaign, and counts them all on the platform's day", () => {
    const campaigns = [row("2026-11-01"), row("2026-11-01", { campaignId: "b", campaignName: "ACQ | Other" })];
    const launches = [{ date: "2026-11-02", campaign: "ACQ | Evergreen" }, { date: "2026-11-02", campaign: "ACQ | Other" }, { date: "2026-10-30", campaign: "ACQ | Other" }];
    const t = buildTracker({ ...base, campaigns, launches });
    expect(t.summary.launches).toBe(2);
    expect(t.days[1].launches).toBe(2);
    expect(camp(t, "b").days[1].launches).toBe(1);
    expect(camp(t, "b").days[0].launches).toBe(0);
  });
});
