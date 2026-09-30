import "server-only";
import { decrypt } from "@/lib/crypto";
import { getAdminClient } from "@/lib/supabase/server";
import { fetchOrders, fetchVariantCosts, markFirstOrders } from "./shopify";

const addDays = (d: string, n: number) => new Date(new Date(`${d}T00:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);
const round = (n: number) => Math.round(n * 100) / 100;

function localDate(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

/** Pulls variant costs and recent orders, stores them, and rebuilds the daily rows the dashboard reads. */
export async function syncShopify(integrationId: string, days: number): Promise<{ orders: number; note?: string }> {
  const admin = getAdminClient();
  const { data: integration } = await admin.from("integrations").select("id,client_id,provider,account_id").eq("id", integrationId).single();
  if (!integration || integration.provider !== "shopify") throw new Error("Not a Shopify connection");
  const { data: run } = await admin.from("sync_runs").insert({ client_id: integration.client_id, integration_id: integrationId, provider: "shopify" }).select("id").single();

  try {
    const { data: secret } = await admin.from("integration_secrets").select("ciphertext").eq("integration_id", integrationId).single();
    if (!secret) throw new Error("No saved credentials: reconnect the store");
    const { access_token: token } = JSON.parse(decrypt(secret.ciphertext)) as { access_token: string };
    const shop = integration.account_id;
    const clientId = integration.client_id;

    const { data: client } = await admin.from("clients").select("timezone").eq("id", clientId).single();
    const tz = client?.timezone || "UTC";
    const { data: settings } = await admin.from("client_settings").select("dtc_channels,excluded_order_tags").eq("client_id", clientId).maybeSingle();
    const dtc = new Set(((settings?.dtc_channels as string[]) ?? ["Online Store", "Shop"]).map((c) => c.toLowerCase()));
    const excludedTags = new Set(((settings?.excluded_order_tags as string[]) ?? []).map((t) => t.toLowerCase()));

    // 1) Variant costs (current cost per item)
    const variants = await fetchVariantCosts(shop, token);
    for (let i = 0; i < variants.length; i += 500) {
      const rows = variants.slice(i, i + 500).map((v) => ({ client_id: clientId, variant_id: v.variantId, title: v.title, sku: v.sku, unit_cost: v.unitCost, cost_source: "shopify" }));
      const { error } = await admin.from("products").upsert(rows);
      if (error) throw new Error(error.message);
    }
    const cost = new Map(variants.map((v) => [v.variantId, v.unitCost ?? 0]));

    // 2) Orders
    const today = localDate(new Date().toISOString(), tz);
    const until = addDays(today, -1);
    const since = addDays(today, -Math.min(Math.max(days, 1), 800));
    const { orders, approximateNewReturning } = await fetchOrders(shop, token, since);
    const first = markFirstOrders(orders);

    const rows = orders.map((o) => {
      const date = localDate(o.createdAt, tz);
      const netSales = o.orderRevenue - o.shipping - o.tax - o.refunds;
      const cogs = o.lines.reduce((s, l) => s + l.quantity * (l.variantId ? (cost.get(l.variantId) ?? 0) : 0), 0);
      const isDtc = dtc.has(o.channel.toLowerCase()) && !o.tags.some((t) => excludedTags.has(t.toLowerCase()));
      return {
        client_id: clientId,
        order_id: o.orderId,
        customer_id: o.customerId,
        created_at: o.createdAt,
        order_date: date,
        sales_channel: o.channel,
        tags: o.tags,
        gross_sales: round(o.subtotal + o.discounts),
        discounts: round(o.discounts),
        shipping_collected: round(o.shipping),
        tax: round(o.tax),
        refunds: round(o.refunds),
        cogs: round(cogs),
        is_first_order: first.get(o.orderId) ?? true,
        is_dtc: isDtc,
        _orderRevenue: o.orderRevenue,
        _netSales: netSales,
      };
    });
    const dbRows = rows.map(({ _orderRevenue, _netSales, ...r }) => {
      void _orderRevenue;
      void _netSales;
      return r;
    });
    for (let i = 0; i < dbRows.length; i += 500) {
      const { error } = await admin.from("orders").upsert(dbRows.slice(i, i + 500));
      if (error) throw new Error(error.message);
    }

    // 3) Daily rollup for every day in the window (days without orders become zero rows)
    const days_: Record<string, { netSales: number; ship: number; tax: number; newRev: number; retRev: number; newO: number; retO: number; refunds: number; cogs: number }> = {};
    for (let d = since; d <= until; d = addDays(d, 1)) days_[d] = { netSales: 0, ship: 0, tax: 0, newRev: 0, retRev: 0, newO: 0, retO: 0, refunds: 0, cogs: 0 };
    for (const r of rows) {
      const day = days_[r.order_date];
      if (!day || !r.is_dtc) continue;
      day.netSales += r._netSales;
      day.ship += r.shipping_collected;
      day.tax += r.tax;
      day.refunds += r.refunds;
      day.cogs += r.cogs;
      if (r.is_first_order) {
        day.newRev += r._orderRevenue;
        day.newO += 1;
      } else {
        day.retRev += r._orderRevenue;
        day.retO += 1;
      }
    }
    const facts = Object.entries(days_).map(([date, d]) => ({
      client_id: clientId,
      date,
      net_sales: round(d.netSales),
      shipping_collected: round(d.ship),
      tax: round(d.tax),
      new_order_revenue: round(d.newRev),
      returning_order_revenue: round(d.retRev),
      new_orders: d.newO,
      returning_orders: d.retO,
      refunds: round(d.refunds),
      cogs: round(d.cogs),
      updated_at: new Date().toISOString(),
    }));
    for (let i = 0; i < facts.length; i += 500) {
      const { error } = await admin.from("daily_facts").upsert(facts.slice(i, i + 500));
      if (error) throw new Error(error.message);
    }

    const now = new Date().toISOString();
    const note = approximateNewReturning ? "New vs returning is approximate (Shopify did not allow customer order counts)." : undefined;
    await admin.from("integrations").update({ status: "connected", last_synced_at: now, last_error: note ?? null, coverage_start: since, coverage_end: until }).eq("id", integrationId);
    await admin.from("sync_runs").update({ status: "ok", finished_at: now, rows_written: rows.length, message: note ?? null }).eq("id", run?.id ?? "");
    return { orders: rows.length, note };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Sync failed";
    await admin.from("integrations").update({ status: "error", last_error: message.slice(0, 300) }).eq("id", integrationId);
    await admin.from("sync_runs").update({ status: "error", finished_at: new Date().toISOString(), message: message.slice(0, 300) }).eq("id", run?.id ?? "");
    throw e;
  }
}
