import { describe, expect, it } from "vitest";
import { addYears, comparisonRange, diffDays } from "./dates";
import { aggregate, amerSpend, channelGroups, channelMetricDefs, cmParts, compare, emptyTotals, METRICS, totalSpend } from "./metrics";
import { defaultExtra } from "./defaults";
import { SeedRepository } from "./repository/seed";
import { splitCampaignDays } from "./sync/meta-split";
import { isBrandCampaign, mergeGoogleRows } from "./sync/google-split";
import { buildGroups } from "../components/DateRangePicker";
import { chartGranularity } from "./monthly";
import type { ChannelKey, ClientSettings, DailyFact } from "./types";
import { CHANNEL_KEYS } from "./types";

const settings: ClientSettings = {
  clientId: "t",
  multipliers: { google_nonbrand: 0.75, google_brand: 0.3, meta_acquisition: 1.2, meta_returning: 0.6, pinterest: 0.3 },
  otherVariablePct: 10,
  cogsFallbackPct: 0,
  cogsFlatRate: false,
  excludedOrderTags: [],
  extra: defaultExtra(),
  deliveryCostPerOrder: 2,
  monthlyFixedCosts: 3650,
  attributionWindow: "7d_click",
  revenueDefinition: "order_revenue",
  brandCampaignKeyword: "brand",
  excludeBrandFromAmer: false,
  excludeMetaReturningFromAmer: false,
  dtcChannels: ["Online Store"],
};

const zeroCh = () => ({ spend: 0, platformRevenue: 0, platformPurchases: 0 });

function fact(over: Partial<DailyFact> = {}, ch: Partial<Record<ChannelKey, Partial<ReturnType<typeof zeroCh>>>> = {}): DailyFact {
  const channels = Object.fromEntries(CHANNEL_KEYS.map((k) => [k, { ...zeroCh(), ...(ch[k] ?? {}) }])) as DailyFact["channels"];
  return {
    clientId: "t",
    date: "2026-09-01",
    grossSales: 1380,
    discounts: 300,
    netSales: 1000,
    shippingCollected: 60,
    tax: 100,
    newOrderRevenue: 700,
    returningOrderRevenue: 460,
    newOrders: 10,
    returningOrders: 5,
    refunds: 80,
    cogs: 200,
    cogsUnmappedSales: 0,
    emailRevenue: 200,
    emailCampaignRevenue: 100,
    emailFlowRevenue: 100,
    emailOrders: 3,
    emailSent: 10000,
    channels,
    ...over,
  };
}

describe("contribution margin", () => {
  it("= (net sales + shipping) - COGS - ad spend - cost of delivery; no fixed costs", () => {
    const t = aggregate([fact({}, { meta_acquisition: { spend: 150 } })]);
    const p = cmParts(t, settings);
    // revenue = 1000 + 60 = 1060; delivery = 10% of 1060 + 2*15 = 136; CM = 1060 - 200 - 150 - 136 = 574
    expect(p.shipping).toBe(60);
    expect(p.costOfDelivery).toBeCloseTo(136);
    expect(p.cm).toBeCloseTo(574);
  });
});

describe("ROAS vs iROAS and platforms", () => {
  const t = aggregate([fact({}, { google_nonbrand: { spend: 20, platformRevenue: 80, platformPurchases: 1 }, youtube: { spend: 10, platformRevenue: 30, platformPurchases: 1 } })]);
  it("ROAS mode reports platform numbers without the factor", () => {
    const g = channelGroups(true).find((x) => x.id === "google_nonbrand")!;
    const roas = channelMetricDefs(g, false).find((m) => m.key.endsWith(".iroas"))!;
    const iroas = channelMetricDefs(g, true).find((m) => m.key.endsWith(".iroas"))!;
    expect(roas.label).toBe("Google ROAS");
    expect(roas.value(t, settings)).toBeCloseTo(80 / 20);
    expect(iroas.value(t, settings)).toBeCloseTo((80 * 0.75) / 20);
  });
  it("a channel with no factor counts as 1, and added platforms use their own factor", () => {
    const yt = channelGroups(true).find((x) => x.id === "youtube")!;
    const iroas = channelMetricDefs(yt, true).find((m) => m.key.endsWith(".iroas"))!;
    expect(iroas.value(t, settings)).toBeCloseTo(30 / 10);
    expect(iroas.value(t, { ...settings, multipliers: { ...settings.multipliers, youtube: 0.3 } })).toBeCloseTo((30 * 0.3) / 10);
  });
  it("acquisition only drops non-acquisition rows", () => {
    const ids = channelGroups(true, true).map((g) => g.id);
    expect(ids).toContain("google_nonbrand");
    expect(ids).not.toContain("google_brand");
    expect(ids).not.toContain("meta_returning");
  });
});

