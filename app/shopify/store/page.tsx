import type { Metadata } from "next";
import Link from "next/link";
import { PublicPage } from "@/components/public/PublicPage";
import { APP_NAME } from "@/lib/legal";
import { breakdown, presetRange, PRESETS, type FactRow } from "@/lib/store-breakdown";
import { storeLinkQuery, verifyStoreLink } from "@/lib/store-link";
import { localDate } from "@/lib/sync-schedule";
import { getAdminClient } from "@/lib/supabase/server";
import { StoreRefresher } from "./StoreRefresher";

export const metadata: Metadata = { title: `${APP_NAME}: your store` };

const FACT_COLUMNS = "date,gross_sales,discounts,refunds,net_sales,shipping_collected,tax,new_orders,returning_orders,new_order_revenue,returning_order_revenue";

/**
 * One store's own numbers, for the merchant who installed the app from Shopify (no Apex account). Reached through a signed store link
 * issued at install or when Shopify opens the app; laid out like Shopify's "Total sales breakdown" so the figures can be checked 1:1.
 */
export default async function StorePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const secret = process.env.SHOPIFY_CLIENT_SECRET;
  const shop = secret ? verifyStoreLink({ shop: sp.shop, exp: sp.exp, sig: sp.sig }, secret) : null;
  if (!shop) {
    return (
      <PublicPage title={APP_NAME}>
        <p>This link has expired. Open {APP_NAME} again from your Shopify admin: Apps → {APP_NAME}.</p>
      </PublicPage>
    );
  }

  const admin = getAdminClient();
  const { data: integration } = await admin
    .from("integrations")
    .select("id,client_id,status")
    .eq("provider", "shopify")
    .eq("account_id", shop)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!integration || integration.status !== "connected") {
    return (
      <PublicPage title={APP_NAME}>
        <p>
          <strong>{shop}</strong> is not connected. Open {APP_NAME} from your Shopify admin (Apps → {APP_NAME}) to connect it again.
        </p>
      </PublicPage>
    );
  }

  const { data: client } = await admin.from("clients").select("name,currency,timezone").eq("id", integration.client_id).single();
  const tz = (client?.timezone as string | undefined) ?? "UTC";
  const currency = (client?.currency as string | undefined) ?? "USD";
  const today = localDate(new Date(), tz);
  const preset = PRESETS.some((p) => p.key === sp.range) ? (sp.range as string) : "last30";
  const range = presetRange(preset, today);

  const [{ data: facts }, { data: job }] = await Promise.all([
    admin.from("daily_facts").select(FACT_COLUMNS).eq("client_id", integration.client_id).gte("date", range.from).lte("date", range.to).order("date", { ascending: false }),
    admin.from("sync_jobs").select("status,done_days,total_days").eq("integration_id", integration.id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const rows = (facts ?? []) as FactRow[];
  const b = breakdown(rows);
  const importing = job?.status === "queued" || job?.status === "running";

  const money = new Intl.NumberFormat("en-US", { style: "currency", currency });
  const fmt = (v: number) => money.format(v);
  const neg = (v: number) => (v ? `−${money.format(v)}` : money.format(0));
  const link = storeLinkQuery({ shop, exp: sp.exp!, sig: sp.sig! });
  const day = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

  const lines: [string, string, boolean?][] = [
    ["Gross sales", fmt(b.grossSales)],
    ["Discounts", neg(b.discounts)],
    ["Returns", neg(b.returns)],
    ["Net sales", fmt(b.netSales)],
    ["Shipping charges", fmt(b.shipping)],
    ["Taxes", fmt(b.taxes)],
    ["Total sales", fmt(b.totalSales), true],
  ];

  return (
    <PublicPage title={(client?.name as string | undefined) ?? shop}>
      <p>
        {shop} · read-only · {currency} · time zone {tz}
      </p>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-border bg-surface px-4 py-3">
        {importing ? (
          <span className="text-text">
            Loading your order history: {job?.done_days ?? 0} of {job?.total_days ?? "…"} days. This page fills in by itself.
          </span>
        ) : (
          <span className="text-text">Order history loaded.</span>
        )}
        <StoreRefresher shop={shop} exp={sp.exp!} sig={sp.sig!} importing={importing} />
      </div>

      <nav className="flex flex-wrap gap-2" aria-label="Date range">
        {PRESETS.map((p) => (
          <Link
            key={p.key}
            href={`/shopify/store?${link}&range=${p.key}`}
            className={`rounded-lg border px-3 py-1.5 no-underline ${p.key === preset ? "border-accent text-text" : "border-border text-text-muted"}`}
          >
            {p.label}
          </Link>
        ))}
      </nav>

      <h2>
        Total sales breakdown, {day(range.from)}
        {range.from !== range.to ? ` – ${day(range.to)}` : ""}
      </h2>
      <div className="rounded-xl border border-border bg-surface p-4">
        {lines.map(([label, value, strong]) => (
          <div key={label} className={`flex justify-between border-b border-border py-1.5 last:border-0 ${strong ? "font-semibold text-text" : ""}`}>
            <span>{label}</span>
            <span className="tabular-nums">{value}</span>
          </div>
        ))}
        <div className="flex justify-between pt-3 font-semibold text-text">
          <span>Orders</span>
          <span className="tabular-nums">{b.orders}</span>
        </div>
      </div>

      <h2>New and returning customers</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-border bg-surface p-4">
          <div className="text-text">New customers</div>
          <div className="tabular-nums">
            {b.newOrders} orders · {fmt(b.newRevenue)}
          </div>
        </div>
        <div className="rounded-xl border border-border bg-surface p-4">
          <div className="text-text">Returning customers</div>
          <div className="tabular-nums">
            {b.returningOrders} orders · {fmt(b.returningRevenue)}
          </div>
        </div>
      </div>
      <p className="text-xs">Customer sales are order totals (product sales after discounts, plus shipping and taxes), before returns.</p>

      <h2>By day</h2>
      {rows.length === 0 ? (
        <p>No orders in these dates{importing ? " yet: your order history is still loading" : ""}.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-right text-xs tabular-nums">
            <thead className="bg-surface text-text">
              <tr>
                {["Date", "Orders", "Gross sales", "Discounts", "Returns", "Net sales", "Shipping", "Taxes", "Total sales"].map((h) => (
                  <th key={h} className="px-3 py-2 font-medium first:text-left">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const d = breakdown([r]);
                return (
                  <tr key={r.date} className="border-t border-border">
                    <td className="px-3 py-1.5 text-left">{day(r.date)}</td>
                    <td className="px-3 py-1.5">{d.orders}</td>
                    <td className="px-3 py-1.5">{fmt(d.grossSales)}</td>
                    <td className="px-3 py-1.5">{neg(d.discounts)}</td>
                    <td className="px-3 py-1.5">{neg(d.returns)}</td>
                    <td className="px-3 py-1.5">{fmt(d.netSales)}</td>
                    <td className="px-3 py-1.5">{fmt(d.shipping)}</td>
                    <td className="px-3 py-1.5">{fmt(d.taxes)}</td>
                    <td className="px-3 py-1.5 text-text">{fmt(d.totalSales)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <h2>Checking these numbers against Shopify</h2>
      <p>
        In your Shopify admin open Analytics, pick the same dates and look at Total sales breakdown. Dates follow your store&apos;s time zone ({tz}); returns count on the
        day of the refund; amounts are in your store currency ({currency}), so orders paid in another currency appear converted, as in Shopify. Cancelled orders are left out.
      </p>
    </PublicPage>
  );
}
