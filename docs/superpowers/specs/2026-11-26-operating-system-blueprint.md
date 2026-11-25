# The operating system: one forecast for the whole business, tracked by every team

Date: 2026-11-26. Status: **draft for João's approval. Nothing here is built.** It follows `2026-11-20-halo-layer-design.md` and `2026-11-23-omnichannel-views-design.md` (both built) and reuses `2026-10-12-email-sms-plan-and-trackers-design.md` and `2026-10-11-messaging-klaviyo-sms-design.md` (written, not built).

This is the master plan. Each build slice at the end gets its own short design and build plan before code is written.

## What was asked (João, 2026-11-25)
1. The app must stop feeling like an e-commerce dashboard. It becomes the single source of truth for the whole company: the forecast, the daily dashboard and the reporting tool.
2. Amazon and TikTok Shop are too shallow today. Each needs its own metrics (ad spend, ACOS, total ACOS and the rest), its own clear section in the plan and its own place in the P&L.
3. The P&L must show every sales channel and a demand cascade view, because that is the view decisions are made on.
4. Retail matters less day to day, but its reporting cadence has to be understood and plugged in.
5. The forecast has to be cut into the small numbers each team owns: a spend tracker per paid channel, an email tracker for flows and campaigns, and so on. Every team gets a daily target and reports against it.
6. Every day everybody sees three things: the target, the result against it, and what is being done about it.
7. It should be ready before 2026-12-01, so that only the data sources remain to connect.

## Where the app is today (read in the code on 2026-11-26)
| Area | Today | Gap |
|---|---|---|
| Other sales channels | Four numbers per day and channel: revenue, orders, units, ad spend | No ad sales, ACOS, sessions, conversion, fees, subscriptions, affiliate or content split |
| Channel screens | One Home view per channel: six tiles and a chart | No analysis, no breakdowns, no channel reports |
| Plan | Own-site models, then one "Other Channels Model" page and one "Other sales channels" line | Channels are an appendix, not sections with their own drivers and targets |
| P&L (plan step and report) | Own site only: revenue, cost of delivery, ad spend, contribution margin, fixed costs | No channel columns, no channel fees, no cascade view |
| Trackers | Listed in the report library, none built. Facebook and Google trackers were paused until the plan had daily targets (it has them now). Email and SMS trackers wait for the Klaviyo sync | No team has a daily page |
| Email | The plan holds an Email and an SMS line (a share of revenue). The Klaviyo data sync is not built | No flow or campaign forecast, no tracker |
| Actions | Calendar report shows Meta launches beside the own-site numbers | No actions for Amazon, TikTok Shop, retail, email |
| Retail | A frame: doors x units per store per week x shelf price x net % | Daily rows only; no weekly data, no sell-in versus sell-through |
| Daily message | Not built | |

## The idea
**One forecast, drawn as a tree. Every branch has a target for every day, a result, and an owner.**

```
Whole business            revenue, contribution after ads, ad spend
├─ Own site
│   ├─ New customers      Meta · Google · YouTube · TikTok ads · ...     (paid team)
│   └─ Returning          Email flows · Email campaigns · SMS · rest     (retention team)
├─ Amazon                 Ad-attributed sales · Organic sales · Subscribe & Save
├─ TikTok Shop            Affiliates · Shop ads (GMV Max) · LIVE · Own content
└─ Retail                 one branch per retailer: doors x velocity
```

The same tree is used by three layers:
- **Forecast** (Planning): where each branch's target comes from. A model or a typed number per branch, rolled up into the P&L.
- **Dashboard** (Home, Channels, Trackers): each branch against its target, every day.
- **Reporting**: any branch, any metric, any period, against plan and last year.

Two rules carry over from what is built:
- Every number on a dashboard is a reported number. Anything that moves credit between channels (the cascade) is a separate, labelled view.
- A team only sees what it owns and what it rolls up into. A creative strategist or an email manager never has to open the plan.

**Why a tree:** a forecast that stops at the company total gives a team nothing to act on. A team can only act on a number it controls. The tree is the list of those numbers, and it guarantees that they add up to the company's.

## 1. Navigation
```
DATA
  Home         stores with other channels open on the business scoreboard; others keep today's Home
  Channels     Own site · Amazon · TikTok Shop · Retail        (a full page each)
  Reporting    grouped: Business · Own site · Amazon · TikTok Shop · Retail · Paid media · Retention
PLANNING
  Planning     the forecast
  Trackers     Meta · Google · other paid · Email & SMS · Amazon · TikTok Shop · Retail
  Ad plan      creative demand (built)
  Calendar     actions on every channel
```
Nothing is removed. Stores that sell on their own site only see no change.

