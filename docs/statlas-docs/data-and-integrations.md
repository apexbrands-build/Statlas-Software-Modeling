# Data, integrations and SLAs

## Custom integration checklist (non-standard stores)
- Delivery: flat files (CSV/JSON via SFTP/cloud/S3), direct DB (BigQuery/ODBC), or API.
- Must align: order count and revenue, gross sales, new vs returning, returns, COGS, variable costs, shipping, taxes, discounts; currency, timezone, excluded order statuses.
- History: how far back, and how long orders stay editable (matters for returns and forecasting).
- Quality check on two reference months (Nov 2023 and Nov 2024): gross, discounts, shipping, taxes, returns, total, P&L.
- Flag history that should be excluded or treated differently in forecasting: stock-outs, migrations, business pivots, price changes.
- First-time order = first valid order per customer (identifier: email, ID or hybrid). Only email or customer ID needed (hashing offered).
- Optional: inventory, hourly orders, product mapping. Special cases to document: VAT/duties, giveaways, gift cards, subscriptions. Sales channels (online, POS, wholesale, Amazon, TikTok Shop) can be excluded from marketing/forecast models.

## Data model
- Zero-dollar orders excluded; giveaways treated as marketing orders but not reported; POS/wholesale/draft usually filtered.
- New vs returning rebuilt from full order history, ignoring free orders for "first purchase", using processed (not created) date; known fixes e.g. TikTok Shop email duplication.
- Side datasets: geography, hourly, payments, attribution, GA, Klaviyo.
- Ad data: each platform handled separately; a central normalized, deduplicated DB for most reports, plus direct queries for pacing, creative analysis and diagnostics.
- AI access (their MCP): Claude only, SSO, user permissions carry over, no training on data, all calls logged, revocable.

## SLAs (their sync schedule)
- Aggregation 04:00 (done within 1h); push to Google Sheets 06:00 (done by 07:00).
- Daily pulls: Facebook, Google, TikTok, Pinterest at 02:00; Shopify 08/12/16/20h; GA4 02:00 and 14:00; AppLovin every 6h; Klaviyo continuous (<10 min).
- Hourly refresh for Facebook, Shopify, Google, Pinterest, TikTok, Snapchat, AppLovin.
- Escalation: notify on-call, auto-retry within 15 min, manual fix if it fails, incident report after two failed cycles.

## Klaviyo data differences (FAQ)
API quota resets about every 20-24h so some days can be incomplete; API data is a static snapshot while Klaviyo's UI re-computes with settings; Klaviyo UI groups by send time, Statlas by order time; backfill prioritises recent data. Daily numbers differ most, monthly totals are reliable.
