# Shopify screencast: Apex Analytics (about 3 minutes, English)

Updated 2026-10-15. No Markets, no country code (the app reads no address data). Includes a short tour of Reporting, Planning and Calendar.

## Before you record

- **First fix the data request in Shopify.** Partner Dashboard > Apex Analytics > API access requests > Protected customer data access. The draft has **Address** selected (reason "Marketing or advertising"), left over from the Markets plan. Remove it, then uninstall and reinstall the app so the permission screen stops saying "physical address". Record the install steps only after that, or the screen will contradict the narration.

- Tab 1: Shopify admin of the dev store (Apex Analytics test). Tab 2: https://apex-data-beta.vercel.app/login (signed out).
- Test store: 60 orders, all dated Oct 1, from the "Matrixify App" channel (switched on in Store Settings > Edit > Channels). Stay on **month to date** or Oct 1 in every report, anything else shows zeros.
- A plan exists for the test client: "2026 Plan - Most Likely".
- Browser zoom 110%, other tabs and notifications closed.
- Do one dry run first. Upload to YouTube as **Unlisted**.

## The steps

### 1. Install link (0:00)
**Show:** the app's install link (Dev Dashboard install page).
**Say:** "This is Apex Analytics, a read-only analytics app. I'm installing it on a development store."

### 2. Permission screen (0:15, about 30 seconds)
**Show:** click Install, stop on Shopify's permission screen. Let the customer data lines stay on screen while you speak, don't hide them.
**Say:** "Shopify lists the data this app can view: orders, customers, products and inventory. The app only reads order amounts, dates and refunds, a numeric customer ID and order count to tell new from returning customers, and product costs. It does not request customer names, emails, phone numbers or addresses, and it never writes to the store."

### 3. Confirmation page (0:35)
**Show:** click Approve, land on the confirmation page.
**Say:** "After install the merchant lands on a page confirming the store is connected, what is accessed, and how to uninstall."

### 4. Sign in (0:55)
**Show:** go to tab 2, sign in with the review account.
**Say:** "Reports are viewed in our dashboard. I'm signing in with the review account."

### 5. Link the store (1:10)
**Show:** Store Settings > Add Connection > Shopify. Type the dev store's .myshopify.com domain, click Connect.
**Say:** "I link the installed store to a client."

### 6. Sync (1:30)
**Show:** Edit on the Shopify row > Sync now. Wait for it to finish.
**Say:** "I run a sync. The app reads orders, refunds, shipping and product costs."

### 7. Home (1:50)
**Show:** open Home (it opens on month to date). Point at Contribution Margin, Order Revenue, New vs Returning. Don't linger on the trend chart.
**Say:** "Here are revenue, new versus returning customers, and contribution margin from the store's orders. Every number can be compared with the plan or with last year."

### 8. The other pages (2:05)
**Show:** sidebar > Reporting, open Contribution Margin. Then Planning, open "2026 Plan - Most Likely". Then Calendar for a second.
**Say:** "The other pages use the same data. Reporting is a library of reports built from the store's orders. Planning turns past orders into a forecast with daily targets, shown against actual results. Calendar holds the marketing events. All of it is calculated from the read-only data: nothing is written back to the store."

### 9. Privacy policy (2:30)
**Show:** open https://apex-data-beta.vercel.app/privacy
**Say:** "This is our privacy policy. It states exactly what we read. Data is erased on Shopify's erasure requests, and we handle the privacy webhooks."

### 10. Uninstall (2:45)
**Show:** Shopify admin > Settings > Apps > Apex Analytics > Uninstall.
**Say:** "Finally I uninstall the app from the Shopify admin. Access stops immediately."

### 11. Disconnected (3:00)
**Show:** back in Store Settings, show the connection as disconnected.
**Say:** "The dashboard now shows the store as disconnected. Thank you."

---

## Narration only (for ElevenLabs)

Paste one paragraph at a time and generate one clip per step, so each clip can be placed where its step happens on screen. Don't paste the headings.

This is Apex Analytics, a read-only analytics app. I'm installing it on a development store.

Shopify lists the data this app can view: orders, customers, products and inventory. The app only reads order amounts, dates and refunds, a numeric customer ID and order count to tell new from returning customers, and product costs. It does not request customer names, emails, phone numbers or addresses, and it never writes to the store.

After install the merchant lands on a page confirming the store is connected, what is accessed, and how to uninstall.

Reports are viewed in our dashboard. I'm signing in with the review account.

I link the installed store to a client.

I run a sync. The app reads orders, refunds, shipping and product costs.

Here are revenue, new versus returning customers, and contribution margin from the store's orders. Every number can be compared with the plan or with last year.

The other pages use the same data. Reporting is a library of reports built from the store's orders. Planning turns past orders into a forecast with daily targets, shown against actual results. Calendar holds the marketing events. All of it is calculated from the read-only data: nothing is written back to the store.

This is our privacy policy. It states exactly what we read. Data is erased on Shopify's erasure requests, and we handle the privacy webhooks.

Finally I uninstall the app from the Shopify admin. Access stops immediately.

The dashboard now shows the store as disconnected. Thank you.