## 2. Each sales channel in depth

The lists below are what the platforms report and what their teams work from. Sources are in the appendix. Where the research could not confirm something, the text says so.

### Amazon (seller account)
| Group | Stored per day | Shown, calculated from them |
|---|---|---|
| Sales | Ordered product sales, units ordered, order items, units refunded; shipped sales and units (counted on the ship date) | Average selling price, sales per order item, refund rate (units refunded / units ordered) |
| Traffic | Sessions, page views, Featured Offer (Buy Box) % | Conversion: Amazon's "unit session %" = units ordered / sessions |
| Ads | Spend, ad-attributed sales, orders, clicks, impressions, each also by ad type (Sponsored Products, Sponsored Brands, Sponsored Display). New-to-brand orders and sales for Sponsored Brands and Display (Sponsored Products does not report them) | **ACOS** = ad spend / ad sales. **Total ACOS (TACOS)** = ad spend / all sales. ROAS, CPC, CTR, **organic sales** = all sales - ad sales, ad share |
| Subscriptions | Active subscriptions, Subscribe & Save revenue and units, revenue lost to out-of-stock | Subscription share of sales |
| Costs | Referral fee, fulfilment (FBA) fees, storage, coupons and deals when a settlement file is loaded; otherwise typed rates | Contribution before and after ads |
| Stock (by week, later) | Days of supply, weeks of cover | |

What the team needs to know when reading it (sources in the appendix):
- **ACOS is the ad platform's own credit. Total ACOS is the number to manage the channel on**, because ads also lift organic rank. It is Amazon's version of MER (MER = 1 / total ACOS). Amazon does not show total ACOS anywhere; it is calculated here.
- **Organic sales are approximate by day.** Ad sales are counted inside a window after the click (7 days for Sponsored Products, 14 for Sponsored Brands), while all sales are counted on the order day. The page shows organic by week and month and marks the daily figure as rough.
- **Amazon changed how Sponsored Brands and Display sales are attributed on 2026-01-01.** A comparison across that date compares two definitions; the page marks it.
- **Amazon keeps daily ads history for a short time** (about 95 days through its API for Sponsored Products). The app keeps every day it loads, and the available history should be exported at the start.
- The page shows the platform's ACOS beside what the channel model finds (what each extra $1 of Amazon ads adds to all Amazon sales), so the two are never confused.
- "Created by own-site ads" (the halo) stays a separate, labelled box. Two Amazon sources can later support that number without any modelling: Amazon Attribution (what off-Amazon ad clicks buy on Amazon) and Brand Analytics search volume for the brand's name, by week.

The referral fee for health and personal care is 8% when the item sells for $10 or less and 15% above (minimum $0.30). The category has to be checked per listing, so the rate is typed per store.

### TikTok Shop
| Group | Stored per day | Shown, calculated from them |
|---|---|---|
| Sales | GMV, orders, buyers, items sold, refunds, items cancelled and returned | Average order value, refund rate, GMV net of refunds |
| Traffic | Product page views (TikTok now calls them product clicks), visitors, add-to-carts | Conversion |
| Where the sale came from | GMV by content: LIVE, video, product card. GMV by source: affiliate or seller | Affiliate share |
| Affiliates | Creators with samples, with posts and with sales; videos and LIVEs posted; samples shipped; commission | Commission rate, GMV per selling creator, sample return |
| Shop ads | Cost, gross revenue, orders (GMV Max) | ROI = gross revenue / cost, cost per order, cost as % of all GMV |
| Costs | Referral fee, refund administration fee, affiliate commission, shipping and fulfilment, seller-funded discounts; typed rates until statements are loaded | Contribution before and after ads |

Three facts that shape the page (sources in the appendix):
- **GMV counts orders that are later cancelled or refunded**, dated by payment day. The page therefore shows GMV (the number the TikTok team uses) and GMV net of refunds (the number the P&L uses) side by side.
- **GMV Max counts organic orders.** TikTok's help page says its gross revenue is "both paid and organic" orders of the promoted products while the campaign runs, and that a buyer who never saw the ad still counts. Its ROI cannot be compared with a Meta ROAS. The page shows it beside cost as a share of all GMV and beside the channel model's reading. Since July 2025 GMV Max is the default campaign type for shop ads.
- **TikTok renames and redefines its metrics often** (a change to the source split on 2026-04-28, renames in October 2026). The import keeps the file's own column names next to ours, and each saved row records where it came from.

