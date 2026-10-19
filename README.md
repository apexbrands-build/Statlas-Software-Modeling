# Apex Analytics (datasoftwarebuild)

Internal performance dashboard for Apex Brands: contribution margin, MER, AOV, orders, new vs returning, incremental channel performance, email and organic, each compared to plan, last year or the previous period. Branded with Apex identity; models the *features and methodology* of a profit dashboard, not any vendor's UI.

**Beta status:** runs entirely on deterministic seed data (three fictional clients). No database or API connections yet.

## Run

```bash
npm install
npm run dev      # http://localhost:3000
npm test         # metric formulas + seed consistency
npm run build
```

## Structure

| Path | Purpose |
|---|---|
| `theme/theme.ts` | Single source for colours, fonts and logo paths (Apex branding) |
| `lib/metrics.ts` | Metric definitions and formulas (pure functions, tested) |
| `lib/repository/` | Data-access interface + seed implementation; swap for Supabase later |
| `lib/dashboard-data.ts` | Loads range/comparison/plan data for the dashboard |
| `components/` | Dashboard, tiles, chart, "i" trend modal, settings |
| `supabase/migrations/0001_init.sql` | Target schema (not applied yet) |
| `docs/` | Findings, build plan, forecasting context |

## Key definitions

- **Order Revenue** = gross − discounts + shipping + tax (refunds not deducted). Used for MER, AOV, iROAS.
- **Contribution margin** = Net Sales + Shipping − Cost of delivery − Ad spend. Cost of delivery = COGS + other variable costs (the Store Settings field "Cost of delivery" holds the non-COGS part). Net Sales = gross − discounts − refunds (no tax). Fixed costs are not part of CM.
- **Incrementality factors** are editable per client (Store Settings). Defaults: Meta 1.15, Meta returning 0.6, Google 0.65 (also its returning channel), Google Brand 0.15 (also its returning channel), Pinterest 0.3 (changed 2026-10-19).

Read-only everywhere: the app never writes to Shopify, ad platforms or email tools.
