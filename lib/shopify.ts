import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

export const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION ?? "2025-10";
/** Read-only scopes. read_all_orders needs Shopify approval; add it once granted (needed for orders older than 60 days). */
export const SHOPIFY_SCOPES = `read_orders,read_customers,read_products,read_inventory${process.env.SHOPIFY_ALL_ORDERS === "true" ? ",read_all_orders" : ""}`;

export const SHOP_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;

export function normalizeShop(input: string): string | null {
  const s = input.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  return SHOP_RE.test(s) ? s : null;
}

/** Verifies the HMAC Shopify appends to the OAuth callback. */
export function verifyShopifyHmac(params: URLSearchParams, secret: string): boolean {
  const hmac = params.get("hmac");
  if (!hmac) return false;
  const message = [...params.entries()]
    .filter(([k]) => k !== "hmac")
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const digest = createHmac("sha256", secret).update(message).digest("hex");
  const a = Buffer.from(digest);
  const b = Buffer.from(hmac);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Verifies X-Shopify-Hmac-Sha256 on a webhook: base64 HMAC-SHA256 of the raw body with the app's client secret. */
export function verifyWebhookHmac(rawBody: string, header: string | null, secret: string): boolean {
  if (!header) return false;
  const digest = createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");
  const a = Buffer.from(digest);
  const b = Buffer.from(header);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** True when every scope in `required` is present in `granted` (both comma-separated). */
export function scopesCover(granted: string | null | undefined, required: string): boolean {
  const have = new Set((granted ?? "").split(",").map((s) => s.trim()).filter(Boolean));
  return required.split(",").every((s) => have.has(s.trim()));
}

export async function shopifyGraphql<T>(shop: string, token: string, query: string, variables?: Record<string, unknown>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await shopifyGraphqlOnce<T>(shop, token, query, variables);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (attempt < 5 && (msg.includes("THROTTLED") || msg.includes("Shopify 429") || msg.includes("Shopify 503"))) {
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
        continue;
      }
      throw e;
    }
  }
}

async function shopifyGraphqlOnce<T>(shop: string, token: string, query: string, variables?: Record<string, unknown>): Promise<T> {
  const res = await fetch(`https://${shop}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`Shopify ${res.status}`);
  const json = (await res.json()) as { data?: T; errors?: unknown };
  if (json.errors || !json.data) throw new Error(`Shopify GraphQL error: ${JSON.stringify(json.errors)}`);
  return json.data;
}