The referral fee on TikTok's own page is 6% of what the buyer paid (5 to 6% by category). Seller blogs report 8% from August 2026; it could not be confirmed, so the rate is typed per store and checked against the first statement.

### Retail
Three numbers that must never be added together:
- **Sell-in**: what the brand ships and invoices to a retailer or a distributor. It is the brand's revenue. It arrives by purchase order and is lumpy; a launch order fills the shelves and overstates demand.
- **Distributor shipments**: what a distributor (UNFI, KeHE) ships on to the stores. It is reported daily and is a proxy for demand, not a sale to a shopper.
- **Sell-through**: what shoppers buy at the shelf (scan data), in units and shelf dollars. It is the leading number.

Stored per retailer and period: stores selling (doors), units sold, shelf dollars, sell-in dollars and units, distributor shipments, units on hand, promotion flag. Shown: velocity (units sold / stores / weeks, with a setting for whether weeks with no sale count), dollars per store per week, weeks of supply, sell-in against sell-through.

What each retailer gives a supplier (research of 2026-11-26; "not confirmed" means no source could be opened that states it):

| Retailer | Where the data is | Shopper sales by day? | Cost |
|---|---|---|---|
| Target | Partners Online (Greenfield reports), by item, store and day, refreshed each morning | Yes, about a day behind (the exact lag is not confirmed) | Not confirmed |
| Walmart | Retail Link and Luminate, daily store sales feeds | Yes | Basic tier free, full tier paid |
| Whole Foods Market | Its own vendor reporting portal: store, item, week | Weekly is what is proven: each Thursday for the week ending Saturday | Not confirmed |
| Costco | Vendor portal | Unclear: sources disagree between daily and weekly | Not confirmed |
| H-E-B | A paid Circana programme, by item, store and day | Only with that programme | Paid, priced on sales with H-E-B |
| The Vitamin Shoppe | No supplier data programme found; orders by EDI | Unknown: ask the buyer for a sales report | |
| UNFI, KeHE | UNFI Insights, KeHE CONNECT | Daily, but these are shipments to stores, not shopper sales | A percentage of purchases, not confirmed |

So the app tracks retail on three cadences, and says which one on every tile with the date the data runs to:
- **Daily**, about a day behind, where the retailer's portal gives scans by day (Target, Walmart).
- **Weekly**, on the retailer's own week, everywhere else. Weeks differ: Whole Foods weeks end on Saturday, syndicated data weeks on Sunday, and Target, Walmart and Costco each run their own fiscal calendar.
- **Monthly** for sell-in, because single orders move it.

A period length is stored on every retail row, so a week is shown as a week and never invented as seven days. Retailers restate past days, so a load replaces a trailing window instead of only adding the newest day.

Between the shelf price and the brand's net revenue sit the retailer's margin, the distributor's margin, trade spend, slotting and deductions. Today the app has one "net % of shelf price" per channel; it becomes editable per retailer with those lines.

### Own site
Unchanged. It becomes one channel page among four instead of being the whole app.

## 3. Data: how it gets in
| Source | Day one | Later | What decides the date |
|---|---|---|---|
| Own site (Shopify, Meta, Google) | Built connectors | | The brand's admin has to install the app and grant the ad accounts |
| Amazon sales and traffic, Amazon ads | The platform's own export files, read as they are (no reformatting) | Amazon's reporting APIs: the Sales and Traffic report (two years back), the ads reports, the Subscribe & Save metrics | The seller registers a private app and authorises it, and applies separately for the ads API. Amazon publishes no review time; reports range from the same day to weeks |
| TikTok Shop | Seller Center export files (Excel), mapped once on the first upload | TikTok Shop partner API: shop performance by day, statements with every fee | Creating and authorising an app in TikTok's partner center. Review of public apps takes more than three weeks; the time for a brand's own app is not confirmed |
| A warehouse or hub the brand already has (for example a data tool that already pulls Amazon and TikTok Shop) | A mapped file or sheet | A reader for that warehouse | Read access from the brand's data owner |
| Klaviyo | API key (read only) | | Building the sync against a real account; none is connected today |
| Retail | Files per retailer (portal export, distributor report) | A feed from a service that reads the portals every day (Crisp, Alloy.ai, Daasity) | Which retailers, and whether the brand already pays for one of these |

