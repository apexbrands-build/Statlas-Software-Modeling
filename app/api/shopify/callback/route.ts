import { NextResponse } from "next/server";
import { exchangeCode, linkInstallToClient, saveInstall } from "@/lib/shopify-installs";
import { normalizeShop, verifyShopifyHmac } from "@/lib/shopify";
import { getServerClient } from "@/lib/supabase/server";

// Errors go to Store Settings for a signed-in Apex user linking a client, and to the public /shopify page otherwise.
function back(request: Request, query: string, toSettings = true) {
  return NextResponse.redirect(new URL(`${toSettings ? "/settings" : "/shopify"}?${query}`, request.url));
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const secret = process.env.SHOPIFY_CLIENT_ID && process.env.SHOPIFY_CLIENT_SECRET;
  if (!secret) return back(request, "error=shopify_not_configured", false);

  const shop = normalizeShop(url.searchParams.get("shop") ?? "");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!shop || !code || !state || !verifyShopifyHmac(url.searchParams, process.env.SHOPIFY_CLIENT_SECRET!)) {
    return back(request, "error=shopify_invalid_request", false);
  }

  const cookie = request.headers.get("cookie")?.split("; ").find((c) => c.startsWith("shopify_oauth="));
  let saved: { state: string; clientId: string | null; shop: string } | null = null;
  try {
    saved = cookie ? JSON.parse(decodeURIComponent(cookie.slice("shopify_oauth=".length))) : null;
  } catch {
    saved = null;
  }
  if (!saved || saved.state !== state || saved.shop !== shop) return back(request, "error=shopify_state_mismatch", false);

  const tokens = await exchangeCode(shop, code);
  if (!tokens) return back(request, "error=shopify_token_exchange_failed", Boolean(saved.clientId));

  // Every install is recorded, signed in or not (merchants installing from the App Store have no Apex account).
  await saveInstall(shop, tokens);

  if (!saved.clientId) {
    const res = NextResponse.redirect(new URL(`/shopify?shop=${encodeURIComponent(shop)}&installed=1`, request.url));
    res.cookies.delete({ name: "shopify_oauth", path: "/api/shopify" });
    return res;
  }

  // Linking to a client: the signed-in user must still have access to it.
  const supabase = await getServerClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return back(request, "error=not_signed_in");
  const { data: client } = await supabase.from("clients").select("id").eq("id", saved.clientId).maybeSingle();
  if (!client) return back(request, "error=no_client_access");
  if (!(await linkInstallToClient(shop, saved.clientId, tokens))) return back(request, "error=save_failed");

  const res = back(request, "connected=shopify");
  res.cookies.delete({ name: "shopify_oauth", path: "/api/shopify" });
  return res;
}
