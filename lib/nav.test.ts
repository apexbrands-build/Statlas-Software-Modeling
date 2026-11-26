import { describe, expect, it } from "vitest";
import { isNavActive, isTrackerPath } from "./nav";

describe("sidebar: which entry is lit", () => {
  it("lights Home only on Home", () => {
    expect(isNavActive("/", "/")).toBe(true);
    expect(isNavActive("/", "/reporting")).toBe(false);
  });
  it("lights Trackers on every tracker page, and Reporting on the other reports", () => {
    expect(isTrackerPath("/reporting/google-tracker")).toBe(true);
    expect(isNavActive("/reporting/facebook-tracker", "/reporting/google-tracker")).toBe(true);
    expect(isNavActive("/reporting", "/reporting/google-tracker")).toBe(false);
    expect(isNavActive("/reporting", "/reporting/pnl")).toBe(true);
    expect(isNavActive("/reporting/facebook-tracker", "/reporting/pnl")).toBe(false);
    expect(isNavActive("/planning", "/planning/abc")).toBe(true);
  });
});
