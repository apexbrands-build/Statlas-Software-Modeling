import { NextResponse } from "next/server";
import { encrypt } from "@/lib/crypto";
import { normalizeShop, SHOPIFY_API_VERSION, shopifyGraphql, verifyShopifyHmac } from "@/lib/shopify";
import { getAdminClient, getServerClient } from "@/lib/supabase/server";

function back(request: Request, query: string) {
  return NextResponse.redirect(new URL(`/settings?${query}`, request.url));
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const secret = process.env.SHOPIFY_CLIENT_ID && process.env.SHOPIFY_CLIENT_SECRET;
  if (!secret) return back(request, "error=shopify_not_configured");

  const shop = normalizeShop(url.searchParams.get("shop") ?? "");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!shop || !code || !state || !verifyShopifyHmac(url.searchParams, process.env.SHOPIFY_CLIENT_SECRET!)) {
    return back(request, "error=shopify_invalid_request");
  }

  const cookie = request.headers.get("cookie")?.split("; ").find((c) => c.startsWith("shopify_oauth="));
  let saved: { state: string; clientId: string; shop: string } | null = null;
  try {
    saved = cookie ? JSON.parse(decodeURIComponent(cookie.slice("shopify_oauth=".length))) : null;
  } catch {
    saved = null;
  }
  if (!saved || saved.state !== state || saved.shop !== shop) return back(request, "error=shopify_state_mismatch");

  // The signed-in user must still have access to the client.
  const supabase = await getServerClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return back(request, "error=not_signed_in");
  const { data: client } = await supabase.from("clients").select("id").eq("id", saved.clientId).maybeSingle();
  if (!client) return back(request, "error=no_client_access");

  const tokenRes = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: process.env.SHOPIFY_CLIENT_ID, client_secret: process.env.SHOPIFY_CLIENT_SECRET, code }),
  });
  if (!tokenRes.ok) return back(request, "error=shopify_token_exchange_failed");
  const { access_token, scope } = (await tokenRes.json()) as { access_token: string; scope: string };

  let name = shop;
  let currency: string | null = null;
  let timezone: string | null = null;
  try {
    const info = await shopifyGraphql<{ shop: { name: string; currencyCode: string; ianaTimezone: string } }>(
      shop,
      access_token,
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
      { client_id: saved.clientId, provider: "shopify", account_id: shop, account_name: name, status: "connected", last_error: null },
      { onConflict: "client_id,provider,account_id" },
    )
    .select("id")
    .single();
  if (error || !integration) return back(request, "error=save_failed");

  await admin
    .from("integration_secrets")
    .upsert({ integration_id: integration.id, ciphertext: encrypt(JSON.stringify({ access_token, scope, apiVersion: SHOPIFY_API_VERSION })), updated_at: new Date().toISOString() });
  if (currency && timezone) await admin.from("clients").update({ currency, timezone }).eq("id", saved.clientId);

  const res = back(request, "connected=shopify");
  res.cookies.delete({ name: "shopify_oauth", path: "/api/shopify" });
  return res;
}
