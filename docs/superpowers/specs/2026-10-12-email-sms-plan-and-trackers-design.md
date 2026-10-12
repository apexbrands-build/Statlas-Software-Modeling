# Email and SMS plan and trackers

Date: 2026-10-12. Status: draft for the strategist's review. Depends on `2026-10-11-messaging-klaviyo-sms-design.md` (data) and the existing planning layer (`docs/planning-layer.md`).

## Goal
Email and SMS get a target inside the plan, tracked against actuals and a projection, so the gaps in flows and campaigns are visible and extra actions can be planned. This is the Canon rule "forecast sets store revenue, email owns its share, flows carry the floor, campaigns fill the gap" (`Agency/Training/CTC Canon/email.md`), with the share taken from each client's own data.

## Decision (strategist, 2026-10-12)
The email % is taken from the client's own history, year over year and the trailing 90 days. It can be overridden in the plan, in the Details step, next to returning revenue, discount % and the other plan variables.

## Plan side

### Share and target
- Two new Details lines, **Email revenue** and **SMS revenue**, each a % of planned order revenue per month. They use the Details-step pattern already built: Plan (editable, lockable), Inferred, Last year, vs LY, Actual, "use", plus Actualize all YTD and Extrapolate.
- **Inferred value:** the same month last year (email revenue ÷ order revenue); if that month has no data, the trailing 90 days. This is the rule already used for the other Details lines.
- **Target (money)** = planned order revenue for the month × the Plan %. SMS likewise.
- **Allocation, not extra revenue:** total revenue stays what the models and strategist set. Email and SMS are slices of it, so a miss shows how much of the total is at risk (Canon: a 20% email miss at a 22% share is a 4.4% total miss).
- **Daily targets:** the month target is spread over the days in proportion to each day's planned order revenue, so event days carry their lift. Stored in `plan_targets` (new nullable `email_revenue` and `sms_revenue`), which Home and the reports already read for green and red.
- **Reference panel:** the client's own share next to the Canon median (22%, range 5 to 65%) and the range for the client's brand type (high-velocity DTC 20 to 35%, high-AOV 10 to 20%, home and decor 15 to 25%, fashion 20 to 30%, food and bev 25 to 40%). A new "Brand type" select in the Store Settings Email & SMS accordion picks the range. Reference only; it never sets the target.

### Where it sits in the editor
Details dropdown (lines), Input (daily rows and CSV gain the two columns), P&L unchanged. Models and Spend tabs are untouched.

## Tracker side

### Projection (per month, per channel)
- **Flows:** run rate = trailing 28-day average daily flow revenue × days remaining (Statlas Email Plan uses daily average × days in the month). Flows are the floor.
- **Scheduled campaigns:** future-dated campaign events from the platform (the messaging sync also pulls scheduled campaigns with their audience size). Planned revenue = audience × the client's own revenue per recipient (RPR), the median of their campaigns from the last 12 months for that channel.
- **Projected** = actual so far + scheduled campaigns + flows run rate. **Gap** = Projected − Target. Early in the month Projected is close to the planned value; late in the month it converges to Actual.
- First version uses one RPR per channel. Per campaign type (promotion, product, content, loyalty, from the Canon) needs a type on each campaign and comes later.

### Reports
`email-tracker` and `sms-tracker` in the report library, plus the header of Email Metrics:
- Cards: Target, Actual, Planned (scheduled campaigns), Projected, Gap (the Statlas Email Plan four numbers plus the gap).
- Chart: cumulative target, actual and projected by day.
- Flows table: each flow's revenue and RPR this month against its own trailing 180-day median; a flow more than 30% below its own median is flagged for an A/B plan (the Canon's 30% rule, applied to the client's own baseline because we hold no per-type benchmark).
- Campaigns table: sent and scheduled, with audience, revenue and RPR.
- Tier 1 flow checklist from the Canon (welcome, abandoned checkout, abandoned cart, browse, site abandonment, post-purchase, winback, sunset): ticked by hand per client, stored in client settings.
- **Gap actions:** when the gap is negative, show the extra revenue needed, the extra recipient-sends that implies at the client's RPR, and the equivalent number of average campaigns. Next to it the spam and bounce rates, so a plan that needs more volume is read against deliverability (Canon spam guardrail 0.10%).
- Home: the email and SMS tiles show goal comparison through `METRICS.target` once the plan carries the two lines.

## Data
- Migration `0012_email_sms_plan.sql`: `plan_targets.email_revenue` and `plan_targets.sms_revenue` (nullable numeric). Plan inputs live in the existing `plan_months.inputs` jsonb (new keys `emailPct`, `smsPct`, with the lock flags the other lines use). Settings keys in `client_settings.extra`: `emailBenchmarkType`, `tier1Flows`.
- Pure logic in `lib/planning/email-sms.ts` (inference, target, daily spread, projection, gap, flow flags) and `lib/reports/email-tracker.ts`, each with tests.

## Verify before build
1. Whether the platform APIs return scheduled campaigns with an audience size (Klaviyo, Postscript, Omnisend).
2. Whether a client's flows can be identified by name or tag well enough for the flow table, or need a manual map.

## Tests
Inference (same month last year, fallback to 90 days, missing data); target and daily spread sum to the month; projection and gap on a fixture month; flow flag at the threshold; override and lock behave like the other Details lines; plan save and reload keeps both lines.

## Not in scope
Per campaign type RPR; list health beyond spam and bounce; segment-level planning; any change to total revenue from the email target; automated messages to clients (rule: nothing is sent without human approval).

## Done when
A plan can carry Email and SMS lines inferred from history and overridden by month; Home goal colours work for the two tiles; the email and SMS trackers show Target, Actual, Planned, Projected and Gap for the pilot client; migration 0012 is applied.
