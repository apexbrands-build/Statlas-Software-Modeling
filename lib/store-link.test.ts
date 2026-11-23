import { describe, expect, it } from "vitest";
import { isRecentShopifyRequest, signStoreLink, storeLinkQuery, verifyStoreLink, STORE_LINK_TTL_MS } from "./store-link";

const secret = "test-secret";
const now = Date.UTC(2026, 10, 23, 12, 0, 0);

describe("store link", () => {
  it("accepts a link it signed, for the same store", () => {
    const link = signStoreLink("v2mhrj-xn.myshopify.com", secret, now);
    expect(verifyStoreLink(link, secret, now + 60_000)).toBe("v2mhrj-xn.myshopify.com");
  });
  it("rejects a link for another store", () => {
    const link = signStoreLink("a-store.myshopify.com", secret, now);
    expect(verifyStoreLink({ ...link, shop: "b-store.myshopify.com" }, secret, now)).toBeNull();
  });
  it("rejects an expired link", () => {
    const link = signStoreLink("a-store.myshopify.com", secret, now);
    expect(verifyStoreLink(link, secret, now + STORE_LINK_TTL_MS + 1000)).toBeNull();
  });
  it("rejects a pushed-out expiry, a wrong secret and missing fields", () => {
    const link = signStoreLink("a-store.myshopify.com", secret, now);
    expect(verifyStoreLink({ ...link, exp: String(Number(link.exp) + 3600) }, secret, now)).toBeNull();
    expect(verifyStoreLink(link, "other", now)).toBeNull();
    expect(verifyStoreLink({ shop: link.shop, exp: link.exp, sig: null }, secret, now)).toBeNull();
  });
  it("rejects a shop that is not a myshopify domain", () => {
    const link = signStoreLink("evil.com", secret, now);
    expect(verifyStoreLink(link, secret, now)).toBeNull();
  });
  it("builds the query string for links", () => {
    const link = signStoreLink("a-store.myshopify.com", secret, now);
    const q = new URLSearchParams(storeLinkQuery(link));
    expect(verifyStoreLink({ shop: q.get("shop"), exp: q.get("exp"), sig: q.get("sig") }, secret, now)).toBe("a-store.myshopify.com");
  });
});

describe("Shopify's signed app-URL request", () => {
  it("counts as recent within a day of its timestamp only", () => {
    const sec = String(now / 1000);
    expect(isRecentShopifyRequest(sec, now + 60_000)).toBe(true);
    expect(isRecentShopifyRequest(sec, now + 25 * 60 * 60 * 1000)).toBe(false);
    expect(isRecentShopifyRequest(undefined, now)).toBe(false);
    expect(isRecentShopifyRequest("abc", now)).toBe(false);
  });
});
