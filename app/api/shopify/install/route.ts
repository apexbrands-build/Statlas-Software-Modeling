import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { getServerClient } from "@/lib/supabase/server";
import { normalizeShop, SHOPIFY_SCOPES } from "@/lib/shopify";

// Starts the Shopify install (read-only scopes). Only a signed-in user with access to the client may start it.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const shop = normalizeShop(url.searchParams.get("shop") ?? "");
  const clientId = url.searchParams.get("client") ?? "";
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  const shopifyClientId = process.env.SHOPIFY_CLIENT_ID;
  if (!shop || !clientId || !appUrl || !shopifyClientId) {
    return NextResponse.json({ error: "Missing or invalid shop, client, or server configuration" }, { status: 400 });
  }

  const supabase = await getServerClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { data: client } = await supabase.from("clients").select("id").eq("id", clientId).maybeSingle();
  if (!client) return NextResponse.json({ error: "No access to this client" }, { status: 403 });

  const state = randomBytes(16).toString("hex");
  const authorize = new URL(`https://${shop}/admin/oauth/authorize`);
  authorize.searchParams.set("client_id", shopifyClientId);
  authorize.searchParams.set("scope", SHOPIFY_SCOPES);
  authorize.searchParams.set("redirect_uri", `${appUrl}/api/shopify/callback`);
  authorize.searchParams.set("state", state);

  const res = NextResponse.redirect(authorize);
  res.cookies.set("shopify_oauth", JSON.stringify({ state, clientId, shop }), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600,
    path: "/api/shopify",
  });
  return res;
}
