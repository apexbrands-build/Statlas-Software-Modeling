import { describe, expect, it } from "vitest";
import { isDtcChannel } from "./dtc";

const configured = new Set(["online store", "shop"]);

describe("isDtcChannel", () => {
  it("uses the configured list on a live store", () => {
    expect(isDtcChannel("Online Store", configured, false)).toBe(true);
    expect(isDtcChannel("Draft Orders", configured, false)).toBe(false);
  });
  it("counts every channel but Point of Sale on a development store", () => {
    expect(isDtcChannel("Draft Orders", configured, true)).toBe(true);
    expect(isDtcChannel("Shopify Admin", configured, true)).toBe(true);
    expect(isDtcChannel("Point of Sale", configured, true)).toBe(false);
  });
});
