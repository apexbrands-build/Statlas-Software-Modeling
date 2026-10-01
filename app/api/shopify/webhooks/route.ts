import { NextResponse } from "next/server";
import { normalizeShop, verifyWebhookHmac } from "@/lib/shopify";
import { getAdminClient } from "@/lib/supabase/server";

// One endpoint for the mandatory privacy webhooks and app/uninstalled. Shopify signs the raw body; anything
// unsigned or badly signed gets 401. Handlers are idempotent (Shopify retries).
export async function POST(request: Request) {
  const secret = process.env.SHOPIFY_CLIENT_SECRET;
  if (!secret) return NextResponse.json({ error: "not configured" }, { status: 500 });

  const raw = await request.text();
  if (!verifyWebhookHmac(raw, request.headers.get("x-shopify-hmac-sha256"), secret)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  const topic = request.headers.get("x-shopify-topic") ?? "";
  const shop = normalizeShop(request.headers.get("x-shopify-shop-domain") ?? "");
  let payload: { customer?: { id?: number | string } } = {};
  try {
    payload = JSON.parse(raw);
  } catch {
    /* an empty or non-JSON body is fine for app/uninstalled */
  }
  if (!shop) return NextResponse.json({ error: "missing shop" }, { status: 400 });

  const admin = getAdminClient();
  const { data: integrations } = await admin.from("integrations").select("id, client_id").eq("provider", "shopify").eq("account_id", shop);
  const clientIds = [...new Set((integrations ?? []).map((i) => i.client_id as string))];

  switch (topic) {
    case "app/uninstalled": {
      await admin.from("shopify_installs").update({ ciphertext: null, uninstalled_at: new Date().toISOString() }).eq("shop", shop);
      for (const i of integrations ?? []) {
        await admin.from("integration_secrets").delete().eq("integration_id", i.id);
        await admin.from("integrations").update({ status: "disconnected", last_error: "App uninstalled in Shopify" }).eq("id", i.id);
      }
      break;
    }
    case "shop/redact": {
      // 48 h after uninstall: erase everything we hold for this store. Data is keyed by client, so we only erase
      // a client's Shopify-derived rows when this was its only Shopify store.
      await admin.from("shopify_installs").delete().eq("shop", shop);
      for (const i of integrations ?? []) {
        await admin.from("integration_secrets").delete().eq("integration_id", i.id);
        await admin.from("integrations").delete().eq("id", i.id);
      }
      for (const clientId of clientIds) {
        const { count } = await admin.from("integrations").select("id", { count: "exact", head: true }).eq("client_id", clientId).eq("provider", "shopify");
        if (count) continue;
        for (const table of ["orders", "customers", "products", "daily_facts"]) await admin.from(table).delete().eq("client_id", clientId);
      }
      break;
    }
    case "customers/redact": {
      const id = payload.customer?.id != null ? String(payload.customer.id) : null;
      if (id) {
        for (const clientId of clientIds) {
          await admin.from("customers").delete().eq("client_id", clientId).eq("customer_id", id);
          await admin.from("orders").update({ customer_id: null }).eq("client_id", clientId).eq("customer_id", id);
        }
      }
      break;
    }
    case "customers/data_request":
      // We store no name, email, phone or address: only Shopify's numeric customer id and order amounts. Nothing to export beyond that.
      break;
    default:
      return NextResponse.json({ error: "unsupported topic" }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
