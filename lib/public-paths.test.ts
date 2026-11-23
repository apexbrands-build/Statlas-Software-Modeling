import { describe, expect, it } from "vitest";
import { isBarePage } from "./public-paths";

describe("pages shown without the Apex sidebar", () => {
  it("covers the Shopify pages, the store page included, and the policy pages", () => {
    for (const p of ["/shopify", "/shopify/store", "/privacy", "/support"]) expect(isBarePage(p)).toBe(true);
  });
  it("keeps the sidebar everywhere else", () => {
    for (const p of ["/", "/settings", "/reporting", "/shopifyx", "/login"]) expect(isBarePage(p)).toBe(false);
  });
});