describe("COGS fallback", () => {
  it("estimates COGS for sales whose product has no cost", () => {
    const t = aggregate([fact({ cogs: 100, cogsUnmappedSales: 400 })]);
    expect(cmParts(t, { ...settings, cogsFallbackPct: 25 }).cogs).toBeCloseTo(200);
    expect(cmParts(t, settings).cogs).toBeCloseTo(100);
  });
  it("flat rate ignores Shopify costs and uses a share of net sales", () => {
    const t = aggregate([fact({ cogs: 100, netSales: 1000 })]);
    expect(cmParts(t, { ...settings, cogsFlatRate: true, cogsFallbackPct: 30 }).cogs).toBeCloseTo(300);
  });
});

describe("ratio metrics", () => {
  const t = aggregate([
    fact(
      {},
      {
        google_nonbrand: { spend: 20, platformRevenue: 80, platformPurchases: 1 },
        google_brand: { spend: 10, platformRevenue: 100, platformPurchases: 2 },
        meta_acquisition: { spend: 70, platformRevenue: 140, platformPurchases: 2 },
      },
    ),
  ]);

  it("MER, AOV, weighted CAC, aMER", () => {
    expect(METRICS.mer.value(t, settings)).toBeCloseTo(1160 / 100);
    expect(METRICS.aov.value(t, settings)).toBeCloseTo(1160 / 15);
    expect(METRICS.weightedCac.value(t, settings)).toBeCloseTo(100 / 10);
    expect(METRICS.amer.value(t, settings)).toBeCloseTo(700 / 100);
    expect(METRICS.amer.value(t, { ...settings, excludeBrandFromAmer: true })).toBeCloseTo(700 / 90);
  });

  it("applies incrementality multipliers per channel", () => {
    const google = channelMetricDefs(channelGroups(true).find((g) => g.id === "google_nonbrand")!);
    const iRev = google.find((m) => m.key.endsWith(".irev"))!;
    const iRoas = google.find((m) => m.key.endsWith(".iroas"))!;
    expect(iRev.value(t, settings)).toBeCloseTo(80 * 0.75);
    expect(iRoas.value(t, settings)).toBeCloseTo((80 * 0.75) / 20);
    // Paid iRevenue = 60 + 30 + 168
    expect(METRICS.paidIRevenue.value(t, settings)).toBeCloseTo(60 + 30 + 168);
    expect(METRICS.ipaMer.value(t, settings)).toBeCloseTo(258 / 100);
  });

  it("merging channels blends the multiplier", () => {
    const googleMerged = channelMetricDefs(channelGroups(false).find((g) => g.id === "google")!);
    const iRev = googleMerged.find((m) => m.key.endsWith(".irev"))!;
    expect(iRev.value(t, settings)).toBeCloseTo(60 + 30);
  });

  it("returns null instead of dividing by zero", () => {
    const empty = aggregate([fact({ newOrders: 0, returningOrders: 0, newOrderRevenue: 0, returningOrderRevenue: 0 })]);
    expect(METRICS.mer.value(empty, settings)).toBeNull();
    expect(METRICS.aov.value(empty, settings)).toBeNull();
  });
});

