# Screencast script: Apex Analytics (about 3 min, English)

Updated 2026-10-12 for the shipping-country access (Markets). Record it only after Markets is built (`docs/superpowers/specs/2026-10-12-markets-design.md`).

Before recording: use a **development store with sample orders in at least two countries** (never a client store), the review account created in Supabase, markets already set up for the review client (for example UK = GB and Germany = DE), and a screen recorder (QuickTime: File > New Screen Recording; or Loom). Speak in English. Upload to YouTube as **Unlisted** and send the link.

Setup: browser tab 1 = Shopify admin of the dev store; tab 2 = https://apex-data-beta.vercel.app/login. Sign out of the dashboard first.

| # | Time | Do on screen | Say |
|---|---|---|---|
| 1 | 0:00 | Show the app's install link / Dev Dashboard install page | "This is Apex Analytics, a read-only analytics app. I'm installing it on a development store." |
| 2 | 0:15 | Click Install; pause on Shopify's permission screen | "Shopify shows the permissions: read orders, customers, products and inventory. The app never writes to the store. It never asks for customer names, emails, phone numbers or street addresses. From each order it reads only the shipping country code, to report revenue by market." |
| 3 | 0:40 | Approve; land on the confirmation page (/shopify...installed=1) | "After install the merchant lands on a page confirming the store is connected, what is accessed, and how to uninstall." |
| 4 | 1:00 | Go to tab 2, sign in with the review account | "Reports are viewed in our dashboard. I'm signing in with the review account." |
| 5 | 1:15 | Store Settings > Add Connection > Shopify, enter the dev store's .myshopify.com domain, Connect | "I link the installed store to a client." |
| 6 | 1:35 | Edit on the Shopify row > Sync now; wait for it | "I run a sync. The app reads orders, refunds, shipping, product costs and each order's shipping country code." |
| 7 | 1:55 | Open Home; point to Contribution Margin, Order Revenue, New vs Returning, year-over-year compare | "Here are revenue, new versus returning customers, and contribution margin, with year-over-year comparison." |
| 8 | 2:15 | Store Settings > Markets (show the country list of a market), then Home > Market selector, pick one market | "A brand that sells in several countries from one store defines its markets here, as lists of country codes. The selector shows each market's revenue against its share of the forecast. Only the country code is stored: no names, emails, phone numbers or street addresses." |
| 9 | 2:40 | Open https://apex-data-beta.vercel.app/privacy | "This is our privacy policy. It states exactly what we read, including the shipping country code. Data is erased on Shopify's erasure requests, and we handle the privacy webhooks." |
| 10 | 2:55 | Shopify admin > Settings > Apps > Apex Analytics > Uninstall | "Finally I uninstall the app from the Shopify admin. Access stops immediately." |
| 11 | 3:10 | Back in Store Settings, show the connection as disconnected | "The dashboard now shows the store as disconnected. Thank you." |

Tips: keep the mouse slow, zoom the browser to 110%, close other tabs and notifications, and do one dry run first.
