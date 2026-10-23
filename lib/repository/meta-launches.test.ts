import { describe, expect, it } from "vitest";
import { demoMetaLaunches, mapMetaLaunches } from "./meta-launches";

describe("mapMetaLaunches", () => {
  it("drops catalog ads, dedupes ads of one campaign on a day and names an unnamed campaign", () => {
    const out = mapMetaLaunches([
      { campaign_name: "UK12 | ABO", created_at: "2026-01-06T09:30:00+0000", is_catalog: false },
      { campaign_name: "UK12 | ABO", created_at: "2026-01-06T17:00:00+0000", is_catalog: false },
      { campaign_name: "Catalog DPA", created_at: "2026-01-06T10:00:00+0000", is_catalog: true },
      { campaign_name: "", created_at: "2026-01-03T10:00:00+0000", is_catalog: false },
      { campaign_name: "No date", created_at: null, is_catalog: false },
    ]);
    expect(out).toEqual([
      { date: "2026-01-03", campaign: "Unnamed campaign" },
      { date: "2026-01-06", campaign: "UK12 | ABO" },
    ]);
  });
});

describe("mapMetaLaunches in the store's time zone", () => {
  it("puts a 19:00 Pacific launch on its own day, not on the next UTC day", () => {
    const rows = [{ campaign_name: "US11", created_at: "2026-01-07T03:00:00+00:00", is_catalog: false }];
    expect(mapMetaLaunches(rows, "America/Los_Angeles")).toEqual([{ date: "2026-01-06", campaign: "US11" }]);
    expect(mapMetaLaunches(rows)).toEqual([{ date: "2026-01-07", campaign: "US11" }]);
  });

  it("keeps only launches whose store day is inside the range", () => {
    const rows = [
      { campaign_name: "edge-in", created_at: "2026-01-01T02:00:00+00:00", is_catalog: false }, // Dec 31 in Los Angeles
      { campaign_name: "inside", created_at: "2026-01-02T15:00:00+00:00", is_catalog: false },
    ];
    expect(mapMetaLaunches(rows, "America/Los_Angeles", { from: "2026-01-01", to: "2026-01-31" })).toEqual([{ date: "2026-01-02", campaign: "inside" }]);
  });
});

describe("demoMetaLaunches", () => {
  it("returns a few launches, all inside the asked range", () => {
    const out = demoMetaLaunches({ from: "2026-01-01", to: "2026-01-31" });
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((l) => l.date >= "2026-01-01" && l.date <= "2026-01-31")).toBe(true);
  });
});