describe("compare / red-green", () => {
  it("higher-is-better metrics (spend included)", () => {
    expect(compare(120, 100, "up").tone).toBe("good");
    expect(compare(80, 100, "up").tone).toBe("bad");
  });
  it("lower-is-better metrics", () => {
    expect(compare(80, 100, "down").tone).toBe("good");
    expect(compare(120, 100, "down").tone).toBe("bad");
  });
  it("within +/-10% is neutral in both directions", () => {
    expect(compare(110, 100, "up").tone).toBe("neutral");
    expect(compare(90, 100, "up").tone).toBe("neutral");
    expect(compare(90, 100, "down").tone).toBe("neutral");
    expect(compare(110.5, 100, "up").tone).toBe("good");
  });
  it("missing reference has no diff", () => {
    expect(compare(50, null, "up")).toEqual({ diff: null, tone: "neutral" });
  });
});

describe("dates", () => {
  it("shifts a year back, clamping Feb 29", () => {
    expect(addYears("2026-09-28", -1)).toBe("2025-09-28");
    expect(addYears("2028-02-29", -1)).toBe("2027-02-28");
  });
  it("comparison ranges keep equal length", () => {
    const cur = { from: "2026-09-01", to: "2026-09-11" };
    expect(comparisonRange("yoy", cur)).toEqual({ from: "2025-09-01", to: "2025-09-11" });
    const prev = comparisonRange("prev", cur);
    expect(prev).toEqual({ from: "2026-08-21", to: "2026-08-31" });
    expect(diffDays(prev.from, prev.to)).toBe(10);
  });
  it("custom comparison uses the range the user picked", () => {
    const cur = { from: "2026-09-01", to: "2026-09-11" };
    const custom = { from: "2026-03-01", to: "2026-03-31" };
    expect(comparisonRange("custom", cur, custom)).toEqual(custom);
  });
});

describe("seed repository", () => {
  it("is deterministic and internally consistent", async () => {
    const repo = new SeedRepository();
    const a = await repo.getFacts("northwind", "2025-03-01", "2025-03-10");
    const b = await repo.getFacts("northwind", "2025-03-01", "2025-03-10");
    expect(a).toEqual(b);
    expect(a).toHaveLength(10);
    for (const f of a) {
      expect(f.netSales + f.shippingCollected + f.tax + f.refunds).toBeCloseTo(f.newOrderRevenue + f.returningOrderRevenue);
    }
  });
  it("plan targets satisfy revenue = new + returning", async () => {
    const repo = new SeedRepository();
    const rows = await repo.getPlanTargets("kettle", "kettle-2026-official", "2026-01-01", "2026-01-31");
    expect(rows).toHaveLength(31);
    for (const r of rows) expect(r.orderRevenue).toBeCloseTo(r.newRevenue + r.returningRevenue);
  });
});

describe("Meta existing-customer split", () => {
  const day = { date: "2026-09-01", campaignId: "c1", campaignName: "ASC", spend: 100, purchases: 10, revenue: 500 };
  it("splits a campaign-day into acquisition and existing without changing totals", () => {
    const rows = splitCampaignDays([day], new Map([["2026-09-01|c1", { spend: 30, purchases: 4, revenue: 200 }]]));
    expect(rows).toHaveLength(2);
    const acq = rows.find((r) => r.audience_type === "new")!;
    const ret = rows.find((r) => r.audience_type === "returning")!;
    expect(acq.spend).toBe(70);
    expect(ret.spend).toBe(30);
    expect(ret.campaign_id).toBe("c1:existing");
    expect(rows.reduce((s, r) => s + r.spend, 0)).toBe(100);
    expect(rows.reduce((s, r) => s + r.platform_revenue, 0)).toBe(500);
  });
  it("campaigns without segment data are all acquisition", () => {
    const rows = splitCampaignDays([day], new Map());
    expect(rows).toHaveLength(1);
    expect(rows[0].category).toBe("acquisition");
  });
  it("never produces negative acquisition when the breakdown slightly exceeds the total", () => {
    const rows = splitCampaignDays([day], new Map([["2026-09-01|c1", { spend: 101, purchases: 11, revenue: 510 }]]));
    expect(rows.every((r) => r.spend >= 0 && r.platform_revenue >= 0)).toBe(true);
  });
});

