# Reports

Statlas splits reports into **V2** (target/data-model driven: Calendar, MER, Net Active Customer, Paid Media, Email Metrics) and **V1** (formula style: Contribution Margin, Product by First Product).

## Calendar
Date, marketing actions (events), CM, eCommerce revenue, total spend, MER, acquisition revenue/spend/aMER, returning revenue, AOV, CAC, email revenue, organic revenue; Amazon block; per-platform (Facebook, Google, Bing, Pinterest, Snapchat, TikTok, AppLovin, Criteo, Rakuten) acquisition / non-acquisition / total plus ROAS. Ad breakdown: All / Acquisition only / Non-acq only / Totals only. Variance vs goal with colours, comparison mode, optional incremental ROAS from platform incrementality factors, empty platforms hidden.

## MER
CM, revenue, total spend, MER, acquisition revenue/spend/aMER, then per platform: Spend, Conversion Value, ROAS (Amazon, Facebook, Google, Bing, AppLovin, Criteo, Pinterest, Snapchat, TikTok, Rakuten, Manual Other Spend). Views day to year plus day-of-week, MER/aMER trend with goals. MER>1 and ROAS>1 mean positive return.

## Paid Media Overview
Grouping: Campaign, Publisher, Campaign Type, Ad Account, Ad Set, Ad, Time. Columns: Cost, Conversions, Cost/Conv, Conv Value, ROAS, CAC, AOV, Spend/Revenue, CM (= Conv value - Cost - COGS); Impressions, CPM, Clicks, CTR, CPC, Conv Rate; funnel Add to Cart, ATC/Clicks, Checkouts Initiated, CI/ATC, Purchases/CI; video Thruplay, 3-second view %, watch time, 25/50/75/95% viewed. Sorted by spend, test campaigns excluded; video mostly FB/TikTok, funnel mostly FB.

## Net Active Customer
End-of-period snapshot (not activity in period). Segments: New, Returning, Reactivated, At-Risk, Churned.
- Net Active = New + Returning + Reactivated - Churned
- Total Active = New + Returning + Reactivated + At-Risk
Periods: daily, weekly, bi-weekly, monthly (default), quarterly; view by count or revenue.

## Email Metrics
Klaviyo email/SMS merged with GA4. Columns: campaign/type/channel, delivered, recipients, opens (unique), clicks (unique), orders, revenue, bounces, spam, unsubscribes. Rules: GA email/SMS sessions are **added** to Klaviyo clicks; GA transactions combine with Klaviyo orders; Klaviyo wins for opens and deliverability. GA filter includes channels with email/mail/sms, excludes organic, paid search, direct, social, display. Benchmarks quoted: open 15-25%, click 2-5%, deliverability >95%.

## Contribution Margin (waterfall)
Gross sales, discounts (amt, %), refunds (amt, %), shipping, taxes, net revenue; then shipping cost, tax, refund deductions, COGS (amt, %), product margin; fixed monthly (prorated), per-order, %-of-revenue costs; ad spend (amt, % of revenue); CM (amt, %). Periods day to year. Filter customer type All/New/Returning. Healthy margin quoted as >20%. **Refunds are shown on the day processed, not the day of the original sale.**

## Product by First Product
Groups orders by customer email, finds first order, credits **every product in the first order** with the customer's whole later behaviour (so totals exceed real customers). Columns: 1st, 2nd, 3rd, 4th+ order, Additional Orders, Additional Order Rate ((2nd+3rd+4th)/1st), Refunds, % Refunded. Variations: Order Count, Order Total, Order AOV, % of first order. Top 1,000 products; 6-12 month windows recommended. Good first products: repeat rate >30%, refunds <5%.
