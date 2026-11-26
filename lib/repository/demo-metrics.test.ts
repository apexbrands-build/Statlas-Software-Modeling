import { describe, expect, it } from "vitest";
import { totalsOf } from "../omni/channel-metrics";
import { metricValue } from "../omni/metrics";
import { SeedRepository } from "./seed";

describe("demo data: the other channels carry their platform's numbers", () => {
  it("Amazon: ad types add up to the ad spend, ad sales stay below all sales, traffic is plausible", async () => {
    const rows = (await new SeedRepository().getChannelSales("kettle", "2026-03-01", "2026-03-07")) ?? [];
    const amazon = rows.filter((r) => r.channel === "amazon");
    expect(amazon).toHaveLength(7);
    for (const r of amazon) {
      const m = r.metrics ?? {};
      expect(m.sp_spend + m.sb_spend + m.sd_spend).toBeCloseTo(r.adSpend, 1);
      expect(m.sp_sales + m.sb_sales + m.sd_sales).toBeLessThan(r.revenue);
      expect(m.sessions).toBeGreaterThan(r.units);
      expect(m.buy_box_views).toBeLessThanOrEqual(m.page_views);
      expect(m.sns_sales).toBeLessThan(r.revenue);
    }
    const t = totalsOf("amazon", rows, "amazon", "2026-03-01", "2026-03-07");
    const acos = metricValue("amazon", "acos", t) as number;
    const tacos = metricValue("amazon", "tacos", t) as number;
    expect(acos).toBeGreaterThan(tacos);
    expect(tacos).toBeGreaterThan(0.02);
    expect(tacos).toBeLessThan(0.3);
    expect(metricValue("amazon", "conversion", t) as number).toBeGreaterThan(0.05);
    expect(metricValue("amazon", "conversion", t) as number).toBeLessThan(0.5);
  });
  it("TikTok Shop: sources add up to GMV, and so do the content types", async () => {
    const rows = (await new SeedRepository().getChannelSales("kettle", "2026-03-01", "2026-03-07")) ?? [];
    const tts = rows.filter((r) => r.channel === "tiktok_shop");
    expect(tts).toHaveLength(7);
    for (const r of tts) {
      const m = r.metrics ?? {};
      expect(m.affiliate_gmv + m.seller_gmv).toBeCloseTo(r.revenue, 1);
      expect(m.live_gmv + m.video_gmv + m.card_gmv).toBeCloseTo(r.revenue, 1);
      expect(m.ads_gmv).toBeGreaterThan(r.adSpend);
      expect(m.visitors).toBeGreaterThan(r.orders);
      expect(m.creators_with_sales).toBeGreaterThan(0);
    }
  });
  it("retail keeps to the four core numbers", async () => {
    const rows = (await new SeedRepository().getChannelSales("kettle", "2026-03-01", "2026-03-07")) ?? [];
    for (const r of rows.filter((x) => x.channel === "retail")) expect(r.metrics ?? {}).toEqual({});
  });
});
