import { describe, expect, it } from "vitest";
import { rolledUp, seriesOf, totalsOf, withRollups } from "./channel-metrics";
import type { ChannelSale } from "./types";

const row = (date: string, over: Partial<ChannelSale> = {}): ChannelSale => ({ date, channel: "amazon", retailer: "", revenue: 100, orders: 4, units: 5, adSpend: 10, source: "import", ...over });

describe("withRollups", () => {
  it("makes Amazon's ad spend and ad sales the sum of the ad types that are loaded", () => {
    const r = withRollups("amazon", row("2026-11-01", { adSpend: 0, metrics: { sp_spend: 7, sb_spend: 2, sd_spend: 1, sp_sales: 30, sb_sales: 8 } }));
    expect(r.adSpend).toBe(10);
    expect(r.metrics?.ad_sales).toBe(38);
  });
  it("leaves ad sales alone when only spend is split by type", () => {
    const r = withRollups("amazon", row("2026-11-01", { adSpend: 99, metrics: { sp_spend: 7, ad_sales: 50 } }));
    expect(r.adSpend).toBe(7);
    expect(r.metrics?.ad_sales).toBe(50);
  });
  it("changes nothing when no ad type is loaded, or on a platform without ad types", () => {
    const plain = row("2026-11-01", { metrics: { sessions: 40 } });
    expect(withRollups("amazon", plain)).toEqual(plain);
    const old = row("2026-11-01");
    expect(withRollups("amazon", old)).toEqual(old);
    const tts = row("2026-11-01", { channel: "tiktok_shop", metrics: { sp_spend: 5 } });
    expect(withRollups("tiktok_shop", tts)).toEqual(tts);
  });
});

describe("totalsOf", () => {
  const sales: ChannelSale[] = [
    row("2026-10-31", { metrics: { sessions: 1000 } }),
    row("2026-11-01", { metrics: { sessions: 40, active_subscriptions: 100 } }),
    row("2026-11-02", { metrics: { sessions: 60 } }),
    row("2026-11-03", { metrics: { active_subscriptions: 120 } }),
    row("2026-11-02", { channel: "tiktok_shop", revenue: 999 }),
  ];
  it("adds up the days of the range for this channel only", () => {
    const t = totalsOf("amazon", sales, "amazon", "2026-11-01", "2026-11-03");
    expect(t.revenue).toBe(300);
    expect(t.orders).toBe(12);
    expect(t.units).toBe(15);
    expect(t.adSpend).toBe(30);
    expect(t.m.sessions).toBe(100);
    expect(t.days).toBe(3);
    expect(t.lastData).toBe("2026-11-03");
  });
  it("takes the latest day that carries a metric of the 'latest' kind", () => {
    expect(totalsOf("amazon", sales, "amazon", "2026-11-01", "2026-11-03").m.active_subscriptions).toBe(120);
    expect(totalsOf("amazon", sales, "amazon", "2026-11-01", "2026-11-02").m.active_subscriptions).toBe(100);
  });
  it("averages a daily count over the days that carry it, not over every day", () => {
    const tts: ChannelSale[] = [
      row("2026-11-01", { channel: "tiktok_shop", metrics: { creators_with_sales: 10 } }),
      row("2026-11-02", { channel: "tiktok_shop", metrics: { creators_with_sales: 20 } }),
      row("2026-11-03", { channel: "tiktok_shop" }),
    ];
    expect(totalsOf("tiktok_shop", tts, "tiktok_shop", "2026-11-01", "2026-11-03").m.creators_with_sales).toBe(15);
  });
  it("adds the retailers of a day together and counts the day once", () => {
    const two = [row("2026-11-01", { retailer: "A" }), row("2026-11-01", { retailer: "B" })];
    const t = totalsOf("other", two, "amazon", "2026-11-01", "2026-11-01");
    expect(t.revenue).toBe(200);
    expect(t.days).toBe(1);
  });
  it("uses the ad types for ad spend when they are loaded", () => {
    const typed = [row("2026-11-01", { adSpend: 0, metrics: { sp_spend: 6, sb_spend: 4, sp_sales: 20 } })];
    const t = totalsOf("amazon", typed, "amazon", "2026-11-01", "2026-11-01");
    expect(t.adSpend).toBe(10);
    expect(t.m.ad_sales).toBe(20);
  });
  it("is empty for a range with no rows", () => {
    const t = totalsOf("amazon", sales, "amazon", "2027-01-01", "2027-01-31");
    expect(t).toEqual({ revenue: 0, orders: 0, units: 0, adSpend: 0, m: {}, days: 0, lastData: null });
  });
});

describe("seriesOf", () => {
  const sales: ChannelSale[] = ["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-09", "2026-12-01"].map((d) => row(d, { metrics: { sessions: 10 } }));
  it("gives one period per day of the range, empty ones included", () => {
    const s = seriesOf("amazon", sales, "amazon", "2026-11-01", "2026-11-04", "day");
    expect(s.keys).toEqual(["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04"]);
    expect(s.rows.map((r) => r.revenue)).toEqual([100, 100, 100, 0]);
  });
  it("groups weeks from Monday and names each week by its Monday", () => {
    // 2026-11-01 is a Sunday: it is the last day of the week that began on Monday 2026-10-26.
    const s = seriesOf("amazon", sales, "amazon", "2026-11-01", "2026-11-09", "week");
    expect(s.keys).toEqual(["2026-10-26", "2026-11-02", "2026-11-09"]);
    expect(s.rows.map((r) => r.revenue)).toEqual([100, 200, 100]);
  });
  it("groups months, and the periods add up to the range", () => {
    const s = seriesOf("amazon", sales, "amazon", "2026-11-01", "2026-12-31", "month");
    expect(s.keys).toEqual(["2026-11", "2026-12"]);
    expect(s.rows.map((r) => r.revenue)).toEqual([400, 100]);
    const whole = totalsOf("amazon", sales, "amazon", "2026-11-01", "2026-12-31");
    expect(s.rows.reduce((a, r) => a + r.revenue, 0)).toBe(whole.revenue);
    expect(s.rows.reduce((a, r) => a + (r.m.sessions ?? 0), 0)).toBe(whole.m.sessions);
  });
});

describe("rolledUp", () => {
  it("reads each row the way its own channel's platform means it", () => {
    const rows = [row("2026-11-01", { adSpend: 0, metrics: { sp_spend: 7 } }), row("2026-11-01", { channel: "tiktok_shop", adSpend: 3, metrics: { sp_spend: 7 } }), row("2026-11-01", { channel: "gone", adSpend: 1 })];
    const out = rolledUp(rows, [
      { key: "amazon", label: "Amazon", kind: "marketplace" },
      { key: "tiktok_shop", label: "TikTok Shop", kind: "marketplace" },
    ]);
    expect(out.map((r) => r.adSpend)).toEqual([7, 3, 1]);
  });
});
