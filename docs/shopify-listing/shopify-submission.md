# Shopify App Store submission: "Apex Analytics" (public app)

Goal: one public app that any client store can install, replacing the one-app-per-store custom apps. The code, policy pages, webhooks and listing assets are built. This file is the checklist and the text to paste into Shopify.

Field limits below are from memory; Shopify's form shows the real counters, trim if it complains.

> **Markets is not part of this submission (decided 2026-10-14).** The public app reads no address data, only customer ID and order count (Level 1), and the texts below say so. Markets (revenue by shipping country, `docs/superpowers/specs/2026-10-12-markets-design.md`) will go to the single-store consulting app first. If it later joins the public app, it needs Level 2 address access, `read_markets`, an app update and a new review: use the staged text in section 9.

## 0. Read first: risks

1. **Reviewers expect a merchant-facing app.** Positioned (as decided) as data analytics software; the listing and pages stay truthful that reports are viewed by the Apex team working with the store (do not claim merchants log in to a self-serve dashboard, or that a paid plan exists, until they are built; "planned" wording is fine). Rejection for "no merchant value" is still possible. If it happens, reply with the agency use case; the fallback is custom distribution (one install link per store, in the same Plus org or per store).
2. **Protected customer data + `read_all_orders`** both need a request in the Dev Dashboard (section 3). They can take longer than the review itself.
3. **Install flow (changed 2026-10-15).** The legacy install flow is off: the Shopify CLI refuses app-specific webhooks (the mandatory privacy topics, which the API cannot register) while it is on. Installation is managed by Shopify; the app still gets its token through its own OAuth route (`app/api/shopify/install` + `callback`), which works on the dev store. Webhooks live in [shopify.app.toml](../../shopify.app.toml) and are deployed with `npx @shopify/cli@latest app deploy --allow-updates` (client ID set in the file; never run `config link` or deploy with an empty client ID, the CLI overwrites the file with the live config and drops the webhooks). Active version: `apex-analytics-4`.
4. Contact email on every public page is `admin@apexbrands.io` (set in `lib/legal.ts`). Change it to a shared mailbox such as support@ before submitting if you have one.

## 1. Create the new app (you, in the Dev Dashboard)

Keep the existing "Apex Data" app untouched until the new one works.

1. dev.shopify.com → Apps → **Create app** → name **Apex Analytics**.
2. **Distribution → Public distribution** (this is what triggers review).
3. App setup (or run `shopify app config link` + `shopify app deploy` with the CLI, using [shopify.app.toml](../shopify.app.toml)):
   - App URL: `https://apex-data-beta.vercel.app/shopify`
   - Allowed redirection URL: `https://apex-data-beta.vercel.app/api/shopify/callback`
   - Embedded: **off**
   - Scopes: `read_orders,read_customers,read_products,read_inventory`
   - Webhooks API version `2026-10`. Subscriptions are NOT set in the Dev Dashboard form: they come from the toml through the CLI (see risk 3). Privacy topics (customer data request, customer erasure, shop erasure) and `app/uninstalled`: one endpoint for all, `https://apex-data-beta.vercel.app/api/shopify/webhooks`.
4. Copy the new **Client ID** and **Client secret**. Never paste them in chat.

## 2. Switch the deployment to the new app (you, in Vercel)

1. Vercel → Environment Variables: replace `SHOPIFY_CLIENT_ID` and `SHOPIFY_CLIENT_SECRET` with the new app's values. Redeploy.
2. The test store keeps working: its saved access key belongs to the old app and syncs do not use the client ID/secret. Keep the old "Apex Data" app installed and do NOT click Reconnect on that store. New stores install the new app. Keep the old ID/secret stored safely in case you need to swap back.
3. Push this code first (GitHub Desktop). The migration `0002_shopify_installs` is already applied in Supabase.

## 3. Requests inside the app (Dev Dashboard → app → API access requests)

**Protected customer data (Level 1; in the Partner Dashboard form: main block with the reason Analytics only, no optional field selected, never Name, Email, Phone or Address, which would show on the install screen; removing the main block makes every orders query fail with ACCESS_DENIED; we do not ask for Level 2 because we never read names, emails, phones or addresses).

