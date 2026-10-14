import { describe, expect, it } from "vitest";
import { HOME_REPORT_LINKS, homeReportHref, parseRangeParams } from "./home-links";
import { getReport } from "./registry";

describe("home report links", () => {
  it("only point at reports that exist in the registry", () => {
    for (const slug of Object.values(HOME_REPORT_LINKS)) expect(getReport(slug)).toBeDefined();
  });

  it("link the six core tiles to their reports", () => {
    expect(homeReportHref("cm")).toBe("/reporting/contribution-margin");
    expect(homeReportHref("orderRevenue")).toBe("/reporting/revenue-overview");
    expect(homeReportHref("adSpend")).toBe("/reporting/ads");
    expect(homeReportHref("mer")).toBe("/reporting/mer");
    expect(homeReportHref("aov")).toBe("/reporting/aov-histogram");
    expect(homeReportHref("orders")).toBe("/reporting/new-vs-returning");
  });

  it("links Meta's ROAS tile (merged or split rows) to Best Creatives, carries Home's range, and leaves Meta spend and Meta Returning without a link", () => {
    expect(homeReportHref("meta.iroas")).toBe("/reporting/best-creatives");
    expect(homeReportHref("meta_acquisition.iroas")).toBe("/reporting/best-creatives");
    expect(homeReportHref("meta_acquisition.iroas", { from: "2026-10-01", to: "2026-10-13" })).toBe("/reporting/best-creatives?from=2026-10-01&to=2026-10-13");
    expect(homeReportHref("meta_returning.iroas")).toBeNull();
    expect(homeReportHref("meta_acquisition.spend")).toBeNull();
    expect(homeReportHref("meta.spend")).toBeNull();
  });

  it("shows no link until the report is ready, and none for unmapped metrics", () => {
    expect(homeReportHref("emailRevenue")).toBeNull();
    expect(homeReportHref("organicRevenue")).toBeNull();
    expect(homeReportHref("constructor")).toBeNull();
  });

  it("carries the Home date range in the link", () => {
    expect(homeReportHref("mer", { from: "2026-09-01", to: "2026-09-30" })).toBe("/reporting/mer?from=2026-09-01&to=2026-09-30");
  });
});

describe("parseRangeParams", () => {
  it("accepts a valid range", () => {
    expect(parseRangeParams("2026-09-01", "2026-09-30")).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(parseRangeParams("2026-09-15", "2026-09-15")).toEqual({ from: "2026-09-15", to: "2026-09-15" });
  });

  it("rejects reversed, badly formatted, impossible or missing dates so the report falls back to the current month", () => {
    expect(parseRangeParams("2026-09-30", "2026-09-01")).toBeNull();
    expect(parseRangeParams("2026-9-1", "2026-09-30")).toBeNull();
    expect(parseRangeParams("2026-02-31", "2026-03-05")).toBeNull();
    expect(parseRangeParams("2026-09-01", null)).toBeNull();
    expect(parseRangeParams(null, null)).toBeNull();
    expect(parseRangeParams("", "")).toBeNull();
  });
});
