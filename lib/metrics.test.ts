import { describe, expect, it } from "vitest";
import { addYears, comparisonRange, diffDays } from "./dates";
import { aggregate, channelGroups, channelMetricDefs, cmParts, compare, METRICS } from "./metrics";
import { SeedRepository } from "./repository/seed";
import type { ChannelKey, ClientSettings, DailyFact } from "./types";
import { CHANNEL_KEYS } from "./types";

const settings: ClientSettings = {
  clientId: "t",
  multipliers: { google_nonbrand: 0.75, google_brand: 0.3, meta_acquisition: 1.2, meta_returning: 0.6, pinterest: 0.3 },
  otherVariablePct: 10,
  shippingCostPerOrder: 2,
  monthlyFixedCosts: 3650,
  attributionWindow: "7d_click",
  revenueDefinition: "order_revenue",
  brandCampaignKeyword: "branded",
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
    netSales: 1000,
    shippingCollected: 60,
    tax: 100,
    newOrderRevenue: 700,
    returningOrderRevenue: 460,
    newOrders: 10,
    returningOrders: 5,
    refunds: 80,
    cogs: 200,
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
  it("= net sales - refunds - shipping cost - COGS - other variable - ad spend", () => {
    const t = aggregate([fact({}, { meta_acquisition: { spend: 150 } })]);
    const p = cmParts(t, settings);
    // 1000 - 80 - (2*15) - 200 - (10% of 1000) - 150 = 440
    expect(p.shippingCost).toBe(30);
    expect(p.otherVariable).toBe(100);
    expect(p.cm).toBe(440);
    // fixed costs 3650/mo * 12 / 365 = 120 per day
    expect(p.fixedCosts).toBeCloseTo(120);
    expect(p.cmAfterFixed).toBeCloseTo(320);
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
    const google = channelMetricDefs(channelGroups(true)[0]);
    const iRev = google.find((m) => m.key.endsWith(".irev"))!;
    const iRoas = google.find((m) => m.key.endsWith(".iroas"))!;
    expect(iRev.value(t, settings)).toBeCloseTo(80 * 0.75);
    expect(iRoas.value(t, settings)).toBeCloseTo((80 * 0.75) / 20);
    // Paid iRevenue = 60 + 30 + 168
    expect(METRICS.paidIRevenue.value(t, settings)).toBeCloseTo(60 + 30 + 168);
    expect(METRICS.ipaMer.value(t, settings)).toBeCloseTo(258 / 100);
  });

  it("merging channels blends the multiplier", () => {
    const googleMerged = channelMetricDefs(channelGroups(false)[0]);
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
  it("higher-is-better metrics", () => {
    expect(compare(110, 100, "up").tone).toBe("good");
    expect(compare(90, 100, "up").tone).toBe("bad");
  });
  it("lower-is-better metrics", () => {
    expect(compare(90, 100, "down").tone).toBe("good");
    expect(compare(110, 100, "down").tone).toBe("bad");
  });
  it("spend is bad only when >10% over plan", () => {
    expect(compare(108, 100, "spend").tone).toBe("good");
    expect(compare(115, 100, "spend").tone).toBe("bad");
  });
  it("tiny differences are neutral; missing reference has no diff", () => {
    expect(compare(100.5, 100, "up").tone).toBe("neutral");
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
});

describe("seed repository", () => {
  it("is deterministic and internally consistent", async () => {
    const repo = new SeedRepository();
    const a = await repo.getFacts("northwind", "2025-03-01", "2025-03-10");
    const b = await repo.getFacts("northwind", "2025-03-01", "2025-03-10");
    expect(a).toEqual(b);
    expect(a).toHaveLength(10);
    for (const f of a) {
      expect(f.netSales + f.shippingCollected + f.tax).toBeCloseTo(f.newOrderRevenue + f.returningOrderRevenue);
    }
  });
  it("plan targets satisfy revenue = new + returning", async () => {
    const repo = new SeedRepository();
    const rows = await repo.getPlanTargets("kettle", "kettle-2026-official", "2026-01-01", "2026-01-31");
    expect(rows).toHaveLength(31);
    for (const r of rows) expect(r.orderRevenue).toBeCloseTo(r.newRevenue + r.returningRevenue);
  });
});
