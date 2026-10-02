# Settings

- **Logo**: scraped from the site (keywords like logo.png), can be overridden with an image URL. SVGs on Shopify often fail.
- **Agency**: admin-only, links the store to an agency.
- **Industry**: set at onboarding; drives benchmarks and is the fallback when seasonality has too little data.
- **Currency / Timezone**: store can differ from the source systems; timezone conversion applies to e-commerce data only.
- **Revenue definition**: two methods; Order Revenue recommended.
- **Channels**: sales channels orders are grouped into (Shopify channels natively; others by request). Recommended to exclude POS, draft orders and some return channels. Used as a filter/compare option in reports.

## Facebook attribution (stored per store)
- Click window: Default / 1 / 7 / 28 days / Disabled
- View window: Default / 1 / 7 days / Disabled
- Click type: All (default) / Unique / Outbound / Unique outbound
- Exclude onsite conversions (lead forms etc.): on/off
- Statlas default is 7-day click + 1-day view; advice is to keep one setting across all campaigns. Longer windows and view-through raise counts; unique clicks lower them.

## Customer churn
Thresholds come from the distribution of days between a customer's consecutive orders.
- At risk = ~40th percentile of that distribution, churned = ~80th percentile (example: 29 and 47 days).
- The FAQ also states a flat 120-day fallback for "churned" if nothing is set; both numbers are editable (short cycles for consumables, long for durables).
- Best practice: look at the distribution first, start from the data defaults, review periodically.
