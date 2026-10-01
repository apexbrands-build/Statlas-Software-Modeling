import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { scopesCover, verifyWebhookHmac, verifyShopifyHmac } = await import("./shopify");

describe("shopify helpers", () => {
  const secret = "shhh";
  it("verifies webhook signatures (base64 HMAC of the raw body)", () => {
    const body = '{"shop_id":1}';
    const good = createHmac("sha256", secret).update(body).digest("base64");
    expect(verifyWebhookHmac(body, good, secret)).toBe(true);
    expect(verifyWebhookHmac(body + " ", good, secret)).toBe(false);
    expect(verifyWebhookHmac(body, null, secret)).toBe(false);
  });
  it("verifies the signed query string Shopify sends to the app URL", () => {
    const msg = "shop=a.myshopify.com&timestamp=1";
    const hmac = createHmac("sha256", secret).update(msg).digest("hex");
    expect(verifyShopifyHmac(new URLSearchParams(`timestamp=1&shop=a.myshopify.com&hmac=${hmac}`), secret)).toBe(true);
    expect(verifyShopifyHmac(new URLSearchParams(`timestamp=2&shop=a.myshopify.com&hmac=${hmac}`), secret)).toBe(false);
  });
  it("checks that granted scopes cover the required ones", () => {
    expect(scopesCover("read_orders,read_products", "read_orders,read_products")).toBe(true);
    expect(scopesCover("read_orders", "read_orders,read_products")).toBe(false);
    expect(scopesCover(null, "read_orders")).toBe(false);
  });
});
