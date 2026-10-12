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
  /** True when an account can be connected (its key or login is checked and saved). Others show "Soon" in Add Connection. */
  available: boolean;
  /** True when the connector also pulls data (has a sync in `lib/sync/registry.ts`). A connection-only provider has no daily job. */
  syncs: boolean;
  /** The account id comes from checking the key, so the form does not ask for it (Klaviyo). */
  accountFromKey?: boolean;
  accountLabel: string;
  accountPlaceholder: string;
  /** Short setup steps shown on the Add Connection card; each connector spec fills its own. */
  setupSteps: string[];
}

const p = (id: ProviderId, label: string, kind: ProviderKind, auth: ProviderAuth, available: boolean, accountLabel: string, accountPlaceholder: string, more: { syncs?: boolean; accountFromKey?: boolean; setupSteps?: string[] } = {}): ProviderMeta => ({
  id,
  label,
  icon: id,
  kind,
  auth,
  available,
  syncs: more.syncs ?? false,
  accountFromKey: more.accountFromKey,
  accountLabel,
  accountPlaceholder,
  setupSteps: more.setupSteps ?? [],
});

export const PROVIDERS: Record<ProviderId, ProviderMeta> = {
  shopify: p("shopify", "Shopify", "commerce", "shopify-oauth", true, "Store domain", "store-name.myshopify.com", { syncs: true }),
  meta: p("meta", "Facebook", "ads", "agency-token", true, "Ad account ID", "act_1234567890", { syncs: true }),
  google_ads: p("google_ads", "Google Ads", "ads", "agency-google", true, "Customer ID", "123-456-7890", { syncs: true }),
  // Provisional auth for the ad platforms below: revisited in the ad-platform spec.
  pinterest: p("pinterest", "Pinterest", "ads", "agency-token", false, "Ad account ID", ""),
  tiktok: p("tiktok", "TikTok", "ads", "agency-token", false, "Ad account ID", ""),
  bing: p("bing", "Bing Ads", "ads", "agency-token", false, "Ad account ID", ""),
  snapchat: p("snapchat", "Snapchat", "ads", "agency-token", false, "Ad account ID", ""),
  youtube: p("youtube", "YouTube", "ads", "agency-token", false, "Ad account ID", ""),
  applovin: p("applovin", "AppLovin", "ads", "agency-token", false, "Ad account ID", ""),
  klaviyo: p("klaviyo", "Klaviyo", "messaging", "client-key", true, "Account name", "Filled in from the key", {
    accountFromKey: true,
    setupSteps: ["In Klaviyo open Settings, then API keys, and create a Private API key.", "Give it Read-Only access, or the read scopes Accounts, Campaigns, Flows, Metrics, Events, Lists and Segments.", "Paste the key below. The account is read from the key, so nothing else is needed."],
  }),
  postscript: p("postscript", "Postscript", "messaging", "client-key", true, "Shop name", "e.g. Acme Co", {
    setupSteps: ["In Postscript open Account, then API, and copy the Private API key (not the Public one).", "Type the shop name so the connection has a label, and paste the key below."],
  }),
  omnisend: p("omnisend", "Omnisend", "messaging", "client-key", true, "Brand name", "e.g. Acme Co", {
    setupSteps: ["In Omnisend open Store settings, then Integrations and API, then API keys, and create a key with read access.", "Type the brand name so the connection has a label, and paste the key below."],
  }),
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
