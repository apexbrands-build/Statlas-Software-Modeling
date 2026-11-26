import { describe, expect, it } from "vitest";
import { CATALOG, metricInfo, metricValue, platformOf, type Platform, type Totals } from "./metrics";

const t = (core: Partial<Omit<Totals, "m">>, m: Record<string, number> = {}): Totals => ({ revenue: 0, orders: 0, units: 0, adSpend: 0, ...core, m });

describe("platformOf", () => {
  it("uses the platform saved on the channel", () => {
    expect(platformOf({ key: "x", label: "Marketplace A", kind: "marketplace", platform: "tiktok_shop" })).toBe("tiktok_shop");
  });
  it("recognises a channel saved before platforms existed by its name", () => {
    expect(platformOf({ key: "amazon", label: "Amazon US", kind: "marketplace" })).toBe("amazon");
    expect(platformOf({ key: "tiktok_shop", label: "TikTok Shop", kind: "marketplace" })).toBe("tiktok_shop");
    expect(platformOf({ key: "tts", label: "Tik Tok shop", kind: "marketplace" })).toBe("tiktok_shop");
  });
  it("treats a retail channel as retail and anything else as other", () => {
    expect(platformOf({ key: "stores", label: "Stores", kind: "retail" })).toBe("retail");
    expect(platformOf({ key: "retail_amazon_fresh", label: "Retail (Amazon Fresh)", kind: "retail" })).toBe("retail");
    expect(platformOf({ key: "faire", label: "Faire", kind: "marketplace" })).toBe("other");
  });
});

describe("Amazon metrics", () => {
  const totals = t({ revenue: 1000, orders: 40, units: 50, adSpend: 100 }, { ad_sales: 400, sessions: 250, page_views: 1000, buy_box_views: 980, units_refunded: 2, sp_spend: 70, sp_sales: 300 });
  it("total ACOS is ad spend over all sales, ACOS is ad spend over ad sales", () => {
    expect(metricValue("amazon", "tacos", totals)).toBeCloseTo(0.1);
    expect(metricValue("amazon", "acos", totals)).toBeCloseTo(0.25);
    expect(metricValue("amazon", "sp_acos", totals)).toBeCloseTo(70 / 300);
  });
  it("organic sales are all sales minus ad sales", () => {
    expect(metricValue("amazon", "organic_sales", totals)).toBe(600);
    expect(metricValue("amazon", "ad_share", totals)).toBeCloseTo(0.4);
  });
  it("conversion is units over sessions, and empty with no sessions", () => {
    expect(metricValue("amazon", "conversion", totals)).toBeCloseTo(0.2);
    expect(metricValue("amazon", "conversion", t({ units: 5 }))).toBeNull();
  });
  it("Buy Box % is weighted by page views", () => {
    expect(metricValue("amazon", "buy_box_pct", totals)).toBeCloseTo(0.98);
  });
  it("reads stored and core values by key", () => {
    expect(metricValue("amazon", "sessions", totals)).toBe(250);
    expect(metricValue("amazon", "revenue", totals)).toBe(1000);
    expect(metricValue("amazon", "sns_sales", totals)).toBeNull();
    expect(metricValue("amazon", "no_such_metric", totals)).toBeNull();
  });
  it("names the core numbers the way the platform does", () => {
    expect(metricInfo("amazon", "revenue")?.label).toBe("Ordered product sales");
    expect(metricInfo("tiktok_shop", "revenue")?.label).toBe("GMV");
    expect(metricInfo("amazon", "tacos")?.better).toBe("down");
    expect(metricInfo("amazon", "nope")).toBeNull();
  });
});

describe("TikTok Shop metrics", () => {
  const totals = t({ revenue: 2000, orders: 80, units: 100, adSpend: 100 }, { ads_gmv: 500, ads_orders: 20, affiliate_gmv: 1200, affiliate_commission: 180, refunds: 100, visitors: 4000 });
  it("shop ads ROI is their gross revenue over their cost", () => {
    expect(metricValue("tiktok_shop", "ads_roi", totals)).toBe(5);
    expect(metricValue("tiktok_shop", "ads_cost_share", totals)).toBeCloseTo(0.05);
    expect(metricValue("tiktok_shop", "cost_per_order", totals)).toBe(5);
  });
  it("shows what is left after refunds, the affiliate share and the commission rate", () => {
    expect(metricValue("tiktok_shop", "net_gmv", totals)).toBe(1900);
    expect(metricValue("tiktok_shop", "affiliate_share", totals)).toBeCloseTo(0.6);
    expect(metricValue("tiktok_shop", "commission_rate", totals)).toBeCloseTo(0.15);
    expect(metricValue("tiktok_shop", "conversion", totals)).toBeCloseTo(0.02);
  });
});

describe("catalog", () => {
  const platforms = Object.keys(CATALOG) as Platform[];
  it("has no key twice on a platform, and never reuses a core name", () => {
    for (const p of platforms) {
      const keys = [...CATALOG[p].stored.map((m) => m.key), ...CATALOG[p].derived.map((m) => m.key)];
      expect(new Set(keys).size).toBe(keys.length);
      for (const core of ["revenue", "orders", "units", "adSpend", "date", "retailer"]) expect(keys).not.toContain(core);
    }
  });
  it("has lower-case column names that point to one metric only", () => {
    for (const p of platforms) {
      const c = CATALOG[p];
      const all = [...Object.values(c.coreAliases).flat(), ...c.stored.flatMap((m) => m.aliases)];
      for (const a of all) expect(a).toBe(a.toLowerCase());
      expect(new Set(all).size).toBe(all.length);
    }
  });
  it("rolls up only stored metrics, into ad spend or a stored metric", () => {
    for (const p of platforms) {
      const stored = new Set(CATALOG[p].stored.map((m) => m.key));
      for (const r of CATALOG[p].rollups) {
        expect(r.target === "adSpend" || stored.has(r.target)).toBe(true);
        for (const k of r.parts) expect(stored.has(k)).toBe(true);
      }
    }
    expect(CATALOG.amazon.rollups.find((r) => r.target === "adSpend")?.parts).toEqual(["sp_spend", "sb_spend", "sd_spend"]);
    expect(CATALOG.retail.stored).toEqual([]);
    expect(CATALOG.other.rollups).toEqual([]);
  });
});
