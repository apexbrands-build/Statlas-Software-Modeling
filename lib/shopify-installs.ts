import "server-only";
import { decrypt, encrypt } from "@/lib/crypto";
import { SHOPIFY_API_VERSION, shopifyGraphql } from "@/lib/shopify";
import { getAdminClient } from "@/lib/supabase/server";

/** What we store (encrypted) per install. Public apps get expiring offline tokens: 1 hour access token + 90 day refresh token. */
export interface ShopifyTokens {
  access_token: string;
  scope: string;
  apiVersion?: string;
  expires_at?: string;
  refresh_token?: string;
  refresh_expires_at?: string;
}

interface TokenResponse {
  access_token: string;
  scope: string;
  expires_in?: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
}

const inSeconds = (n: number) => new Date(Date.now() + n * 1000).toISOString();

export function tokensFromResponse(r: TokenResponse): ShopifyTokens {
  return {
    access_token: r.access_token,
    scope: r.scope,
    apiVersion: SHOPIFY_API_VERSION,
    expires_at: r.expires_in ? inSeconds(r.expires_in) : undefined,
    refresh_token: r.refresh_token,
    refresh_expires_at: r.refresh_token_expires_in ? inSeconds(r.refresh_token_expires_in) : undefined,
  };
}

/** Trades the one-time OAuth code for expiring offline tokens (Shopify no longer accepts permanent ones for new apps). */
export async function exchangeCode(shop: string, code: string): Promise<ShopifyTokens | null> {
  const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: process.env.SHOPIFY_CLIENT_ID, client_secret: process.env.SHOPIFY_CLIENT_SECRET, code, expiring: 1 }),
  });
  if (!res.ok) return null;
  return tokensFromResponse((await res.json()) as TokenResponse);
}

/**
 * Returns tokens that are valid now. Expiring tokens are refreshed (and saved through `persist`) when they have under 5 minutes left.
 * Old permanent tokens (the custom "Apex Data" app) have no expiry and are returned as they are.
 */
export async function freshTokens(shop: string, tokens: ShopifyTokens, persist: (t: ShopifyTokens) => Promise<void>): Promise<ShopifyTokens> {
  if (!tokens.expires_at || !tokens.refresh_token) return tokens;
  if (new Date(tokens.expires_at).getTime() - Date.now() > 5 * 60_000) return tokens;
  const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: process.env.SHOPIFY_CLIENT_ID,
      client_secret: process.env.SHOPIFY_CLIENT_SECRET,
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token,
    }),
  });
  if (!res.ok) throw new Error(`Shopify token refresh failed (${res.status}): reconnect the store`);
  const next = tokensFromResponse((await res.json()) as TokenResponse);
  await persist(next);
  return next;
}

/** Saves refreshed tokens to the store's install record (and nowhere else; the caller saves the connection copy). */
export async function saveInstallTokens(shop: string, tokens: ShopifyTokens) {
  await getAdminClient().from("shopify_installs").update({ ciphertext: encrypt(JSON.stringify(tokens)), scope: tokens.scope }).eq("shop", shop).is("uninstalled_at", null);
}

/** Install record tokens for a store, refreshed if needed. Null when the app is not installed. */
export async function installTokens(shop: string): Promise<ShopifyTokens | null> {
  const { data } = await getAdminClient().from("shopify_installs").select("ciphertext").eq("shop", shop).maybeSingle();
  if (!data?.ciphertext) return null;
  return freshTokens(shop, JSON.parse(decrypt(data.ciphertext)) as ShopifyTokens, (t) => saveInstallTokens(shop, t));
}

/** Records (or refreshes) a store's install of the public app. Tokens are stored encrypted, server only. */
export async function saveInstall(shop: string, tokens: ShopifyTokens) {
  const ciphertext = encrypt(JSON.stringify(tokens));
  const scope = tokens.scope;
  await getAdminClient()
    .from("shopify_installs")
    .upsert({ shop, ciphertext, scope, installed_at: new Date().toISOString(), uninstalled_at: null });
}

/** Creates/updates the client's Shopify connection from an install. Caller has already checked the user may access the client. */
export async function linkInstallToClient(shop: string, clientId: string, tokens: ShopifyTokens): Promise<boolean> {
  const accessToken = tokens.access_token;
  let name = shop;
  let currency: string | null = null;
  let timezone: string | null = null;
  try {
    const info = await shopifyGraphql<{ shop: { name: string; currencyCode: string; ianaTimezone: string } }>(
      shop,
      accessToken,
      "{ shop { name currencyCode ianaTimezone } }",
    );
    name = info.shop.name;
    currency = info.shop.currencyCode;
    timezone = info.shop.ianaTimezone;
  } catch {
    /* keep defaults; the first sync will surface the problem */
  }

  const admin = getAdminClient();
  const { data: integration, error } = await admin
    .from("integrations")
    .upsert(
      { client_id: clientId, provider: "shopify", account_id: shop, account_name: name, status: "connected", last_error: null },
      { onConflict: "client_id,provider,account_id" },
    )
    .select("id")
    .single();
  if (error || !integration) return false;

  await admin
    .from("integration_secrets")
    .upsert({ integration_id: integration.id, ciphertext: encrypt(JSON.stringify(tokens)), updated_at: new Date().toISOString() });
  if (currency && timezone) await admin.from("clients").update({ currency, timezone }).eq("id", clientId);
  return true;
}
