import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { installTokens, linkInstallToClient } from "@/lib/shopify-installs";
import { normalizeShop, scopesCover, SHOPIFY_SCOPES } from "@/lib/shopify";
import { getAdminClient, getServerClient } from "@/lib/supabase/server";

// Starts the Shopify install (read-only scopes).
// - Without `client`: a merchant (or Shopify) installing the public app. No sign-in needed; the callback records the install.
// - With `client`: a signed-in Apex user linking a store to a client. If the store already installed the app with
//   the scopes we need, the existing install is linked directly; otherwise we run the OAuth flow.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const shop = normalizeShop(url.searchParams.get("shop") ?? "");
  const clientId = url.searchParams.get("client") ?? "";
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  const shopifyClientId = process.env.SHOPIFY_CLIENT_ID;
  if (!shop || !appUrl || !shopifyClientId) {
    return NextResponse.json({ error: "Missing or invalid shop, or server configuration" }, { status: 400 });
  }

  if (clientId) {
    const supabase = await getServerClient();
    const { data: user } = await supabase.auth.getUser();
    if (!user.user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    const { data: client } = await supabase.from("clients").select("id").eq("id", clientId).maybeSingle();
    if (!client) return NextResponse.json({ error: "No access to this client" }, { status: 403 });

    const { data: install } = await getAdminClient().from("shopify_installs").select("scope").eq("shop", shop).maybeSingle();
    const tokens = install && scopesCover(install.scope, SHOPIFY_SCOPES) ? await installTokens(shop).catch(() => null) : null;
    if (tokens) {
      const ok = await linkInstallToClient(shop, clientId, tokens);
      return NextResponse.redirect(new URL(ok ? "/settings?connected=shopify" : "/settings?error=save_failed", request.url));
    }
  }

  const state = randomBytes(16).toString("hex");
  const authorize = new URL(`https://${shop}/admin/oauth/authorize`);
  authorize.searchParams.set("client_id", shopifyClientId);
  authorize.searchParams.set("scope", SHOPIFY_SCOPES);
  authorize.searchParams.set("redirect_uri", `${appUrl}/api/shopify/callback`);
  authorize.searchParams.set("state", state);

  const res = NextResponse.redirect(authorize);
  res.cookies.set("shopify_oauth", JSON.stringify({ state, clientId: clientId || null, shop }), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600,
    path: "/api/shopify",
  });
  return res;
}
