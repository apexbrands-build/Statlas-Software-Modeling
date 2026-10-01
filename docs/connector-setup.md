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

### Longer Shopify history (read_all_orders)

Without it Shopify only returns the last 60 days. To load years (and enable year-over-year):
1. Shopify Dev Dashboard → the app → **API access requests** → request `read_all_orders` and explain the use (internal analytics, read-only, no customer personal data stored).
2. When Shopify approves it, add the variable `SHOPIFY_ALL_ORDERS=true` in Vercel and redeploy. The app then requests the extra scope.
3. In the app's configuration add `read_all_orders` to the access scopes and release a new version.
4. Re-run **Connect Shopify** for each store (the store admin approves the extra scope once).
5. Open Edit on the Shopify row → **Load history**.

## 2. Meta (ad spend): exact steps

Do these yourself (not automated, to keep the Meta account safe). UI names may differ slightly.

1. **App.** developers.facebook.com → My Apps → Create App → use case "Other" → type **Business** → name `Apex Data`, your contact email, and select the **Apex Brands business portfolio**. Add the **Marketing API** product. Leave the app in Development mode.
2. **Link the app to the business.** business.facebook.com → Business settings → Accounts → **Apps** → Add → connect `Apex Data`. (Without this the app will not appear when generating the token.)
3. **System user.** Business settings → Users → **System users** → Add → name `Apex Data`, role **Employee**.
4. **Assign client ad accounts (read-only).** Open the system user → **Add assets** → Ad accounts → tick each client ad account (partner-shared ones appear here) → turn on **View performance** only → Save. Repeat when a new client is added.
5. **Generate the token.** Same system user → **Generate new token** → pick the `Apex Data` app → expiration **Never** → permission **`ads_read`** only → Generate → copy it once.
6. **Vercel.** Add `META_SYSTEM_USER_TOKEN` (the token) and redeploy. Never paste it in chat.
7. **In the dashboard.** Store Settings → Connections → Meta → paste the ad account ID (Ads Manager shows `act=1234567890` in the URL) → **Connect Meta** → **Sync now**.
8. If Meta answers with an "app access level" or permission error, the app needs **Advanced access** to `ads_read` (App Review: short screen recording + privacy policy URL; takes 1-4 weeks). Standard access usually works for accounts inside your own business portfolio.

How spend is split today: campaigns whose name contains retention, existing, returning, crm, lapsed or reactivation count as **Meta returning**; everything else is **Meta acquisition**. To be confirmed (see questions).

## 3. Google Ads (ad spend): exact steps

Built: one-time agency authorization, per-client account connect, spend and purchase-conversion sync (API version `v25`, override with `GOOGLE_ADS_API_VERSION`). Brand vs non-brand = campaign name contains the client's brand keyword (Edit → aMER/CAC Calculation → Google brand keyword, default "brand"; names with the tag "NB" as its own word, or "non-brand", are never treated as brand).

1. **API access (no developer token needed).** Since September 2026 Google manages API access levels per **Google Cloud project** (the project that issues the OAuth client), and developer tokens are no longer required. Check the level under Cloud Console → APIs & Services → Google Ads API. A developer token, if you still have one, is optional (`GOOGLE_ADS_DEVELOPER_TOKEN`).
2. **MCC ID.** The manager account's 10-digit ID, digits only (`GOOGLE_ADS_LOGIN_CUSTOMER_ID`).
3. **Client accounts under the MCC.** Each client's Google Ads account must be linked to the MCC (MCC → Accounts → Sub-account settings → Link existing account; the client approves).
4. **Google Cloud.** console.cloud.google.com → new project `apex-data` → APIs & Services → Library → enable **Google Ads API** → OAuth consent screen → user type **Internal** (Workspace) → app name, support email → add scope `https://www.googleapis.com/auth/adwords` → Credentials → Create credentials → **OAuth client ID** → Web application → authorized redirect URI `https://apex-data-beta.vercel.app/api/google/callback`. Copy Client ID and Client secret.
5. **Vercel variables** (then redeploy): `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (Sensitive), `GOOGLE_ADS_LOGIN_CUSTOMER_ID`. Optional: `GOOGLE_ADS_DEVELOPER_TOKEN`.
6. **Authorize once** (an admin signed in to the app): Store Settings → Add Connection → Google Ads → **Authorize Google**. Sign in with the Google account that has MCC access and approve. The refresh token is stored encrypted on the server.
7. **Connect a client account:** Add Connection → Google Ads → enter the client's 10-digit customer ID → Connect → Edit → **Sync now**.

Notes: Google applies each conversion action's own attribution window (not a forced 7-day click). Purchases come from conversion actions categorised as Purchase.

## 4. Order of work

1. Sign-in (Supabase Auth, `@apexbrands.io` only) so real data is never public. **Do this before connecting any real client.**
2. Store Settings → Connections tab: Shopify connect (shop domain → install → callback → encrypted token).
3. Shopify sync (orders, customers, product costs) → `orders`, `products`, `daily_facts`.
4. Meta and Google spend sync → `ad_spend_daily`, `daily_channel_facts`.
5. Switch the dashboard from the seed repository to the Supabase repository.


## Background syncs (history loads and the daily refresh)

- **Load history** creates a job on the server (table `sync_jobs`). Each chunk runs as its own short server task and starts the next, so you can close the window or leave the page. A chunk that is too heavy is split in half automatically. Progress shows on the connection's row in Store Settings. **Stop** cancels; **Resume** restarts a job that was cut off.
- **Daily refresh:** `vercel.json` schedules `/api/jobs/tick` every day at 06:00 UTC. It restarts stalled jobs and re-syncs the last 14 days of every connection. To turn it on add the Vercel variable **`CRON_SECRET`** (any long random string, Sensitive); Vercel then sends it to the cron route automatically. Without it the route refuses to run.
- On the Hobby plan Vercel allows one cron run per day. A paid plan allows more frequent runs (change the schedule in `vercel.json`).
