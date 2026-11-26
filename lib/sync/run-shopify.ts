import "server-only";
import { decrypt, encrypt } from "@/lib/crypto";
import { freshTokens, saveInstallTokens, type ShopifyTokens } from "@/lib/shopify-installs";
import { localMidnight } from "@/lib/last-data";
import { getAdminClient } from "@/lib/supabase/server";
import { todaySince } from "@/lib/today-pull";
import { isDtcChannel } from "./dtc";
import { fetchGrantedScopes, fetchIsDevStore, fetchOrders, fetchVariantCosts } from "./shopify";
import { resolveRange, type SyncRange } from "./range";

const addDays = (d: string, n: number) => new Date(new Date(`${d}T00:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);
const round = (n: number) => Math.round(n * 100) / 100;

function localDate(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

async function loadConnection(integrationId: string) {
  const admin = getAdminClient();
  const { data: integration } = await admin.from("integrations").select("id,client_id,provider,account_id").eq("id", integrationId).single();
  if (!integration || integration.provider !== "shopify") throw new Error("Not a Shopify connection");
  const { data: secret } = await admin.from("integration_secrets").select("ciphertext").eq("integration_id", integrationId).single();
  if (!secret) throw new Error("No saved credentials: reconnect the store");
  const shop = integration.account_id as string;
  const tokens = await freshTokens(shop, JSON.parse(decrypt(secret.ciphertext)) as ShopifyTokens, async (t) => {
    await admin.from("integration_secrets").update({ ciphertext: encrypt(JSON.stringify(t)), updated_at: new Date().toISOString() }).eq("integration_id", integrationId);
    await saveInstallTokens(shop, t);
  });
  return { admin, integration, token: tokens.access_token, shop, clientId: integration.client_id as string };
}

export async function shopifyHistoryAccess(integrationId: string): Promise<{ hasAllOrders: boolean }> {
  const { token, shop } = await loadConnection(integrationId);
  return { hasAllOrders: (await fetchGrantedScopes(shop, token)).includes("read_all_orders") };
}

export interface ShopifySyncOptions {
  body: { from?: string; to?: string; days?: number };
  /** Refresh variant costs (first chunk of a history load, and normal syncs). */
  products?: boolean;
  /** Also fetch orders merely UPDATED in the window, so refunds on older orders land on the day they happened. */
  includeUpdated?: boolean;
  /** Epoch ms after which the order fetch gives up (so a background task can retry smaller). */
  deadline?: number;
  /** Let the range run to the store's today (the store page, so orders placed minutes ago show). Default: stop at yesterday. */
  includeToday?: boolean;
  /**
   * The hourly pull of today's orders (see `lib/today-pull.ts`): only the orders placed since the last one already loaded today, never
   * before the start of the store's day, and saved even when the fetch runs out of time (the next pull carries on from there).
   * It writes orders only. The daily rows (`daily_facts`) and the connection's status, failure count, coverage and "last synced" are
   * left alone, so a pull that fails is noted in `sync_runs` and nowhere else. New vs returning is recomputed for the customers who
   * ordered today. `body`, `products`, `includeUpdated` and `includeToday` are ignored.
   */
  todayPull?: boolean;
}

export interface ShopifySyncResult {
  orders: number;
  range: SyncRange;
  note?: string;
  /** Today pull only: the fetch ran out of time, so there are more orders to load. */
  partial?: boolean;
  /** Today pull only: a sync job started meanwhile, so nothing was written (the job loads the same orders). */
  skipped?: boolean;
}

/**
 * Stores variant costs, orders and refunds for a date range, then rebuilds the daily rows in the database.
 * Order Revenue = gross - discounts + shipping + tax (refunds not deducted), dated by order date.
 * Returns are dated when the refund happened and reduce Net Sales.
 */
export async function syncShopify(integrationId: string, opts: ShopifySyncOptions): Promise<ShopifySyncResult> {
  const { admin, integration, token, shop, clientId } = await loadConnection(integrationId);
  const todayPull = opts.todayPull === true;
  const { data: run } = await admin.from("sync_runs").insert({ client_id: clientId, integration_id: integrationId, provider: "shopify" }).select("id").single();
  try {
    const { data: client } = await admin.from("clients").select("timezone").eq("id", clientId).single();
    const tz = client?.timezone || "UTC";
    const startedAt = new Date();
    const today = todayPull || opts.includeToday ? localDate(startedAt.toISOString(), tz) : undefined;
    const range = todayPull ? { from: today as string, to: today as string } : resolveRange(opts.body, 60, today);
    const includeUpdated = opts.includeUpdated ?? !(opts.body.from && opts.body.to);
    const { data: settings } = await admin.from("client_settings").select("dtc_channels,excluded_order_tags").eq("client_id", clientId).maybeSingle();
    const dtc = new Set(((settings?.dtc_channels as string[]) ?? ["Online Store", "Shop"]).map((c) => c.toLowerCase()));
    const excludedTags = new Set(((settings?.excluded_order_tags as string[]) ?? []).map((t) => t.toLowerCase()));

    // 1) Variant costs (costs uploaded by CSV are kept when Shopify has none)
    const { data: existing } = await admin.from("products").select("variant_id,unit_cost").eq("client_id", clientId).eq("cost_source", "csv");
    const csvCost = new Map((existing ?? []).map((p) => [p.variant_id as string, Number(p.unit_cost)]));
    if (!todayPull && (opts.products ?? true)) {
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
    }
    const { data: prods } = await admin.from("products").select("variant_id,unit_cost").eq("client_id", clientId).gt("unit_cost", 0);
    const cost = new Map((prods ?? []).map((p) => [p.variant_id as string, Number(p.unit_cost)]));

    // 2) Orders in the window (one day of overlap on each side covers timezone edges)
    const a = addDays(range.from, -1);
    const b = addDays(range.to, 1);
    let search = includeUpdated ? `created_at:>=${a} OR updated_at:>=${a} OR processed_at:>=${a}` : `(created_at:>=${a} AND created_at:<=${b}) OR (processed_at:>=${a} AND processed_at:<=${b})`;
    // Today pull: from the last order already loaded today (minus an overlap), never before the start of the store's day.
    let pull: { dayStart: Date; since: Date } | null = null;
    if (todayPull) {
      const last = await admin.from("orders").select("created_at").eq("client_id", clientId).gte("order_date", range.from).order("created_at", { ascending: false }).limit(1);
      if (last.error) throw new Error(last.error.message);
      const lastLoaded = last.data?.[0]?.created_at ? new Date(last.data[0].created_at as string) : null;
      const dayStart = localMidnight(range.from, tz);
      pull = { dayStart, since: todaySince(startedAt, dayStart, lastLoaded) };
      search = `created_at:>='${pull.since.toISOString().replace(/\.\d{3}Z$/, "Z")}'`;
    }
    const devStore = await fetchIsDevStore(shop, token);
    const got = await fetchOrders(shop, token, search, opts.deadline, devStore, todayPull);
    const approximateNewReturning = got.approximateNewReturning;
    // A today pull keeps only what it asked for. An order dated before `since` (a backdated import, or a search filter Shopify did not
    // apply) is left to the daily sync: this pull reclassifies today's customers only, so it must not rewrite older orders.
    const sinceMs = pull ? pull.since.getTime() : null;
    const fetched = sinceMs === null ? got.orders : got.orders.filter((o) => new Date(o.createdAt).getTime() >= sinceMs);

    let lineSales = 0;
    let unmappedSales = 0;
    const orderRows = fetched.map((o) => {
      const date = localDate(o.createdAt, tz);
      let cogs = 0;
      let unmapped = 0;
      let sales = 0;
      for (const l of o.lines) {
        const c = l.variantId ? cost.get(l.variantId) : undefined;
        if (c) cogs += l.quantity * c;
        else unmapped += l.sales;
        sales += l.sales;
      }
      if (date >= range.from && date <= range.to) {
        lineSales += sales;
        unmappedSales += unmapped;
      }
      return {
        client_id: clientId,
        order_id: o.orderId,
        customer_id: o.customerId,
        customer_lifetime_orders: o.customerLifetimeOrders,
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
        is_first_order: false, // set by recompute_first_orders below
        is_dtc: isDtcChannel(o.channel, dtc, devStore) && !o.tags.some((t) => excludedTags.has(t.toLowerCase())),
      };
    });
    if (pull && orderRows.length > 0) {
      // A sync job that started while the orders were being fetched loads these same orders and classifies them itself: leave the writes to it.
      const active = await admin.from("sync_jobs").select("id").eq("integration_id", integrationId).in("status", ["queued", "running"]).limit(1);
      if (active.error) throw new Error(active.error.message);
      if (active.data && active.data.length > 0) {
        await admin.from("sync_runs").update({ status: "ok", finished_at: new Date().toISOString(), rows_written: 0, message: "Today's orders: nothing written, a sync job started for this store" }).eq("id", run?.id ?? "");
        return { orders: 0, range, skipped: true };
      }
    }
    for (let i = 0; i < orderRows.length; i += 500) {
      const { error } = await admin.from("orders").upsert(orderRows.slice(i, i + 500));
      if (error) throw new Error(error.message);
    }

    // Line items (Product by First Product report). Skipped quietly until migration 0006 (order_lines) is applied.
    const lineRows = fetched.flatMap((o) =>
      o.lines.map((l) => ({ client_id: clientId, order_id: o.orderId, line_id: l.lineId, product_id: l.productId, title: l.title, variant_id: l.variantId, quantity: l.quantity, sales: round(l.sales) })),
    );
    for (let i = 0; i < lineRows.length; i += 500) {
      const { error } = await admin.from("order_lines").upsert(lineRows.slice(i, i + 500));
      if (error) {
        if (/order_lines|PGRST205|42P01/.test(`${error.code} ${error.message}`)) break; // table not created yet
        throw new Error(error.message);
      }
    }

    // Refund events, dated by the refund itself
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

    if (pull) {
      // New vs returning for today's customers. No daily rows: a day in progress must not look like a finished one (the daily sync rolls a day up once it is over).
      if (orderRows.length > 0) await classifySince(clientId, pull.dayStart);
      const partial = got.truncated;
      const message = `Today's orders since ${pull.since.toISOString()}: ${orderRows.length} saved${partial ? " (out of time: the next pull carries on from the last one)" : ""}`;
      await admin.from("sync_runs").update({ status: "ok", finished_at: new Date().toISOString(), rows_written: orderRows.length, message }).eq("id", run?.id ?? "");
      return partial ? { orders: orderRows.length, range, partial } : { orders: orderRows.length, range };
    }

    // 3) Classify new vs returning and rebuild the daily rows in the database
    await dbRollup(clientId, range);

    const coverage = lineSales > 0 ? Math.round((1 - unmappedSales / lineSales) * 100) : 100;
    const notes: string[] = [];
    if (approximateNewReturning) notes.push("New vs returning is approximate (Shopify did not allow customer order counts).");
    if (coverage < 95) notes.push(`Only ${coverage}% of sales have a product cost in Shopify. Upload costs or set a COGS estimate in settings.`);
    const note = notes.join(" ") || undefined;
    const now = new Date().toISOString();
    const { data: cov } = await admin.from("integrations").select("coverage_start,coverage_end").eq("id", integrationId).single();
    const covStart = cov?.coverage_start && cov.coverage_start < range.from ? cov.coverage_start : range.from;
    const covEnd = cov?.coverage_end && cov.coverage_end > range.to ? cov.coverage_end : range.to;
    await admin.from("integrations").update({ status: "connected", consecutive_failures: 0, last_synced_at: now, last_error: note ?? null, coverage_start: covStart, coverage_end: covEnd }).eq("id", integrationId);
    await admin.from("sync_runs").update({ status: "ok", finished_at: now, rows_written: orderRows.length, message: `${range.from} → ${range.to}${note ? ` | ${note}` : ""}` }).eq("id", run?.id ?? "");
    void integration;
    return { orders: orderRows.length, range, note };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Sync failed";
    // A failed today pull is noted in the run log only: the connection's status and failure count belong to the daily sync.
    if (!todayPull) await admin.from("integrations").update({ status: "error", last_error: message.slice(0, 300) }).eq("id", integrationId);
    await admin.from("sync_runs").update({ status: "error", finished_at: new Date().toISOString(), message: `${todayPull ? "Today's orders: " : ""}${message}`.slice(0, 300) }).eq("id", run?.id ?? "");
    throw e;
  }
}

