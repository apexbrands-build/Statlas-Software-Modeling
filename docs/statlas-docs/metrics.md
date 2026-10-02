# Metrics

## Revenue definitions (8 options; Statlas default = Order Revenue)
"Order Total" = what the customer paid (incl. shipping and tax).

| Name | Formula |
|---|---|
| Gross Sales | Order Total - Shipping - Tax + Discounts |
| Discounted Sales | Order Total - Shipping - Tax |
| Net Sales | Order Total - Refunds - Shipping - Tax |
| Total Sales | Order Total - Refunds |
| Order Revenue Net Tax | Order Total - Tax |
| Net Sales Net Tax | Order Total - Refunds - Tax |
| Order Revenue Net Shipping | Order Total - Shipping |
| Net Sales Net Shipping | Order Total - Refunds - Shipping |

Order Revenue is recommended because it matches how ad platforms report conversion value. Custom integrations use Revenue = Sales + Shipping + Taxes - Returns, by **order date** (not ship date).

## Formulas
- AOV = Total revenue / orders (follows the revenue definition)
- CAC = Total marketing spend / new orders. Paid CAC = Marketing spend / paid orders
- CPC = Spend / clicks. CPM = Spend / (impressions / 1000)
- MER = Total revenue / Total marketing spend
- aMER = New-customer revenue / Acquisition spend (brand and non-acquisition spend excluded, configurable)
- paMER = Paid revenue / Paid marketing spend (brand excluded if enabled)

## Contribution margin
- Basic CM = Sales + Shipping (optional) - Returns - COGS - Marketing (optional) - Order costs - Percentage costs
- Full CM = Basic CM - monthly fixed costs (prorated by days in period)
- SKU CM = Sales - Returns - COGS
- Monthly costs = fixed, prorated; Order costs = per order (packaging etc.); Percentage costs = % of sales (payment fees)
- Influencer impressions are estimated from post type, reach and video plays when platforms give no data.

## Cost of goods sold options (most to least precise)
Line-item, SKU-level feed, order-level (system spreads to lines), flat-rate %. Goal is a directionally right CM, not accounting precision.

## Cost of delivery options
Configurable (monthly fixed + per-order + % of sales), or "net-zero shipping" (shipping collected = cost of delivering).

## Returns
Linked to original orders when data is reliable, otherwise a fixed return-rate accrual (% of sales).