describe("Google brand rule and merge", () => {
  it("brand = campaign name contains the keyword, case-insensitive; empty keyword never matches", () => {
    expect(isBrandCampaign("Search | Branded | US", "brand")).toBe(true);
    expect(isBrandCampaign("Brand - Exact", "brand")).toBe(true);
    expect(isBrandCampaign("Search | Generic", "brand")).toBe(false);
    expect(isBrandCampaign("Search | Branded", "")).toBe(false);
  });
  it("a campaign tagged NB is never brand, even if it contains the keyword", () => {
    expect(isBrandCampaign("AB | NB | Brand Terms Test", "brand")).toBe(false);
    expect(isBrandCampaign("Search NB US", "brand")).toBe(false);
    expect(isBrandCampaign("AB | Brand | US", "brand")).toBe(true);
    expect(isBrandCampaign("Nba Brand", "brand")).toBe(true); // "Nba" is not the standalone tag NB
    expect(isBrandCampaign("AB | NB | Brand", "brand", "")).toBe(true); // no tag configured
  });
  it("non-brand campaign names are not brand", () => {
    expect(isBrandCampaign("Search | Non-Brand | US", "brand")).toBe(false);
    expect(isBrandCampaign("Search NonBrand", "brand")).toBe(false);
    expect(isBrandCampaign("Search | non brand", "brand")).toBe(false);
    expect(isBrandCampaign("Brand | Non-Brand Mix", "brand")).toBe(true);
  });
  it("joins cost and purchase rows per campaign-day", () => {
    const cost = [{ segments: { date: "2026-09-01" }, campaign: { id: "1", name: "A" }, metrics: { costMicros: "12340000" } }];
    const purchases = [
      { segments: { date: "2026-09-01" }, campaign: { id: "1", name: "A" }, metrics: { conversions: 2, conversionsValue: 150 } },
      { segments: { date: "2026-09-02" }, campaign: { id: "2", name: "B" }, metrics: { conversions: 1, conversionsValue: 40 } },
    ];
    const rows = mergeGoogleRows(cost, purchases);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ spend: 12.34, purchases: 2, revenue: 150 });
    expect(rows[1]).toMatchObject({ spend: 0, purchases: 1, revenue: 40 });
  });
});

describe("date picker presets (today = 2026-09-30)", () => {
  const groups = buildGroups("2026-09-30");
  const labels = (id: string) => groups.find((g) => g.id === id)!.options.map((o) => o.label);
  const range = (id: string, label: string) => groups.find((g) => g.id === id)!.options.find((o) => o.label === label)!.range;

  it("days, weeks, quarters, years and BFCM follow the requested lists", () => {
    expect(labels("days")).toEqual(["Yesterday", "Last 7 days", "Last 14 days", "Last 30 days", "Last 60 days", "Last 90 days"]);
    expect(labels("weeks")).toEqual(["This week", "Last week", "2 weeks ago", "3 weeks ago", "4 weeks ago", "5 weeks ago", "6 weeks ago"]);
    expect(labels("quarters")).toEqual(["This quarter", "Last quarter", "2026 Q1", "2025 Q4", "2025 Q3", "2025 Q2", "2025 Q1"]);
    expect(labels("years")).toEqual(["This year (YTD)", "Last year", "2024", "2023", "2022", "2021", "2020"]);
    expect(labels("bfcm")).toEqual(["BFCM 2025", "BFCM 2024", "BFCM 2023", "BFCM 2022", "BFCM 2021", "BFCM 2020"]);
  });
  it("months are two groups: single months, and Last X months", () => {
    expect(labels("months")).toEqual(["Month to date", "This month", "Next month", "Last month", "2 months ago", "3 months ago", "4 months ago", "5 months ago", "6 months ago"]);
    expect(labels("lastmonths")).toEqual(["Last 2 months", "Last 3 months", "Last 4 months", "Last 5 months", "Last 6 months"]);
    expect(range("months", "Last month")).toEqual({ from: "2026-08-01", to: "2026-08-31" });
    expect(range("months", "Next month")).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(range("lastmonths", "Last 3 months")).toEqual({ from: "2026-06-01", to: "2026-08-31" });
  });
  it("Yesterday is one day and Month to date runs from the 1st to yesterday (the last day with data)", () => {
    expect(range("days", "Yesterday")).toEqual({ from: "2026-09-29", to: "2026-09-29" });
    expect(range("months", "Month to date")).toEqual({ from: "2026-09-01", to: "2026-09-29" });
  });
  it("Month to date on the 1st is that one day, not a backwards range", () => {
    const first = buildGroups("2026-10-01").find((g) => g.id === "months")!.options.find((o) => o.label === "Month to date")!.range;
    expect(first).toEqual({ from: "2026-10-01", to: "2026-10-01" });
  });
  it("ranges are correct", () => {
    expect(range("days", "Last 7 days")).toEqual({ from: "2026-09-23", to: "2026-09-29" });
    expect(range("weeks", "This week")).toEqual({ from: "2026-09-28", to: "2026-10-04" });
    expect(range("weeks", "Last week")).toEqual({ from: "2026-09-21", to: "2026-09-27" });
    expect(range("quarters", "This quarter")).toEqual({ from: "2026-07-01", to: "2026-09-30" });
    expect(range("quarters", "2025 Q4")).toEqual({ from: "2025-10-01", to: "2025-12-31" });
    expect(range("years", "Last year")).toEqual({ from: "2025-01-01", to: "2025-12-31" });
    expect(range("years", "This year (YTD)")).toEqual({ from: "2026-01-01", to: "2026-09-29" });
  });
  it("BFCM runs Black Friday through Cyber Monday", () => {
    expect(range("bfcm", "BFCM 2025")).toEqual({ from: "2025-11-28", to: "2025-12-01" });
    expect(range("bfcm", "BFCM 2024")).toEqual({ from: "2024-11-29", to: "2024-12-02" });
  });
});

