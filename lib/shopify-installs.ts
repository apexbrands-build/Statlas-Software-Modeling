import "server-only";
import { encrypt } from "@/lib/crypto";
import { SHOPIFY_API_VERSION, shopifyGraphql } from "@/lib/shopify";
import { getAdminClient } from "@/lib/supabase/server";

/** Records (or refreshes) a store's install of the public app. Token is stored encrypted, server only. */
export async function saveInstall(shop: string, accessToken: string, scope: string) {
  const ciphertext = encrypt(JSON.stringify({ access_token: accessToken, scope, apiVersion: SHOPIFY_API_VERSION }));
  await getAdminClient()
    .from("shopify_installs")
    .upsert({ shop, ciphertext, scope, installed_at: new Date().toISOString(), uninstalled_at: null });
}

/** Creates/updates the client's Shopify connection from an install. Caller has already checked the user may access the client. */
export async function linkInstallToClient(shop: string, clientId: string, accessToken: string, scope: string): Promise<boolean> {
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
    .upsert({ integration_id: integration.id, ciphertext: encrypt(JSON.stringify({ access_token: accessToken, scope, apiVersion: SHOPIFY_API_VERSION })), updated_at: new Date().toISOString() });
  if (currency && timezone) await admin.from("clients").update({ currency, timezone }).eq("id", clientId);
  return true;
}
