/** Client onboarding checklist, adapted from the questions Statlas asks for custom integrations (docs/statlas-docs/data-and-integrations.md). */
export interface ChecklistSection {
  title: string;
  items: { id: string; text: string; hint?: string }[];
}

export const ONBOARDING_CHECKLIST: ChecklistSection[] = [
  {
    title: "1. Store basics",
    items: [
      { id: "currency", text: "Currency confirmed (and how multi-currency orders are handled)" },
      { id: "timezone", text: "Reporting timezone set to match the store and ad accounts" },
      { id: "industry", text: "Industry filled in", hint: "Used for benchmarks and as the seasonality fallback" },
      { id: "revenue", text: "Revenue definition confirmed: Order Revenue", hint: "Gross - discounts + shipping + tax, returns excluded" },
    ],
  },
  {
    title: "2. Orders and customers",
    items: [
      { id: "channels", text: "DTC sales channels chosen; POS, wholesale and draft orders excluded" },
      { id: "excluded", text: "Excluded order tags and cancelled/test orders agreed", hint: "Zero-dollar orders are always excluded" },
      { id: "first", text: "New vs returning agreed: first paid order per customer (email or customer ID)" },
      { id: "edit-window", text: "How long orders stay editable (matters for refunds and forecasts)" },
      { id: "specials", text: "Special cases noted: VAT/duties, giveaways, gift cards, subscriptions, tax-inclusive prices" },
    ],
  },
  {
    title: "3. Costs",
    items: [
      { id: "cogs", text: "COGS source chosen: Shopify cost per item, SKU upload, or a flat % of sales" },
      { id: "delivery", text: "Cost of delivery set: % of net sales + shipping and/or cost per order (or net-zero shipping)" },
      { id: "fixed", text: "Monthly fixed costs entered (P&L only, not in contribution margin)" },
      { id: "returns", text: "Returns method understood: linked to the refund day, not the original sale" },
    ],
  },
  {
    title: "4. Ad platforms",
    items: [
      { id: "meta", text: "Meta ad account connected; attribution window set (agency standard: 7-day click, view disabled)" },
      { id: "meta-existing", text: "Meta existing-customer audience defined in the ad account (for the returning split)" },
      { id: "google", text: "Google Ads connected; brand keyword and non-brand tag (NB) checked" },
      { id: "test", text: "Test campaigns identified so they are excluded" },
      { id: "mult", text: "Incrementality multipliers reviewed for this client" },
    ],
  },
  {
    title: "5. Data quality check",
    items: [
      { id: "ref-months", text: "Two reference months compared with Shopify: gross, discounts, returns, net, shipping, taxes, total, orders" },
      { id: "spend", text: "Meta and Google spend compared with the platform UIs for the same dates" },
      { id: "history", text: "History load finished and coverage dates look right" },
    ],
  },
  {
    title: "6. Forecasting history",
    items: [
      { id: "exclude-periods", text: "Periods to exclude or treat differently listed: stock-outs, migrations, business pivots, price changes" },
      { id: "events", text: "Marketing events and promotions history gathered (for the event-effect model)" },
    ],
  },
];
