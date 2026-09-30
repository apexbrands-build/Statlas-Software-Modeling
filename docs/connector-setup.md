# Connector setup checklist (Shopify, Meta, Google Ads)

Status: Supabase project `ccejjijwrdnzljizzwsw` (org "Apex Brands", us-east-1) has the schema from `supabase/migrations/0001_init.sql` applied. Nothing is connected yet. All integrations are **read-only**. Secrets (client secrets, tokens, developer token) go only into Vercel/Supabase environment variables, never into chat or git.

UI names below are from memory and platforms rename things often: if a menu is different, use the closest match.

## Environment variables (Vercel → Project → Settings → Environment Variables)

| Name | Where it comes from |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase publishable key (safe for the browser) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API. Server only. Never expose |
| `TOKEN_ENCRYPTION_KEY` | 32 random bytes, base64. Generate with `openssl rand -base64 32` |
| `NEXT_PUBLIC_APP_URL` | The production URL, e.g. `https://<project>.vercel.app` |
| `SHOPIFY_CLIENT_ID` / `SHOPIFY_CLIENT_SECRET` | Shopify app (below) |
| `META_APP_ID` / `META_APP_SECRET` | Meta app (below) |
| `META_SYSTEM_USER_TOKEN` | Optional: agency System User token (below) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google Cloud OAuth client |
| `GOOGLE_ADS_DEVELOPER_TOKEN` / `GOOGLE_ADS_LOGIN_CUSTOMER_ID` | Google Ads MCC |

## 1. Shopify: one app ("Apex Data"), installed on every store

1. Create the app in the Shopify **Dev Dashboard** (dev.shopify.com, sign in with the agency's Partner login).
2. App URL: `NEXT_PUBLIC_APP_URL`. Allowed redirect URL: `NEXT_PUBLIC_APP_URL/api/shopify/callback`.
3. Scopes (read only): `read_orders`, `read_customers`, `read_products`, `read_inventory`. Later request `read_all_orders` (needs Shopify approval; required for orders older than 60 days, so for year-over-year).
4. Distribution: **custom distribution** (not the public App Store). It gives an install link per store domain.
5. For each client store: open the install link as a store admin (or ask the client's admin to). This grants the app read access. Nothing is written to the store.
6. Copy Client ID and Client Secret into Vercel.

## 2. Meta (ad spend)

Fastest route, no per-client OAuth, no app review for your own managed accounts:
1. developers.facebook.com → create an app (type: Business), link it to the agency Business portfolio, add the **Marketing API** product.
2. In Business Settings → Users → **System users**: create "Apex Data" (role: Employee). Assign each client's ad account with **read-only** permission (View performance). Generate a token for the system user with the `ads_read` permission. It does not expire.
3. Put the token in `META_SYSTEM_USER_TOKEN`. Business verification and `ads_read` Advanced access are needed only if we later want clients to connect themselves via OAuth.
4. Per client we store the ad account ID (`act_…`). Existing-customer spend comes from the ad-set audience targeting (customer-list/existing-customer audiences).

## 3. Google Ads (ad spend)

1. Use the agency **manager (MCC) account**. In it: Tools → API Center → apply for a **developer token** (Basic access; approval takes days). Note the MCC customer ID (`GOOGLE_ADS_LOGIN_CUSTOMER_ID`).
2. Each client ad account must be linked to the MCC (client approves the link request).
3. Google Cloud: create a project → enable **Google Ads API** → OAuth consent screen. If `apexbrands.io` is a Google Workspace, choose **Internal**: no Google verification needed. Create an OAuth client (Web) with redirect `NEXT_PUBLIC_APP_URL/api/google/callback`.
4. One agency user with MCC access authorises once; we store its refresh token encrypted and query each client through the MCC.
5. Brand vs non-brand: campaign name contains "branded" (setting per client).

## 4. Order of work

1. Sign-in (Supabase Auth, `@apexbrands.io` only) so real data is never public. **Do this before connecting any real client.**
2. Store Settings → Connections tab: Shopify connect (shop domain → install → callback → encrypted token).
3. Shopify sync (orders, customers, product costs) → `orders`, `products`, `daily_facts`.
4. Meta and Google spend sync → `ad_spend_daily`, `daily_channel_facts`.
5. Switch the dashboard from the seed repository to the Supabase repository.