- *Why do you need it?* "To classify orders as new or returning customers (customer ID and lifetime order count) so merchants and their agency see new vs returning revenue and customer acquisition cost. No personal contact data is requested or stored."
- *Data minimization:* only numeric customer ID and order count; no PII fields in any query.
- *Consent / purpose:* merchant installs the app explicitly; data used only for that store's own reporting; not sold, shared or used for advertising.
- *Security:* AES-256-GCM token encryption, TLS in transit, Supabase row-level security, access limited to authenticated Apex staff, data erased on `shop/redact`, privacy webhooks implemented and HMAC-verified.
- *Retention and deletion:* until uninstall plus Shopify's erasure request; deletion on request within 30 days. Policy: `/privacy`.

**`read_all_orders`** (needed for years of history and year-over-year; without it only the last 60 days exist): "Read-only analytics. Year-over-year and seasonal comparison (e.g. Black Friday vs previous years) is the core feature and requires orders older than 60 days. No personal data is stored." After approval: add the scope in the app config, set `SHOPIFY_ALL_ORDERS=true` in Vercel, redeploy, release a new app version.

## 4. Listing (App Store listing form)

| Field | Text |
|---|---|
| App name | Apex Analytics |
| Tagline (≈62) | New vs returning revenue and profit, in one clear view |
| Intro (≈100) | Read-only revenue, customer and contribution margin analytics for your store. |
| Description (≤500, this text is 499) | Apex Analytics is read-only data analytics for your store. It reads orders, refunds, shipping, taxes and product costs and shows new vs returning customer revenue, contribution margin, MER and acquisition cost, with year-over-year comparison, a report library and a forecast with daily targets against actuals. It never changes your store or requests customer names, emails or addresses. Today the Apex Brands team working with your store views reports; direct access and a subscription are planned. |
| Features (5, ≤80 characters each) | New vs returning customer revenue with year-over-year comparison · Contribution margin with product costs and refunds · Reports library, plus Black Friday / Cyber Monday and seasonal views · Forecast plan with daily targets shown against actual results · Read-only access, no customer contact data |
| Search terms | analytics, contribution margin, profit, LTV, retention, reporting |
| Category | Reporting (or Analytics) |
| Pricing | Free for now. If you later charge non-clients, the charge must go through Shopify's billing (Shopify requires it for apps installed from the App Store); that needs a small build and a listing update. Do not mention prices in the listing today. |
| Privacy policy URL | `https://apex-data-beta.vercel.app/privacy` |
| Support URL / email | `https://apex-data-beta.vercel.app/support` / `admin@apexbrands.io` |
| Languages | English |

Assets in [docs/shopify-listing/](shopify-listing/):

| File | Use | Alt text |
|---|---|---|
| `icon-1200.png` (1200×1200) | App icon (white Λ on black, from the brand identity) | Apex Analytics logo, a white A-shaped mark on a black background |
| `feature-1600x900.png` | Feature image | Apex Analytics: new vs returning revenue, contribution margin and ad efficiency, read-only |
| `screenshot-1-dashboard.png` | Screenshot | Dashboard with contribution margin, order revenue, ad spend, MER and a daily trend chart compared with last year |
| `screenshot-2-new-vs-returning.png` | Screenshot | Returning customers, new customers and paid incremental metric cards with year-over-year change |
| `screenshot-3-channel-performance.png` | Screenshot | Channel performance cards for Meta, Google and Pinterest with email metrics |

The screenshots use the built-in demo store ("Northwind Jewellery", fake data), never a real client. The icon has square corners: Shopify displays it rounded; if the form insists on rounded corners, upload it again after rounding in any image tool.

## 5. Test instructions for the reviewer (paste into "Testing instructions")

