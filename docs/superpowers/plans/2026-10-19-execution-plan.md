# Execution plan, from 2026-10-19 (strategist's priorities)

Order is the strategist's. Each new report or connector still needs a go-ahead before it starts.

## 1. Ad-level Meta data (done in code, reload pending)
- Cause: a history load skips days already covered by the campaign step, so ad-level data that failed on 2026-10-14 was never re-pulled.
- Built: `createJob(..., { reload: true })`, the "Reload all" button next to "Load history" in Store Settings (commit 65ad899). Use it for any client whose ad-level data has gaps.
- Point6: job `c4e2ec3f` was rewound to reload 2023-10-29 to 2026-10-13 (newest first). It needs a Resume click in Store Settings > Meta > Load history (the runner was stalled). Afterwards: check `meta_ad_daily` by month against `ad_spend_daily`, then the Ad plan and Creative Score on real data.

## 2. Home metric modal ("eye" icon): show days, not the month total
- Rule (same as the trend chart on Home): up to 60 days one point per day; above 60 days group by month. Month to date must show each day of October.
- Applies to every metric's modal.

## 3. New paid incremental metrics (Home tiles, modal and report)
Same set as Total paid incremental, for new customers only: i-orders, paid AOV, paid incremental CAC, **incremental paid aMER (new)**, and both percentages (new paid iRevenue as % of new revenue, paid iRevenue as % of revenue). Most important: total incremental paid aMER and new incremental paid aMER as a Home data point and as a report.

## 4. Calendar report (`/reporting/calendar`, "Calendar MER")
Most important daily report. Needs reference screenshots (see docs/statlas-findings.md "Calendar Report") and the events from the Calendar page. Visual mock first, then build.

## 5. Hourly report (`/reporting/hourly`)
Needed for BFCM (Black Friday 2026-11-27). Calendar report with hourly tracking. Needs hourly order data from Shopify (orders carry timestamps; hourly spend from Meta/Google). Visual mock first.

## 6. Connectors to test
- Klaviyo: admin creates a private API key (read scopes); paste it in Add Connection. Data sync is not built yet.
- GA4: via Google OAuth with analytics scope; the Google Ads MCC alone does not give GA4 access.
- Vercel: confirm the daily sync tick runs (`CRON_SECRET`).

## Last priority
Subscriptions, creative intelligence layer, Amazon.
