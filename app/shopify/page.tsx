import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PublicPage } from "@/components/public/PublicPage";
import { APP_NAME, COMPANY, SUPPORT_EMAIL } from "@/lib/legal";
import { normalizeShop, verifyShopifyHmac } from "@/lib/shopify";
import { getAdminClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: `${APP_NAME} for Shopify` };

const ERRORS: Record<string, string> = {
  shopify_state_mismatch: "The install link expired. Please start the install again from Shopify.",
  shopify_token_exchange_failed: "Shopify did not complete the install. Please try again.",
  shopify_invalid_request: "The install request could not be verified. Please start again from Shopify.",
};

/**
 * The app's URL in Shopify (the page Shopify opens after install and from the admin). No Apex account needed.
 * A signed request from Shopify for a store that has not installed yet starts the OAuth install.
 */
export default async function ShopifyLanding({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const shop = normalizeShop(sp.shop ?? "");
  const secret = process.env.SHOPIFY_CLIENT_SECRET;
  const signed = Boolean(shop && secret && sp.hmac && verifyShopifyHmac(new URLSearchParams(sp as Record<string, string>), secret));

  let installed = false;
  if (shop && (signed || sp.installed)) {
    const { data } = await getAdminClient().from("shopify_installs").select("uninstalled_at, ciphertext").eq("shop", shop).maybeSingle();
    installed = Boolean(data?.ciphertext && !data.uninstalled_at);
  }
  if (signed && !installed && !sp.installed) redirect(`/api/shopify/install?shop=${encodeURIComponent(shop!)}`);

  const error = sp.error ? ERRORS[sp.error] ?? "Something went wrong. Please try again or contact support." : null;
  return (
    <PublicPage title={installed ? `${APP_NAME} is installed` : APP_NAME}>
      {error && <p className="rounded-lg border border-bad/40 bg-surface px-4 py-3 text-bad">{error}</p>}
      {installed && shop && (
        <div className="rounded-xl border border-border bg-surface p-5">
          <p className="text-text">
            <strong>{shop}</strong> is connected with read-only access. You don&apos;t need to do anything else here.
          </p>
          <p className="mt-2">
            Your {COMPANY} contact will link this store to your reporting and it will start appearing in your dashboard. Nothing in your store is ever changed.
          </p>
        </div>
      )}
      <h2>What this app does</h2>
      <p>
        {APP_NAME} is data analytics software that gives you a clear view of revenue and profit: new vs returning customer revenue, contribution margin and ad efficiency, by day, week
        or month with year-over-year comparison. It reads your orders, refunds, shipping, taxes and product costs, and nothing else.
      </p>
      <h2>What it can access</h2>
      <ul>
        <li>Orders and refunds (amounts, dates, channel, tags). Customer names, emails, phones and addresses are never requested.</li>
        <li>Customer IDs and order counts, only to tell new from returning customers.</li>
        <li>Product variants and cost per item.</li>
      </ul>
      <p>Access is read-only. See the <a href="/privacy">privacy policy</a> for storage, retention and deletion.</p>
      <h2>Remove the app</h2>
      <p>
        Shopify admin → Settings → Apps and sales channels → {APP_NAME} → Uninstall. Access stops immediately. Questions:{" "}
        <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> or the <a href="/support">support page</a>.
      </p>
    </PublicPage>
  );
}
