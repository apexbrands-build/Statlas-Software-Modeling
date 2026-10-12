# Home report links

Date: 2026-10-11. Status: draft for the strategist's review. Independent of the connector specs, except the Email Metrics link, which needs `2026-10-11-ga4-email-metrics-design.md`.

## Goal
Each Home metric tile gets a small link icon, next to the "i" trend button, that opens the report behind that metric.

## Mapping (from the strategist)
| Tile | Report | Exists today |
|---|---|---|
| Contribution Margin | Contribution Margin (waterfall) | No |
| Order Revenue | Revenue Overview | No |
| Ad Spend | Paid Media Overview (`ads`) | Yes |
| MER | Marketing Efficiency (`mer`) | Yes |
| AOV | AOV Histogram | No |
| Orders | New Vs Returning Overview (`new-vs-returning`) | No |
| Email Revenue, Email Orders, Campaign and Flow Revenue, Revenue per 1k | Email Metrics (`email-metrics`) | After the GA4 and Email Metrics spec |
| SMS Revenue, SMS Orders | Email Metrics (`email-metrics`) | After the same spec |

Only Paid Media and MER exist today. The registry (`lib/reports/registry.ts`) marks `new-vs-returning` and eight other reports as `ready`, but `ReportRouter` has no page for them and shows "not built yet". The statuses are wrong and are corrected here.

## Design
- `MetricDef` (`lib/metrics.ts`) gains an optional `report` field holding a report slug. The mapping above is set once there.
- `ReportStatus` gains `planned` (page not built, no data blocker), shown in the library as "Coming soon". Every registry entry is set to what is true: `ready` only when `ReportRouter` has a page. Unmapped slugs show the existing "not built yet" message.
- Registry entries are added for the three reports that do not exist (`contribution-margin`, `revenue-overview`, `aov-histogram`) with status `planned`.
- **Icon rule:** the icon shows only when the mapped report is `ready`, so there are no dead ends. Today that means Ad Spend and MER; each other tile gets its icon automatically when its report lands. If the strategist prefers visible placeholders, it is a one-line change.
- `MetricTile` renders the icon as a link to `/reporting/<slug>` in the same tab, beside the "i" button, with an accessible label ("Open Marketing Efficiency report"). Date range and compare setting carry over through the picker state Home and reports already share (`docs/reports-plan.md`); confirmed during implementation.
- Tile layout: the "i" button keeps its position; the link sits to its left.

## Tests
- Every `report` slug in `METRICS` exists in the registry.
- No registry entry is `ready` without a page in `ReportRouter` (test reads both).
- Tile renders the link only for ready reports.

## Changes made while planning (2026-10-12), see `docs/superpowers/plans/2026-10-12-four-reports-and-home-links.md`
- The mapping lives in `lib/reports/home-links.ts` instead of a `report` field on `MetricDef`; behavior is the same.
- The three missing reports are now real reports (`2026-10-12-four-reports-design.md`), so the `planned` entries for them are not added; `planned` is used for the eight reports that are marked ready in the registry but have no page.
- Home's date range reaches the report through `?from=&to=` in the link, because the report pages keep their own range state and do not share Home's picker. An invalid or reversed range falls back to the current month.

## Follow-up (own specs, not in this one)
The four missing reports: Contribution Margin waterfall, Revenue Overview (revenue, refunds and orders by month), AOV Histogram, New Vs Returning (with the other LTV reports). Revenue Overview and AOV Histogram are new to the approved report scope in `docs/reports-plan.md` (they are in Statlas's "All" list and are not among the four reports we never build). `docs/reports-plan.md` is updated when this spec is implemented.

## Done when
Ad Spend and MER tiles link to their reports; the registry statuses match reality; the three new entries show "Coming soon"; the tests above pass.
