import { after, NextResponse } from "next/server";
import { kickRunner } from "@/lib/jobs";
import { verifyStoreLink } from "@/lib/store-link";
import { getAdminClient } from "@/lib/supabase/server";
import { syncShopify } from "@/lib/sync/run-shopify";

export const maxDuration = 60;

/**
 * Called by the store page when it opens: pulls the orders created or changed since yesterday, today included, so a merchant
 * sees an order they placed a minute ago. Also restarts the store's history load if its start signal was lost.
 */
export async function POST(request: Request) {
  const secret = process.env.SHOPIFY_CLIENT_SECRET;
  const body = (await request.json().catch(() => ({}))) as { shop?: string; exp?: string; sig?: string };
  const shop = secret ? verifyStoreLink(body, secret) : null;
  if (!shop) return NextResponse.json({ error: "This link has expired. Open the app again from your Shopify admin." }, { status: 401 });

  const admin = getAdminClient();
  const { data: integration } = await admin
    .from("integrations")
    .select("id,status")
    .eq("provider", "shopify")
    .eq("account_id", shop)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!integration || integration.status !== "connected") return NextResponse.json({ error: "This store is not connected." }, { status: 404 });

  const { data: waiting } = await admin.from("sync_jobs").select("id").eq("integration_id", integration.id).eq("status", "queued").limit(1);
  if (waiting && waiting.length > 0) after(() => kickRunner(waiting[0].id as string));

  try {
    const result = await syncShopify(integration.id as string, { body: { days: 2 }, products: false, includeUpdated: true, includeToday: true, deadline: Date.now() + 40_000 });
    return NextResponse.json({ ok: true, orders: result.orders, at: new Date().toISOString() });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not reach Shopify" }, { status: 502 });
  }
}
