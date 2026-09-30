import "server-only";
import { decrypt } from "@/lib/crypto";
import { getAdminClient } from "@/lib/supabase/server";
import { fetchOrders, fetchVariantCosts, markFirstOrders } from "./shopify";

const addDays = (d: string, n: number) => new Date(new Date(`${d}T00:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);
const round = (n: number) => Math.round(n * 100) / 100;

function localDate(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

interface Day {
  orderRevenue: number;
  ship: number;
  tax: number;
  newRev: number;
  retRev: number;
  newO: number;
  retO: number;
  returns: number;
  cogs: number;
  unmapped: number;
}

/**
 * Pulls variant costs and recent orders, stores them, and rebuilds the daily rows the dashboard reads.
 * Order Revenue = gross - discounts + shipping + tax (refunds not deducted), dated by order date.
 * Returns are dated when the refund happened (like Shopify's Returns) and reduce Net Sales.
 */
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

    // 1) Variant costs. Costs uploaded by CSV are kept when Shopify has none.
    const { data: existing } = await admin.from("products").select("variant_id,unit_cost,cost_source").eq("client_id", clientId).eq("cost_source", "csv");
    const csvCost = new Map((existing ?? []).map((p) => [p.variant_id as string, Number(p.unit_cost)]));
    const variants = await fetchVariantCosts(shop, token);
    const rowsToSave = variants.map((v) => {
      const shopifyCost = v.unitCost !== null && v.unitCost > 0 ? v.unitCost : null;
      const keepCsv = shopifyCost === null && csvCost.has(v.variantId);
      return { client_id: clientId, variant_id: v.variantId, title: v.title, sku: v.sku, unit_cost: keepCsv ? csvCost.get(v.variantId) : shopifyCost, cost_source: keepCsv ? "csv" : "shopify" };
    });
    for (let i = 0; i < rowsToSave.length; i += 500) {
      const { error } = await admin.from("products").upsert(rowsToSave.slice(i, i + 500));
      if (error) throw new Error(error.message);
    }
    const cost = new Map(rowsToSave.filter((v) => v.unit_cost && v.unit_cost > 0).map((v) => [v.variant_id, v.unit_cost as number]));

    // 2) Orders (created or updated in the window)
    const today = localDate(new Date().toISOString(), tz);
    const until = addDays(today, -1);
    const since = addDays(today, -Math.min(Math.max(days, 1), 800));
    const { orders: fetched, approximateNewReturning } = await fetchOrders(shop, token, since);
    const inWindow = fetched.filter((o) => localDate(o.createdAt, tz) >= since);
    const first = markFirstOrders(inWindow);

    let lineSales = 0;
    let unmappedSales = 0;
    const orderRows = fetched.map((o) => {
      const date = localDate(o.createdAt, tz);
      let cogs = 0;
      let unmapped = 0;
      for (const l of o.lines) {
        const c = l.variantId ? cost.get(l.variantId) : undefined;
        if (c) cogs += l.quantity * c;
        else unmapped += l.sales;
        if (date >= since) lineSales += l.sales;
      }
      if (date >= since) unmappedSales += unmapped;
      const isDtc = dtc.has(o.channel.toLowerCase()) && !o.tags.some((t) => excludedTags.has(t.toLowerCase()));
      return {
        date,
        raw: o,
        row: {
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
          refunds: round(o.totalRefunded),
          order_revenue: round(o.orderRevenue),
          cogs: round(cogs),
          cogs_unmapped_sales: round(unmapped),
          is_first_order: first.get(o.orderId) ?? false,
          is_dtc: isDtc,
        },
      };
    });
    for (let i = 0; i < orderRows.length; i += 500) {
      const { error } = await admin.from("orders").upsert(orderRows.slice(i, i + 500).map((x) => x.row));
      if (error) throw new Error(error.message);
    }

    // Refund events, dated by the refund itself
    const dtcOrders = new Set(orderRows.filter((x) => x.row.is_dtc).map((x) => x.row.order_id));
    const refundRows = fetched.flatMap((o) =>
      o.refunds.map((r) => ({
        client_id: clientId,
        refund_id: r.id,
        order_id: o.orderId,
        refund_date: localDate(r.createdAt, tz),
        created_at: r.createdAt,
        total_refunded: round(r.total),
        items_subtotal: round(r.itemsSubtotal > 0 ? r.itemsSubtotal : r.total),
      })),
    );
    for (let i = 0; i < refundRows.length; i += 500) {
      const { error } = await admin.from("order_refunds").upsert(refundRows.slice(i, i + 500));
      if (error) throw new Error(error.message);
    }

    // 3) Daily rollup for every day in the window (days without orders become zero rows)
    const byDay: Record<string, Day> = {};
    for (let d = since; d <= until; d = addDays(d, 1)) byDay[d] = { orderRevenue: 0, ship: 0, tax: 0, newRev: 0, retRev: 0, newO: 0, retO: 0, returns: 0, cogs: 0, unmapped: 0 };
    for (const { date, raw, row } of orderRows) {
      const day = byDay[date];
      if (!day || !row.is_dtc) continue;
      day.orderRevenue += raw.orderRevenue;
      day.ship += raw.shipping;
      day.tax += raw.tax;
      day.cogs += row.cogs;
      day.unmapped += row.cogs_unmapped_sales;
      if (row.is_first_order) {
        day.newRev += raw.orderRevenue;
        day.newO += 1;
      } else {
        day.retRev += raw.orderRevenue;
        day.retO += 1;
      }
    }
    for (const r of refundRows) {
      const day = byDay[r.refund_date];
      if (day && dtcOrders.has(r.order_id)) day.returns += r.items_subtotal;
    }
    const facts = Object.entries(byDay).map(([date, d]) => ({
      client_id: clientId,
      date,
      // Net Sales = gross - discounts - returns = order revenue - shipping - tax - returns
      net_sales: round(d.orderRevenue - d.ship - d.tax - d.returns),
      shipping_collected: round(d.ship),
      tax: round(d.tax),
      new_order_revenue: round(d.newRev),
      returning_order_revenue: round(d.retRev),
      new_orders: d.newO,
      returning_orders: d.retO,
      refunds: round(d.returns),
      cogs: round(d.cogs),
      cogs_unmapped_sales: round(d.unmapped),
      updated_at: new Date().toISOString(),
    }));
    for (let i = 0; i < facts.length; i += 500) {
      const { error } = await admin.from("daily_facts").upsert(facts.slice(i, i + 500));
      if (error) throw new Error(error.message);
    }

    const coverage = lineSales > 0 ? Math.round((1 - unmappedSales / lineSales) * 100) : 100;
    const notes: string[] = [];
    if (approximateNewReturning) notes.push("New vs returning is approximate (Shopify did not allow customer order counts).");
    if (coverage < 95) notes.push(`Only ${coverage}% of sales have a product cost in Shopify. Upload costs or set a COGS estimate in settings.`);
    const note = notes.join(" ") || undefined;
    const now = new Date().toISOString();
    await admin.from("integrations").update({ status: "connected", last_synced_at: now, last_error: note ?? null, coverage_start: since, coverage_end: until }).eq("id", integrationId);
    await admin.from("sync_runs").update({ status: "ok", finished_at: now, rows_written: orderRows.length, message: note ?? null }).eq("id", run?.id ?? "");
    return { orders: inWindow.length, note };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Sync failed";
    await admin.from("integrations").update({ status: "error", last_error: message.slice(0, 300) }).eq("id", integrationId);
    await admin.from("sync_runs").update({ status: "error", finished_at: new Date().toISOString(), message: message.slice(0, 300) }).eq("id", run?.id ?? "");
    throw e;
  }
}
