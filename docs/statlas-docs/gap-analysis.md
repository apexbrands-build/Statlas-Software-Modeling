# What the Statlas docs mean for our app (2026-10-02)

Nothing here is built yet; items marked **Decide** need the user's go-ahead (CLAUDE.md rule: no new phase without approval).

## Already consistent with Statlas
- Order Revenue as the revenue definition, MER / aMER / CAC / AOV formulas, CM structure (we keep fixed costs out of CM, as Statlas does: Basic CM vs Full CM).
- Plan vs actual with goal columns, P&L, Paid Media, MER report, 7-day-click attribution, incrementality multipliers, background sync jobs.

## Differences worth knowing
1. **Revenue definitions**: Statlas offers 8; we only have Order Revenue (+ Net Sales for CM). Adding a per-client selector is cheap. **Decide** (low priority, we confirmed Order Revenue for all clients).
2. **Churn default**: the docs give two versions (40th/80th percentile of days between orders, and a 120-day fallback). Our `docs/statlas-findings.md` §8 already records the percentile table. Churn is **not built**; needed for Net Active Customer, LTV and New vs Returning reports.
3. **Net Active Customer** has five segments (New, Returning, Reactivated, At-Risk, Churned) using end-of-period snapshots, with Net Active = New + Returning + Reactivated - Churned. This is the precise spec for our unbuilt `net-active-customers` report.
4. **Refund timing**: Statlas CM report shows refunds on the day processed, not on the original sale day. Check we do the same (our `daily_facts` should be by processed date) and say so in the report footer.
5. **Zero-dollar orders and giveaways** are excluded, and free orders do not count as a customer's first order. Check `recompute_first_orders` and the order sync for this. **Decide** if a gap shows up (affects new vs returning).
6. **Order date, not ship date**, for revenue; first-order logic should use processed date.
7. **Facebook attribution** options (click 1/7/28, view 1/7, click type, exclude onsite) are stored per store; ours is fixed at 7-day click. Meta API can request these windows, so this could become a per-client setting. **Decide**.
8. **Paid Media**: Statlas has funnel (ATC, checkout, purchase) and video (thruplay, 3s view, quartiles) columns. We do not store clicks/impressions yet (see reports-plan.md). Next data step if we want CTR/CPC/CPM.
9. **Product by First Product** (V1 report): groups by first-order product, credits all products in the order, shows 2nd/3rd/4th+ order rates. We have the data (orders + line items) and it is not on our reports list. **Decide**: add to the library? (Not one of the four forbidden reports.)
10. **Email Metrics**: rules are now clear (GA adds to Klaviyo clicks/orders, Klaviyo wins for opens/deliverability, GA channel filter). Needs Klaviyo + GA4 connectors first.
11. **Email Plan tool**: a month-level email forecast (Planned / Projected / Target / Gap). Fits our planning layer once Klaviyo exists. Future idea.
12. **Calendar report**: marketing-actions column is the event calendar we already want (events from Klaviyo/SMS plus a register of initiatives).
13. **Sync cadence**: Statlas refreshes Shopify 4x/day and ads daily (some hourly). Ours is a daily cron; consider more Shopify runs later.
14. **Reliability**: Statlas retries after 15 min and raises an incident after two failed cycles. Our `sync_jobs` auto-splits on timeout; an alert after repeated failures is a possible addition.
15. **Onboarding checklist**: the custom-integration list (timezone, excluded statuses, edit window for orders, quality check on two reference months, periods to exclude from forecasts) is a good template for onboarding each of the 30+ clients. **Decide**: turn into a doc/checklist in the app.

## Structure change made
- New folder `docs/statlas-docs/` (this archive) and a pointer from `CLAUDE.md` and `docs/changelog.md`. No code changes.

## Status after the follow-up (2026-10-02)
- **Refund timing (4): verified, no change.** `order_refunds` is dated by the refund itself and `rebuild_daily_facts` rolls refunds up by that date, same as Statlas.
- **Free orders (5): NOT done, needs the user.** Live functions `recompute_first_orders` and `rebuild_daily_facts` count zero-dollar orders and can make one the "first order". Only 3 of 30,039 orders for the live client are free, so impact is tiny. Fix = a migration (`0005`) that excludes `order_revenue <= 0` from the rollup and from first-order selection (still counting them in Shopify's lifetime-order check). Claude's attempt to write and apply it was blocked by the permission system, so it is left for the user to approve.
- **Facebook attribution (7): built.** Settings > Facebook Settings now has working Click Window (1/7/28 day) and View Window (Disabled/1/7 day), saved per client (`extra.fbAttrClick`, `fbAttrView`, defaults 7 Day / Disabled so nothing changes today). The Meta sync reads them (`lib/sync/meta-windows.ts`). Re-run the Meta history load to restate older days. Click type and onsite exclusion are still "not applied".
- **Onboarding checklist (15): built.** `/onboarding` (sidebar: Tools & Settings), content in `lib/onboarding-checklist.ts`; ticks saved per client in the browser only.
- **Product by First Product (9): NOT built.** The `orders` table has no line items, so the report needs a new `order_lines` table, a Shopify sync change and a history reload. That is a schema change and was not started.

## Status after the second follow-up (2026-10-02)
- **Product by First Product (9): built in code**, report `/reporting/first-product` (LTV category) with the four variations, total row (not for AOV), refunds and top 1,000 products. Checked on seed data. It shows a clear "not stored yet" message until the database part is applied.
- **Needs the user (the permission system blocked Claude from changing the live database twice):** apply these two migration files in the Supabase SQL editor (or ask Claude again after allowing it):
  1. `supabase/migrations/0005_exclude_free_orders.sql` (free orders). Afterwards run the Shopify history load (or `select recompute_first_orders('<client>')` then `rebuild_daily_facts`) so past days are restated.
  2. `supabase/migrations/0006_order_lines.sql` (line items table + `first_product_report` function). Then re-run the Shopify history load to backfill line items. The Shopify sync already writes lines and quietly skips them until the table exists, so deploying before applying is safe.
