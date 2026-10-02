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