Changes to storage (one additive migration):
- `channel_sales` gains a `metrics` column holding the channel's own numbers and a `period_days` column (1 for a day, 7 for a week).
- A save function that merges a file into the day instead of replacing the day, so the sales file and the ads file can be loaded separately. It runs as one statement, which also closes the "delete then insert" gap noted in the last review.
- A metric catalog in code: one list per platform with each metric's name, unit, how it adds up over a period, which direction is good, and the column names the platform's files use.

Import, second version:
- A dropped file is recognised by its columns and mapped without questions once its format is known. Amazon's metric names are known; the exact header row of its CSV files could not be found in public docs, so the first real business report and ads report confirm the recognition.
- Any other file gets a mapping step (this column is that metric), saved per channel so the next upload needs no mapping. TikTok Shop starts here: its export columns are not published, so the first real file is mapped once by hand.

## 4. The forecast: a section per channel
The plan editor gets a **Channels** step. It replaces the "Other Channels Model" page and the "Other sales channels" line, which move into it. One page per channel, all with the same four blocks:

1. **How the forecast is made**: model, typed, or retailer frame, with the model's fit and how far to trust it.
2. **Drivers by month**: the numbers the channel team will be held to.
   - Amazon: ad spend, expected ad sales, ACOS target, organic sales, total ACOS target, of which created by own-site ads.
   - TikTok Shop: ad cost and ROI target, affiliate GMV, LIVE and own-content GMV, creators and videos needed (typed).
   - Retail: per retailer, doors, velocity, shelf price, net %, launch fill, promotion weeks.
3. **Costs**: cost of goods, platform fees, fulfilment, commissions, trade spend. Typed rates with a default per platform, replaced by real fees when a statement is loaded. Today a channel has one "variable costs %" field; it is split into these lines and the old field keeps working.
4. **Result**: revenue, contribution before and after ads, and the daily target the dashboard will use.

