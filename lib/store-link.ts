import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * A short-lived signed link to one store's own page (/shopify/store). It is issued right after Shopify's OAuth install, or when
 * Shopify opens the app from the store admin with its own signed request, so a merchant (or an App Store reviewer) sees their
 * store's numbers without an Apex account. Holding the link proves Shopify sent this browser for that store.
 */
export const STORE_LINK_TTL_MS = 12 * 60 * 60 * 1000;

export interface StoreLink {
  shop: string;
  exp: string;
  sig: string;
}

const SHOP = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;
const sign = (shop: string, exp: string, secret: string) => createHmac("sha256", secret).update(`apex-store:${shop}:${exp}`).digest("hex");

export function signStoreLink(shop: string, secret: string, now: number = Date.now()): StoreLink {
  const exp = String(Math.floor((now + STORE_LINK_TTL_MS) / 1000));
  return { shop, exp, sig: sign(shop, exp, secret) };
}

/** The store's domain when the link is genuine and still valid, otherwise null. */
export function verifyStoreLink(link: { shop?: string | null; exp?: string | null; sig?: string | null }, secret: string, now: number = Date.now()): string | null {
  const { shop, exp, sig } = link;
  if (!shop || !exp || !sig || !SHOP.test(shop) || !/^\d+$/.test(exp)) return null;
  if (Number(exp) * 1000 < now) return null;
  const expected = Buffer.from(sign(shop, exp, secret));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given) ? shop : null;
}

export function storeLinkQuery(link: StoreLink): string {
  return new URLSearchParams({ shop: link.shop, exp: link.exp, sig: link.sig }).toString();
}

/** Shopify's signed requests to the app URL carry a `timestamp` in seconds; only a recent one may open a store link (an old signed URL can't). */
export function isRecentShopifyRequest(timestamp: string | null | undefined, now: number = Date.now()): boolean {
  if (!timestamp || !/^\d+$/.test(timestamp)) return false;
  return Math.abs(now - Number(timestamp) * 1000) < 24 * 60 * 60 * 1000;
}
