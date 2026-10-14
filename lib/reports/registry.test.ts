import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getReport, REPORTS } from "./registry";

const router = readFileSync(path.resolve(__dirname, "../../components/reports/ReportRouter.tsx"), "utf8");
const status = (slug: string) => getReport(slug)?.status;

describe("report registry", () => {
  it("has unique slugs", () => {
    const slugs = REPORTS.map((r) => r.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("only marks a report ready when the router has a page for it", () => {
    const missing = REPORTS.filter((r) => r.status === "ready" && !router.includes(`case "${r.slug}":`)).map((r) => r.slug);
    expect(missing).toEqual([]);
  });

  it("marks the four new reports and the existing ones ready", () => {
    for (const slug of ["contribution-margin", "revenue-overview", "new-vs-returning", "aov-histogram", "mer", "pnl", "ads", "first-product"]) expect(status(slug)).toBe("ready");
  });

  it("lists Best Creatives, ready, in the Recommended and Visitor groups, right after Paid Media Overview", () => {
    const def = getReport("best-creatives")!;
    expect(def.status).toBe("ready");
    expect(def.title).toBe("Best Creatives");
    expect(def.categories).toEqual(["Recommended", "Visitor"]);
    const slugs = REPORTS.map((r) => r.slug);
    expect(slugs.indexOf("best-creatives")).toBe(slugs.indexOf("ads") + 1);
  });

  it("marks reports without a page as planned", () => {
    for (const slug of ["facebook-tracker", "google-tracker", "total-net-customer", "variable-costs", "calendar", "ltv-dashboard", "revenue-over-time", "net-active-customers"]) expect(status(slug)).toBe("planned");
  });

  it("keeps reports that wait for a data source as waiting", () => {
    expect(status("email-metrics")).toBe("waiting");
  });
});