The forecast engine does not change: the channel model stays the regression João specified (the New Customer rules on the channel's own ad spend and revenue). What changes is that its result is broken into the drivers a team recognises.

## 5. P&L by channel and the cascade view
The plan's P&L step and the P&L report get a **By channel** layout: one column per sales channel and a total.

```
                         Own site    Amazon   TikTok Shop   Retail     Total
Gross revenue
 - Discounts and promotions
 - Refunds
= Net revenue
 - Cost of goods
 - Channel fees and fulfilment
= Contribution before ads
 - Ad spend
= Contribution after ads      (and % of net revenue)
 - Fixed costs                                                       (total only)
= Profit                                                             (total only)
MER or total ACOS
```

**Cascade view** (a switch: Reported | Cascaded). Reported shows each sale where it was bought. Cascaded shows it where the demand was created. The company total never changes.

Worked example, sample store, 1 to 22 November. Two factors: Meta creates 0.2 on Amazon per $1 it reports (a benchmark), and TikTok Shop creates 0.53 elsewhere per $1 it sells (the median CTC reported, used here as an assumption and split 60% to the own site, 40% to Amazon):

| | Own site | Amazon | TikTok Shop | Retail | Total |
|---|---|---|---|---|---|
| Reported revenue | 484,360 | 146,534 | 47,240 | 54,166 | 732,301 |
| Created here, bought elsewhere | +24,630 | | +25,037 | | |
| Bought here, created elsewhere | -15,022 | -34,645 | | | |
| Cascaded revenue | 493,968 | 111,889 | 72,277 | 54,166 | 732,301 |

The moved revenue takes its margin from the channel it was bought on, so contribution moves with it and the total contribution is also unchanged.

To support it, the halo grid gains sales channels as creators of demand (TikTok Shop creating sales on the own site and on Amazon), next to the ad channels it has today. Every factor keeps its source label (own test, benchmark, assumption), and the cascade view repeats those labels.

A companion report, the **cascade matrix**, shows the same thing as a grid: who created the demand (rows) by where it was bought (columns), in money and in contribution.

## 6. Trackers: the numbers each team owns
One page layout for every tracker: the team's number against target (yesterday, month to date, projected month), a day-by-day table (target, actual, difference, running total), the drivers under it, and the team's actions from the calendar.

| Tracker | Target comes from | Result comes from | Can be built |
|---|---|---|---|
| Meta, Google, each paid platform | The plan's daily spend per platform and its ROAS target | Synced campaigns | Slice 2, on real data |
| Email and SMS | The plan's Email and SMS lines; flows are the floor, scheduled campaigns fill the gap (October design) | Klaviyo | Slice 5: screens on sample data; real numbers when a Klaviyo account is synced |
| Amazon | Sales forecast and planned ad spend today; ACOS and total ACOS targets once the Channels step exists | Amazon files or feed | Slice 2, on slice 1's data |
| TikTok Shop | GMV forecast and planned ad cost today; GMV by source and ROI targets once the Channels step exists | TikTok Shop files or feed | Slice 2, on slice 1's data |
| Retail | Retailer frame, by week | Retailer files | Slice 5 |
| Creative | Ad plan (built) | Synced ads | Built |

Every paid tracker shows, for the spend so far: the platform's ROAS, the incremental ROAS, the target, and the ROAS needed on the remaining days to land the month.

## 7. Scoreboard and the daily message
**Home, business scoreboard**: the tree as a table. For each branch: yesterday (target, result), month to date (target, result, %), the month (forecast, projected). Under it: today's actions and the three largest gaps. A click on a branch opens its tracker. Each branch has an owner (a team or a person), typed once in settings and shown beside it.

**Daily message**: one post each morning built from the scoreboard, a line per channel and the total. Decided earlier; it is built once the scoreboard exists.

## 8. Reporting
- The report library is grouped by channel and gains: Amazon overview, TikTok Shop overview, Retail overview, P&L by channel, Cascade matrix.
- Every channel report has the same controls: period, grain (day, week, month), compare with plan or last year, every metric of the catalog as a column, and a CSV export.
- A free explorer (pick any metrics and any breakdown) and product-level reports across channels come after the slices below. They need product data per channel, which the first imports do not carry.

## Build order
Each slice ends on the sample store in the live app, with the click path.

| Slice | What | Done when |
|---|---|---|
| 1. Channel depth | Platform presets, metric catalog, storage change, file recognition and merge, sample data with every metric, Amazon and TikTok Shop pages | The sample store's Amazon page shows ACOS, total ACOS, sessions, conversion and the ad-type split from a loaded Amazon file; the TikTok Shop page shows GMV by source and shop ads |
| 2. Scoreboard and trackers | Business scoreboard on Home; one tracker layout; paid trackers (Meta, Google and any platform with data), Amazon and TikTok Shop trackers; a channel on every calendar action | A media buyer opens the Meta tracker and sees today's target, the month's pace and the ROAS needed; Home shows every branch against its target |
| 3. Plan and P&L | The Channels step with a page per channel; channel cost lines; P&L by channel in the plan and in the report | The plan's P&L shows a column per channel and a total that matches the plan header |
| 4. Cascade | Sales channels as creators in the halo grid; the Reported / Cascaded switch; the cascade matrix | Switching the view moves revenue and contribution between columns and leaves the total unchanged |
| 5. Email, retail, daily message | Email tracker screens; retail by week with sell-in, distributor shipments and sell-through; the daily message | The email tracker shows target, actual, planned, projected and gap on sample data; a weekly retail file loads as weeks |

Why this order: slice 1 changes what is stored and how files are read, and every later page reads it. Slice 2 is the one the teams use every morning and it works from the first day with own-site data alone. Slices 3 and 4 need each channel's costs, which come from finance. Slice 5 can only be finished properly against a real Klaviyo account and a real retailer file.

After that, in the order access arrives: the Klaviyo sync, the Amazon and TikTok Shop feeds, the retail feed, the free explorer.

## Not in this plan
Measuring halo factors inside the app (they come from tests and are typed in), inventory planning, product-level reports across channels, Amazon vendor (first-party) accounts, any message sent to a team without a person approving it.

## Decisions needed
1. The order of the slices above, in particular whether the scoreboard and trackers (slice 2) come before the plan sections and the P&L (slices 3 and 4).
2. Whether Home opens on the business scoreboard for stores with other channels.
3. Which data the brand already has in one place (a warehouse or an internal hub), because reading it would replace the file route for Amazon and TikTok Shop.

## Appendix: sources
Research of 2026-11-26. "Vendor" marks a third-party source used where the platform's own page could not be opened. Items the research could not confirm are named as such in the text above.

**Amazon**
- Sales and Traffic report fields and options: https://developer-docs.amazon.com/sp-api/docs/seller-retail-reports-attributes and https://developer-docs.amazon/sp-api/docs/report-type-values-analytics
- ACOS and ROAS definitions: https://advertising.amazon.com/library/guides/acos-advertising-cost-of-sales and https://advertising.amazon.com/library/guides/return-on-ad-spend-roas
- Attribution windows by ad type (Amazon's help text quoted in the Seller Forums): https://sellercentral.amazon.com/seller-forums/discussions/t/ba2d0dfd7947ca7f92df1093419a6679
- Attribution change of 2026-01-01: https://advertising.amazon.com/resources/whats-new/view-attribution-updates-for-amazon-store-ads
- New-to-brand: https://advertising.amazon.com/solutions/products/sponsored-brands
- Total ACOS is not an Amazon metric (vendor): https://ppc.land/tacos/
- Subscribe & Save report types removed, replaced by the Replenishment API: https://developer-docs.amazon.com/sp-api/changelog/deprecation-of-two-fba-subscribe-and-save-report-types
- Referral fees: https://sell.amazon.com/pricing ; 2026 fee update: https://sellingpartners.aboutamazon.com/update-to-u-s-referral-and-fulfillment-by-amazon-fees-for-2026
- API access for a seller's own account: https://developer-docs.amazon/sp-api/docs/register-as-a-private-developer and https://developer-docs.amazon/sp-api/docs/self-authorization
- Ads report retention of 95 days (a mirror of Amazon's report-types page, may be dated): https://d3a0d0y2hgofx6.cloudfront.net/ja-jp/guides/reporting/v3/report-types.html
- Brand Analytics, Search Query Performance: https://developer-docs.amazon/sp-api/docs/brand-analytics-reports-attributes
- Amazon Attribution: https://advertising.amazon.com/solutions/products/amazon-attribution

**TikTok Shop**
- Shop Analytics metrics and the GMV definition: https://seller-us.tiktok.com/university/essay?knowledge_id=813364865828654&lang=en
- Product Analytics (traffic and conversion): https://seller-us.tiktok.com/university/essay?knowledge_id=4169993017509675&lang=en
- Source split of 2026-04-28 (affiliate or seller): https://seller-us.tiktok.com/university/essay?knowledge_id=6494954580231950
- Affiliate performance and partnerships: https://seller-us.tiktok.com/university/essay?knowledge_id=6115786490283790&lang=en and https://seller-us.tiktok.com/university/essay?knowledge_id=3177596790916910&lang=en
- GMV Max reporting, including organic orders: https://ads.tiktok.com/help/article/how-to-see-reporting-for-your-product-gmv-max-campaign?lang=en and https://ads.tiktok.com/help/article/about-attribution-for-gmv-max?lang=en
- GMV Max as the default campaign type from July 2025: https://ads.tiktok.com/help/article/gmv-max-migration-tiktok-shop-ads
- Gross revenue in Ads Manager against GMV in Seller Center: https://ads.tiktok.com/help/article/about-gross-revenue-for-tiktok-shop-ads?lang=en
- Referral fee: https://seller-us.tiktok.com/university/essay?knowledge_id=5982454398175018
- Partner API endpoints (vendor): https://help.daasity.com/core-concepts/data-integrations/setup-guides/digital-integrations/tiktok-shop/integration-specifications

**Retail**
- Target Partners Online (vendor): https://alloy.ai/target-partners-online-retail-data
- Walmart Luminate Basic free of charge: https://corporate.walmart.com/news/2022/10/12/walmart-luminate-introduces-basic-package-free-of-charge-to-suppliers ; daily store sales feed: https://developer.walmartdataventures.com/cpdb-data-feeds/reference/store-sales-details
- Whole Foods vendor portal, weekly on Thursday (vendor): https://help.daasity.com/core-concepts/data-integrations/setup-guides/retail-integrations/whole-foods-market/integration-specifications and https://www.spscommerce.com/community/articles/how-to-navigate-the-whole-foods-supplier-portal
- H-E-B through Circana: https://www.circana.com/go/retailer-insights-made-simple
- UNFI Insights and KeHE CONNECT are shipments, not scans: https://www.gocrisp.com/learning-center/retailer-guides/unfi-data-operations-guide-for-cpgs and https://www.gocrisp.com/learning-center/retailer-guides/kehe-data-operations-guide-for-cpgs
- Velocity formula: https://daasity.com/post/sales-velocity-in-cpg-what-it-is-why-it-matters
- Shelf price to net revenue, an illustrative waterfall: https://eightx.co/blog/cpg-retail-distribution-margins
- Fiscal calendars: https://corporate.target.com/investors/annual/2025-annual-report/10-k-report/10-k-cover and https://www.8thandwalton.com/resources/walmart-calendar/