> Apex Analytics is a read-only data analytics app. Merchants install it; the reports are currently viewed in a separate dashboard by the Apex Brands team working with the store. Direct dashboard access for brands, and a paid subscription for brands outside Apex, are planned and not part of this submission.
>
> 1. Install the app on your development store from the app listing / install link. You will see Shopify's permission screen (read orders, customers, products, inventory) and land on the app page confirming the store is connected, with what is accessed and how to uninstall. No account is needed for this.
> 2. To see the reporting dashboard, sign in at https://apex-data-beta.vercel.app/login with the review account: **[email]** / **[password]** (provided in the credentials field, not here). Go to Store Settings → Add Connection → Shopify, enter your store's `.myshopify.com` domain and click Connect: the existing install is linked. Click Edit on the Shopify row → Sync now. Then open Home to see revenue, new vs returning, and contribution margin. The sidebar pages Reporting (report library), Planning (forecast plan with daily targets) and Calendar (marketing events) use the same read-only order data.
> 3. Uninstall from Settings → Apps. The app receives `app/uninstalled` and stops access; `shop/redact`, `customers/redact` and `customers/data_request` are handled at `/api/shopify/webhooks` (HMAC-verified).
>
> The app never writes to the store. Privacy policy: /privacy. Support: /support.

Before submitting you must create the **review account** (Supabase → Authentication → Add user, email like `shopify-review@apexbrands.io`, a strong password, email auto-confirmed) and give it access to a client for the reviewer's store. Put the credentials only in Shopify's credentials field. Delete or rotate the account after review.

## 6. Screencast (required, English, 2-3 min)

Record: (1) install on a dev store and the permission screen; (2) the confirmation page; (3) sign in with the review account, link the store, sync, open Home and show the metrics, then tour Reporting, Planning and Calendar; (4) show `/privacy`; (5) uninstall from Shopify admin. Use a dev store with sample orders, never a client store.

## 7. Dev-store smoke test before submitting (you + me)

1. Create a development store with some test orders (Dev Dashboard → test stores).
2. Install the new app from the Dev Dashboard install link → you should land on `/shopify?…&installed=1` with "is connected".
3. In the dashboard link the store to a client, run Sync now, check Home.
4. Uninstall → check Store Settings shows the connection as disconnected.
5. Dev Dashboard → Webhooks → send test notifications for the three privacy topics → expect HTTP 200. Tell me the result and I fix anything that fails.

## 8. Submit

Dev Dashboard → app → Distribution/Listing → fill the form with sections 4-6 → **Submit for review**. Shopify emails the outcome to the Partner account email; paste any reviewer feedback here and I will fix it.

## 9. Staged for a later update: Markets in the public app (not in this submission)

Only if Markets joins the public app. Change these in the same release as the sync that reads `shippingAddress { countryCodeV2 }`, add `read_markets` and Level 2 address access (extra security questions; fallback if refused: ShopifyQL aggregates by country, see the Markets spec), update the listing (description: "it reads only the shipping country code, to show revenue by market"; feature: "Revenue by market, from the shipping country"), test instructions and screencast, then resubmit.

- `app/privacy/page.tsx`, list "Data we read from your store": replace the Orders item with "Orders: date, sales channel, tags, gross sales, discounts, shipping charged, taxes, refunds, line items (variant ID and quantity), and the shipping country code."
- `app/privacy/page.tsx`, paragraph under that list: replace with "From each order we read only the **country of the shipping address** (a two-letter code such as GB or DE) and store only that code, so the merchant and their agency team can see revenue by market. We do **not** request or store customer names, email addresses, phone numbers, or street addresses. We do not read payment details."
- `app/shopify/page.tsx`, list "What it can access": replace the Orders item with "Orders and refunds (amounts, dates, channel, tags) and the shipping country code of each order. Customer names, emails, phones and street addresses are never requested."


## 10. Submission log

- **2026-10-15: submitted for review.** Listing: App details mention reports and the forecast (499/500), five features. Screencast: https://youtu.be/vfid4VB4OU4 (Unlisted, about 2:37, script in `docs/shopify-listing/shopify-screencast-script.md`). Review account `shopify-review@apexbrands.io` (password only in Shopify's credentials field), member role, access to the Apex Analytics Test client only (Point6 access removed). Delete or rotate the account after the review.
- **Lessons from the run-up:** the dev store's 60 orders came through the "Matrixify App" channel and must be switched on in Store Settings > Edit > Channels (the list now comes from the store's orders); the active version had no webhook subscriptions until `apex-analytics-4`, so an uninstall never reached the app and a reinstall kept a revoked token (Shopify 401); an Address field left selected in the protected data request made the install screen say "physical address"; a reviewer who creates orders by hand may see a channel other than "Online Store" and an empty Home.
