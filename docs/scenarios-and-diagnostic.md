# Scenarios, growth targets and the growth diagnostic (notes, 2026-10-02)

Status: **ideas and decisions from the strategist, not built.** Priority stays: **get the baseline forecast (New Customer, Returning, Event models, Spend, Details, Input, P&L) working first.** Everything here comes after. Related: `docs/forecasting-build-outline.md`, `docs/forecasting-context.md`.

Source material: the agency's client deck "Growth Strategy / Service Delivery Template" (PDF, saved in the `aMER model V2 - Jack` folder; not yet read by Claude) and the Growth Diagnostic form at https://commonthreadco.com/pages/ecom-diagnostic.

## 1. What "Last year + growth %" means in Create forecast
It is the client's **growth ambition**: each month's spend starts from the same month last year and is raised by the chosen % (for example +100% to double). The model then shows what that spend would return on the historical curve (aMER, new revenue, CM). It does not promise the ambition: if the curve says efficiency falls too far at that spend, the result shows it (lower aMER, weaker or negative CM). That gap between the aspiration and what history supports is the point of showing it.

Default stays **Max CM**. The "last year + growth %" rule is the way to test an aspirational target.

## 2. Scenarios (idea)
Today a plan is one version, and one plan per client and year is the Default that Home and the reports compare against.

Agency practice (from the strategist):
- The **baseline scenario** is what the model supports. The one tracked on the Home dashboard is the **90th-percentile / highest-confidence outcome** (the line the business is very likely to reach).
- A **second, aspirational scenario** is built from the client's goal ("grow X% YoY, profitably"). It is not tracked on Home by default, but we track it on the side to see **where we are lacking day by day** and what the gap would look like. That gap guides which initiatives to run to lock in the volume at the efficiency the model assumes.
- Scenarios are normally presented to the client in a deck.

Open questions, to decide later:
1. Do we need a separate "scenario" object, or is it enough to use several plan versions per year (the plan editor already supports versions, one marked Default)? Likely the second one: add a **scenario type / label** (Baseline, Target, Stretch) on plan versions, a **side-by-side comparison** (spend, new, returning, CM, aMER by month) and a "gap to target" view by day on the aspirational one.
2. How to build the aspirational scenario: from a **growth target** (revenue or CM, % YoY) that solves for the spend the curve needs, then shows the resulting aMER and CM, and flags when it breaks profitability (CM < 0 or aMER below a floor). That would be a "required spend to hit the target" calculator next to Create forecast.
3. Whether tracking against the second scenario needs its own Home toggle (Home keeps the default plan).

This is extra complexity; do not start until the baseline layer works.

## 3. Growth diagnostic (plus, later)
The agency runs a "growth diagnostic" at onboarding (a form, currently a hosted form on the agency's site) and compares the client with benchmarks and with the agency's full client database (slide shows percentiles / numbers vs benchmark).

Idea: build it inside the app.
- An interactive form the client (or the strategist) fills in, and answers that can be inferred from data we already hold (Shopify, ad platforms) are pre-filled.
- Results shown against benchmark percentages or numbers and against the **agency's own client database**, stored in Supabase as each client completes it, so the comparison improves over time.
- Fits the onboarding checklist (`/onboarding`).
- Before building: read the diagnostic form and the deck slides (which metrics, which benchmarks), decide what is inferred vs asked, and what is shared with clients (privacy of the cross-client database: show only anonymous percentiles).
- **Update 2026-10-13:** the form was run end to end and the method verified (ten metrics, formulas, benchmarks, scoring 130 plus the plain sum of points, no cap). The replication design, input mapping to our tables and a test case are in `docs/superpowers/specs/2026-10-13-growth-quotient-design.md`. Still not started; it needs the strategist's go-ahead.

## 4. Next
The strategist will send a list of adjustments to the New Customer / spend-aMER model. After that: Calendar + Event model, Returning model Create forecast, Spend daily table, Details, Input, P&L (see the outline).
