import { describe, expect, it } from "vitest";
import { AOV_STEPS, buildAovRows, mapAovRows, type AovBucket, type AovData } from "./aov";

const bucket = (i: number, orders: number, revenue: number, low = i * 10, high: number | null = i * 10 + 10): AovBucket => ({ bucket: i, low, high, orders, revenue });
const tenBuckets = (orders: number[]): AovBucket[] => orders.map((o, i) => bucket(i + 1, o, o * 70));

describe("mapAovRows", () => {
  it("turns database strings into numbers and reads excluded from the first bucket row", () => {
    const data = mapAovRows(
      { orders: "4065", revenue: "301680.00", mean: "74.21", median: "60", mode: "38.95" },
      [
        { bucket: 1, low: "27.70", high: "39.70", orders: "750", revenue: "24235.00", excluded: "204" },
        { bucket: 2, low: "39.70", high: "51.70", orders: "687", revenue: "31627.00", excluded: "204" },
      ],
    );
    expect(data.stats).toEqual({ orders: 4065, revenue: 301680, mean: 74.21, median: 60, mode: 38.95 });
    expect(data.buckets[0]).toEqual({ bucket: 1, low: 27.7, high: 39.7, orders: 750, revenue: 24235 });
    expect(data.excluded).toBe(204);
  });

  it("keeps an open-ended last bucket open", () => {
    const data = mapAovRows(undefined, [{ bucket: 5, low: "100", high: null, orders: "3", revenue: "400", excluded: "0" }]);
    expect(data.buckets[0].high).toBeNull();
  });

  it("returns zeros and no buckets when nothing came back", () => {
    expect(mapAovRows(undefined, [])).toEqual({ stats: { orders: 0, revenue: 0, mean: null, median: null, mode: null }, buckets: [], excluded: 0 });
  });
});

describe("buildAovRows", () => {
  const stats = { orders: 4065, revenue: 301680, mean: 74.21, median: 60, mode: 38.95 };

  it("labels ten-bucket modes 10% to 100% and step mode #1, #2...", () => {
    const data: AovData = { stats, buckets: tenBuckets([750, 687, 810, 499, 220, 236, 200, 184, 158, 117]), excluded: 204 };
    expect(buildAovRows(data, "dynamic", "GBP").rows.map((r) => r.nth)).toEqual(["10%", "20%", "30%", "40%", "50%", "60%", "70%", "80%", "90%", "100%"]);
    expect(buildAovRows(data, "complete", "GBP").rows[9].nth).toBe("100%");
    expect(buildAovRows(data, "step", "GBP").rows.slice(0, 2).map((r) => r.nth)).toEqual(["#1", "#2"]);
  });

  it("formats ranges in the client's currency and an open-ended bucket with a plus", () => {
    const data: AovData = { stats, buckets: [bucket(1, 750, 24235, 27.7, 39.7), bucket(2, 5, 700, 100, null)], excluded: 0 };
    const rows = buildAovRows(data, "step", "GBP").rows;
    expect(rows[0].range).toBe("£27.70 to £39.70");
    expect(rows[1].range).toBe("£100.00+");
  });

  it("uses every order in the range as the denominator for both percentages", () => {
    const data: AovData = { stats, buckets: [bucket(1, 750, 24235, 27.7, 39.7)], excluded: 204 };
    const row = buildAovRows(data, "dynamic", "GBP").rows[0];
    expect(row.orders).toBe(750);
    expect(row.ordersPct).toBeCloseTo(750 / 4065, 6);
    expect(row.revenue).toBe(24235);
    expect(row.revenuePct).toBeCloseTo(24235 / 301680, 6);
  });

  it("explains how many orders are outside the charted range, or says nothing when none are", () => {
    const data = (excluded: number): AovData => ({ stats, buckets: [bucket(1, 750, 24235)], excluded });
    expect(buildAovRows(data(204), "dynamic", "GBP").footnote).toBe("204 orders outside the charted range are not shown.");
    expect(buildAovRows(data(1), "dynamic", "GBP").footnote).toBe("1 order outside the charted range is not shown.");
    expect(buildAovRows(data(0), "dynamic", "GBP").footnote).toBeNull();
  });

  it("shows no percentages when the range has no orders", () => {
    const data: AovData = { stats: { orders: 0, revenue: 0, mean: null, median: null, mode: null }, buckets: [bucket(1, 0, 0)], excluded: 0 };
    const row = buildAovRows(data, "complete", "GBP").rows[0];
    expect(row.ordersPct).toBeNull();
    expect(row.revenuePct).toBeNull();
  });

  it("renders a single bucket (one distinct order value) as one row", () => {
    const data: AovData = { stats: { orders: 12, revenue: 600, mean: 50, median: 50, mode: 50 }, buckets: [bucket(1, 12, 600, 50, 50)], excluded: 0 };
    const { rows } = buildAovRows(data, "complete", "GBP");
    expect(rows).toHaveLength(1);
    expect(rows[0].nth).toBe("10%");
    expect(rows[0].ordersPct).toBe(1);
  });
});

describe("AOV_STEPS", () => {
  it("offers 10, 25, 50 and 100", () => expect(AOV_STEPS).toEqual([10, 25, 50, 100]));
});