/**
 * New vs returning for the customers who ordered since `since`, by the same rule as `recompute_first_orders`. That one rewrites every order
 * of the client, too heavy to run every hour, so the today pull uses `recompute_first_orders_since` (migration 0024). Until that migration
 * is applied the lighter function is missing and the full one runs instead, as the store page's refresh does.
 */
async function classifySince(clientId: string, since: Date) {
  const admin = getAdminClient();
  const light = await admin.rpc("recompute_first_orders_since", { p_client: clientId, p_since: since.toISOString() });
  if (!light.error) return;
  if (!/PGRST202|42883|Could not find the function/i.test(`${light.error.code ?? ""} ${light.error.message ?? ""}`)) throw new Error(light.error.message);
  const full = await admin.rpc("recompute_first_orders", { p_client: clientId });
  if (full.error) throw new Error(full.error.message);
}

async function dbRollup(clientId: string, range: SyncRange) {
  const admin = getAdminClient();
  const first = await admin.rpc("recompute_first_orders", { p_client: clientId });
  if (first.error) throw new Error(first.error.message);
  const rebuilt = await admin.rpc("rebuild_daily_facts", { p_client: clientId, p_from: range.from, p_to: range.to });
  if (rebuilt.error) throw new Error(rebuilt.error.message);
}

/** After a history load: re-classify everything once and rebuild the whole loaded range. */
export async function finalizeShopify(integrationId: string, body: { from?: string; to?: string }): Promise<{ range: SyncRange }> {
  const { clientId } = await loadConnection(integrationId);
  const range = resolveRange(body, 60);
  await dbRollup(clientId, range);
  return { range };
}
