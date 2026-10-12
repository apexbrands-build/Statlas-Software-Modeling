/** Browser-safe metadata for every data provider. Server-only sync functions live in `lib/sync/registry.ts`. */

export type ProviderId =
  | "shopify"
  | "meta"
  | "google_ads"
  | "pinterest"
  | "tiktok"
  | "bing"
  | "snapchat"
  | "youtube"
  | "applovin"
  | "klaviyo"
  | "postscript"
  | "omnisend"
  | "ga4";

export type ProviderKind = "commerce" | "ads" | "messaging" | "analytics";

/** How the credentials are held: Shopify OAuth per store, one agency token (Meta), the agency Google login, or an API key per client. */
export type ProviderAuth = "shopify-oauth" | "agency-token" | "agency-google" | "client-key";

export interface ProviderMeta {
  id: ProviderId;
  label: string;
  /** Key passed to BrandIcon. */
  icon: string;
  kind: ProviderKind;
  auth: ProviderAuth;
  /** True when the connector exists and syncs. Others show "Soon" in Add Connection. */
  available: boolean;
  accountLabel: string;
  accountPlaceholder: string;
  /** Short setup steps shown on the Add Connection card; each connector spec fills its own. */
  setupSteps: string[];
}

const p = (id: ProviderId, label: string, kind: ProviderKind, auth: ProviderAuth, available: boolean, accountLabel: string, accountPlaceholder: string): ProviderMeta => ({
  id,
  label,
  icon: id,
  kind,
  auth,
  available,
  accountLabel,
  accountPlaceholder,
  setupSteps: [],
});

export const PROVIDERS: Record<ProviderId, ProviderMeta> = {
  shopify: p("shopify", "Shopify", "commerce", "shopify-oauth", true, "Store domain", "store-name.myshopify.com"),
  meta: p("meta", "Facebook", "ads", "agency-token", true, "Ad account ID", "act_1234567890"),
  google_ads: p("google_ads", "Google Ads", "ads", "agency-google", true, "Customer ID", "123-456-7890"),
  // Provisional auth for the ad platforms below: revisited in the ad-platform spec.
  pinterest: p("pinterest", "Pinterest", "ads", "agency-token", false, "Ad account ID", ""),
  tiktok: p("tiktok", "TikTok", "ads", "agency-token", false, "Ad account ID", ""),
  bing: p("bing", "Bing Ads", "ads", "agency-token", false, "Ad account ID", ""),
  snapchat: p("snapchat", "Snapchat", "ads", "agency-token", false, "Ad account ID", ""),
  youtube: p("youtube", "YouTube", "ads", "agency-token", false, "Ad account ID", ""),
  applovin: p("applovin", "AppLovin", "ads", "agency-token", false, "Ad account ID", ""),
  klaviyo: p("klaviyo", "Klaviyo", "messaging", "client-key", false, "Account name", "e.g. Acme Co"),
  postscript: p("postscript", "Postscript", "messaging", "client-key", false, "Shop ID", "e.g. 12345"),
  omnisend: p("omnisend", "Omnisend", "messaging", "client-key", false, "Brand name", "e.g. Acme Co"),
  ga4: p("ga4", "GA4", "analytics", "agency-google", false, "GA4 property ID", "e.g. 123456789"),
};

/** Every value the database accepts in `integrations.provider` (migration 0009). */
export const DB_PROVIDER_IDS: string[] = [...Object.keys(PROVIDERS), "other"];

/** A connection shows "Needs attention" after this many consecutive failed daily syncs. */
export const FAILURE_ALERT_AT = 2;

export function providerLabel(id: string): string {
  return PROVIDERS[id as ProviderId]?.label ?? id;
}

export function needsAttention(failures: number | null | undefined): boolean {
  return (failures ?? 0) >= FAILURE_ALERT_AT;
}
