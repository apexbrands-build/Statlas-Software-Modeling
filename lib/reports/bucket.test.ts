import { describe, expect, it } from "vitest";
import { addDays } from "../dates";
import { emptyTotals } from "../metrics";
import type { DailyFact } from "../types";
import { bucketFacts, clipToLastData } from "./bucket";

const day = (date: string, rev: number): DailyFact => ({
  clientId: "c", date, grossSales: rev, discounts: 0, netSales: rev, shippingCollected: 0, tax: 0, newOrderRevenue: rev, returningOrderRevenue: 0, newOrders: 1, returningOrders: 0, refunds: 0, cogs: 0, cogsUnmappedSales: 0, emailRevenue: 0, emailCampaignRevenue: 0, emailFlowRevenue: 0, emailOrders: 0, emailSent: 0, channels: emptyTotals().channels,
});

describe("bucketFacts", () => {
  it("groups days, aggregates each bucket and totals everything, in date order", () => {
    const facts = [day("2026-09-09", 30), day("2026-09-07", 10), day("2026-09-08", 20), day("2026-09-14", 5)];
    const r = bucketFacts(facts, "weekly");
    expect(r.buckets.map((b) => b.key)).toEqual(["2026-09-07", "2026-09-14"]);
    expect(r.buckets[0].totals.newOrderRevenue).toBe(60);
    expect(r.buckets[1].totals.newOrderRevenue).toBe(5);
    expect(r.total.newOrderRevenue).toBe(65);
    expect(r.total.days).toBe(4);
  });

  it("returns daily buckets one per day", () => {
    const facts = Array.from({ length: 3 }, (_, i) => day(addDays("2026-09-01", i), 1));
    expect(bucketFacts(facts, "daily").buckets).toHaveLength(3);
  });

  it("returns no buckets and zero totals for no facts", () => {
    const r = bucketFacts([], "monthly");
    expect(r.buckets).toEqual([]);
    expect(r.total.days).toBe(0);
    expect(r.total.newOrderRevenue).toBe(0);
  });
});

describe("clipToLastData", () => {
  it("drops days after the last day with data, so a report equals Home when ad-spend syncs run ahead of the Shopify rollup", () => {
    const facts = [day("2026-10-09", 1), day("2026-10-10", 1), day("2026-10-11", 1)];
    expect(clipToLastData(facts, "2026-10-10").map((f) => f.date)).toEqual(["2026-10-09", "2026-10-10"]);
  });

  it("keeps every day when the last data day is later, and none when it is earlier", () => {
    const facts = [day("2026-10-09", 1), day("2026-10-10", 1)];
    expect(clipToLastData(facts, "2026-10-31")).toHaveLength(2);
    expect(clipToLastData(facts, "2026-10-01")).toEqual([]);
  });
});
