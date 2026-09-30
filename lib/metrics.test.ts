import { describe, expect, it } from "vitest";
import { addYears, comparisonRange, diffDays } from "./dates";
import { aggregate, channelGroups, channelMetricDefs, cmParts, compare, METRICS } from "./metrics";
import { SeedRepository } from "./repository/seed";
import { markFirstOrders } from "./sync/first-orders";
import type { ChannelKey, ClientSettings, DailyFact } from "./types";
import { CHANNEL_KEYS } from "./types";

const settings: ClientSettings = {
  clientId: "t",
  multipliers: { google_nonbrand: 0.75, google_brand: 0.3, meta_acquisition: 1.2, meta_returning: 0.6, pinterest: 0.3 },
  otherVariablePct: 10,
  deliveryCostPerOrder: 2,
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
  it("= (net sales + shipping) - COGS - ad spend - cost of delivery; no fixed costs", () => {
    const t = aggregate([fact({}, { meta_acquisition: { spend: 150 } })]);
    const p = cmParts(t, settings);
    // revenue = 1000 + 60 = 1060; delivery = 10% of 1060 + 2*15 = 136; CM = 1060 - 200 - 150 - 136 = 574
    expect(p.shipping).toBe(60);
    expect(p.costOfDelivery).toBeCloseTo(136);
    expect(p.cm).toBeCloseTo(574);
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

describe("new vs returning classification", () => {
  const o = (orderId: string, customerId: string | null, createdAt: string, life: number | null) => ({ orderId, customerId, createdAt, customerLifetimeOrders: life });
  it("guest orders are new; repeat orders in the window are returning", () => {
    const r = markFirstOrders([o("1", null, "2026-09-01", null), o("2", "c", "2026-09-02", 2), o("3", "c", "2026-09-05", 2)]);
    expect(r.get("1")).toBe(true);
    expect(r.get("2")).toBe(true);
    expect(r.get("3")).toBe(false);
  });
  it("a customer with orders before the window is returning", () => {
    // lifetime 3 orders, only 1 inside the window => 2 earlier orders
    const r = markFirstOrders([o("9", "old", "2026-09-10", 3)]);
    expect(r.get("9")).toBe(false);
  });
  it("without lifetime counts it falls back to the window", () => {
    const r = markFirstOrders([o("a", "x", "2026-09-01", null), o("b", "x", "2026-09-03", null)]);
    expect(r.get("a")).toBe(true);
    expect(r.get("b")).toBe(false);
  });
});
