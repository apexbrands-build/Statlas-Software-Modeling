import { after, NextResponse } from "next/server";
import { createJob, kickRunner, queuedJobId } from "@/lib/jobs";
import { findStoreIntegration, installTokens, provisionStoreClient } from "@/lib/shopify-installs";
import { verifyStoreLink } from "@/lib/store-link";
import { syncShopify } from "@/lib/sync/run-shopify";

export const maxDuration = 60;

/**
 * Called by the store page when it opens: pulls the orders created or changed since yesterday, today included, so a merchant
 * sees an order they placed a minute ago. A store installed before installs connected themselves is connected here first,
 * and a history load whose start signal was lost is restarted.
 */
export async function POST(request: Request) {
  const secret = process.env.SHOPIFY_CLIENT_SECRET;
  const body = (await request.json().catch(() => ({}))) as { shop?: string; exp?: string; sig?: string };
  const shop = secret ? verifyStoreLink(body, secret) : null;
  if (!shop) return NextResponse.json({ error: "This link has expired. Open the app again from your Shopify admin." }, { status: 401 });

  let integrationId: string;
  const existing = await findStoreIntegration(shop);
  if (existing && existing.status === "connected") {
    integrationId = existing.id;
    const waiting = await queuedJobId(integrationId);
    if (waiting) after(() => kickRunner(waiting));
  } else {
    const tokens = await installTokens(shop);
    if (!tokens) return NextResponse.json({ error: "This store is not connected." }, { status: 404 });
    const store = await provisionStoreClient(shop, tokens);
    if (!store) return NextResponse.json({ error: "Could not connect the store. Please try again." }, { status: 500 });
    integrationId = store.integrationId;
    try {
      const job = await createJob(integrationId, { kind: "history", months: 12 });
      if (!job.alreadyRunning) after(() => kickRunner(job.id));
    } catch {
      /* today's orders still load below; the hourly check restarts waiting jobs */
    }
  }

  try {
    const result = await syncShopify(integrationId, { body: { days: 2 }, products: false, includeUpdated: true, includeToday: true, deadline: Date.now() + 40_000 });
    return NextResponse.json({ ok: true, orders: result.orders, at: new Date().toISOString() });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not reach Shopify" }, { status: 502 });
  }
}