describe("trend chart granularity", () => {
  it("up to about two months is daily, longer is monthly", () => {
    expect(chartGranularity({ from: "2026-09-01", to: "2026-09-30" })).toBe("day");
    expect(chartGranularity({ from: "2026-07-31", to: "2026-09-30" })).toBe("day"); // 62 days
    expect(chartGranularity({ from: "2026-07-30", to: "2026-09-30" })).toBe("month"); // 63 days
    expect(chartGranularity({ from: "2026-01-01", to: "2026-09-30" })).toBe("month");
  });
});

import { metaWindows } from "./sync/meta-windows";
describe("metaWindows", () => {
  it("maps store settings to Meta windows", () => {
    expect(metaWindows("7 Day", "Disabled")).toEqual(["7d_click"]);
    expect(metaWindows("1 Day", "1 Day")).toEqual(["1d_click", "1d_view"]);
    expect(metaWindows(undefined, undefined)).toEqual(["7d_click"]);
  });
});

describe("aMER spend and the retention switch", () => {
  const t = aggregate([fact({}, { meta_acquisition: { spend: 300 }, meta_returning: { spend: 200 }, pinterest_returning: { spend: 100 }, google_brand: { spend: 50 } })]);

  it("counts all spend when nothing is excluded", () => {
    expect(amerSpend(t, settings)).toBe(650);
  });

  it("leaves out every platform's returning spend, but not brand search, with the retention switch", () => {
    expect(amerSpend(t, { ...settings, excludeMetaReturningFromAmer: true })).toBe(350);
  });

  it("leaves out brand search only with the brand switch", () => {
    expect(amerSpend(t, { ...settings, excludeBrandFromAmer: true })).toBe(600);
  });

  it("keeps total spend, and so MER, on all spend whatever the switches say", () => {
    expect(totalSpend(t)).toBe(650);
  });
});

describe("unassigned spend", () => {
  it("aggregate sums it and totalSpend counts it with the channels", () => {
    const f = (n: number, unassigned?: number) => {
      const day = fact({});
      return { ...day, ...(unassigned === undefined ? {} : { unassignedSpend: unassigned }), channels: { ...day.channels, meta_acquisition: { ...day.channels.meta_acquisition, spend: n } } };
    };
    const t = aggregate([f(100, 40), f(50, 10), f(25)]);
    expect(t.unassignedSpend).toBe(50);
    expect(totalSpend(t)).toBe(175 + 50);
  });
  it("is 0 for actual days, which never carry it", () => {
    expect(aggregate([fact({})]).unassignedSpend).toBe(0);
    expect(emptyTotals().unassignedSpend).toBe(0);
  });
});

describe("new and total paid incremental revenue", () => {
  const t = aggregate([
    fact(
      { newOrderRevenue: 3000, returningOrderRevenue: 2000 },
      {
        meta_acquisition: { spend: 500, platformRevenue: 1000 },
        google_nonbrand: { spend: 200, platformRevenue: 400 },
        google_brand: { spend: 100, platformRevenue: 500 },
        meta_returning: { spend: 100, platformRevenue: 200 },
      },
    ),
  ]);

  it("total paid iRevenue adds every channel's platform revenue times its factor, brand search and returning audiences included", () => {
    expect(METRICS.paidIRevenue.value(t, settings)).toBeCloseTo(1200 + 300 + 150 + 120, 6);
    expect(METRICS.paidIRevenue.label).toBe("Total paid iRevenue");
  });

  it("new paid iRevenue counts only the acquisition channels (Meta acquisition, Google non-brand, other platforms' acquisition), not brand search or returning audiences", () => {
    expect(METRICS.newPaidIRevenue.value(t, settings)).toBeCloseTo(1200 + 300, 6);
  });

  it("new paid iOrders, AOV, iCAC and ipaMER use the acquisition channels only, with their own spend", () => {
    const withOrders = aggregate([
      fact(
        { newOrderRevenue: 3000, returningOrderRevenue: 2000 },
        {
          meta_acquisition: { spend: 500, platformRevenue: 1000, platformPurchases: 20 },
          google_nonbrand: { spend: 200, platformRevenue: 400, platformPurchases: 10 },
          google_brand: { spend: 100, platformRevenue: 500, platformPurchases: 50 },
          meta_returning: { spend: 100, platformRevenue: 200, platformPurchases: 5 },
        },
      ),
    ]);
    const iOrders = 20 * (settings.multipliers.meta_acquisition ?? 1) + 10 * (settings.multipliers.google_nonbrand ?? 1);
    expect(METRICS.newPaidIOrders.value(withOrders, settings)).toBeCloseTo(iOrders, 6);
    expect(METRICS.newPaidAov.value(withOrders, settings)).toBeCloseTo(1500 / iOrders, 6);
    expect(METRICS.newPaidICac.value(withOrders, settings)).toBeCloseTo(700 / iOrders, 6);
    expect(METRICS.newIpaMer.value(withOrders, settings)).toBeCloseTo(1500 / 700, 6);
    // the total ipaMER still divides by every channel's spend
    expect(METRICS.ipaMer.value(withOrders, settings)).toBeCloseTo(1770 / 900, 6);
  });

  it("each is shown against the revenue it should explain: total paid over order revenue, new paid over new revenue", () => {
    expect(METRICS.paidShareOfRevenue.value(t, settings)).toBeCloseTo(1770 / 5000, 10);
    expect(METRICS.newPaidShareOfNewRevenue.value(t, settings)).toBeCloseTo(1500 / 3000, 10);
  });

  it("the shares are a dash, not zero or infinity, when there is no revenue to divide by", () => {
    const empty = aggregate([fact({ newOrderRevenue: 0, returningOrderRevenue: 0 }, { meta_acquisition: { platformRevenue: 100 } })]);
    expect(METRICS.paidShareOfRevenue.value(empty, settings)).toBeNull();
    expect(METRICS.newPaidShareOfNewRevenue.value(empty, settings)).toBeNull();
  });

  it("uses the incrementality factors of the settings: with none set a channel counts as platform-reported", () => {
    const plain = { ...settings, multipliers: {} };
    expect(METRICS.newPaidIRevenue.value(t, plain)).toBeCloseTo(1400, 6);
    expect(METRICS.paidIRevenue.value(t, plain)).toBeCloseTo(2100, 6);
  });
});
