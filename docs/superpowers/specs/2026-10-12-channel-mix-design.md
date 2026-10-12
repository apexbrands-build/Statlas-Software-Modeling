# Channel mix: suggested spend share per channel

Date: 2026-10-12. Status: draft for the strategist's review. Source: The Bridge (`Agency/Training/Copy of The Bridge.pdf`, pages 28 to 33, including the page 33 screenshot), `Agency/Training/CTC Canon/forecasting.md` (Spending Power, MMM), the Notepad tab `channel_frcst`, and the planning layer.

## Goal
Replace the fixed percentage sliders as the starting point for the platform split with a suggestion built from the client's own history, and show how sure the suggestion is.

## What the sources say
- The Growth Map chain (Bridge p.28): the spend/aMER model sets the total budget, incrementality tests calibrate the media mix model, the MMM allocates channel budgets and sets ROAS targets, and daily execution follows platform ROAS targets. We have the first and the last link; the middle one is this spec.
- Page 33 shows four scatter charts. For Meta, Google and TikTok: x is the channel's percent of spend, y is "percent beating the model". For Snapchat: y is Spending Power. The suggested spend sits where the points are highest: Meta 75%, Google about 25 to 30% (as low as 10% in bigger months), Snapchat about 3%, and "unclear if TikTok is worth it" where the points show no pattern. Spend power is the total spend needed to raise weighted CAC by $1, a measure of market elasticity. The strategist's reading is that each dot is a month.
- The Canon defines Spending Power as 1 / the slope of the line of ACONS (ad spend over new revenue) against spend, and MMM as marginal ROI per channel with adstock and saturation. Page 29 gives incrementality factors: Meta acquisition 120%, Google non-brand 75%, YouTube 75%, Google brand 25%, conversion social (TikTok, Pinterest, Snapchat) 30%, awareness and CTV 30%; ROAS target = aMER target / factor.
- The Notepad's `channel_frcst` and `statlas_sync` use fixed splits (Facebook 90%, Google 10%, brand shares typed), which is the weakness this replaces.

## Design (first version: mix analysis, not a full MMM)

### Method, per channel
1. One point per calendar month with at least 18 months of history recommended (12 minimum): **x** = the channel's share of acquisition spend that month, from `daily_channel_facts`; **y** = the month's actual new revenue divided by the revenue the saved New Customer model expects at that month's spend, minus 1 ("percent beating the model").
2. Fit a smooth curve of y on x (a quadratic with a bounded peak) and take the x with the highest fitted y inside the observed range as the **suggested share**.
3. **Confidence:** months used, the width of the observed share range, and the fit's strength. A channel is marked **Unclear** when fewer than 12 months, a range narrower than 10 percentage points, or no meaningful fit; the app then keeps last year's share instead of inventing a number (the deck's own "unclear for TikTok").
4. Snapchat-style channels with tiny shares can also show Spending Power by month against share (the page 33 fourth chart) as a second view.

### Output
- **Channel mix** sub-tab in the plan editor's Models tab (next to New Customer, Returning, Event): one scatter per channel with the fitted curve, the suggested share, the client's last-12-months average share, and the confidence note; a table of suggested shares normalised to 100% with a minimum and a maximum per channel.
- **Use as starting point** in the Spend step's platform allocation (beside "last year, last 3 months, last month"): fills the split for the month or the year; the sliders and locks still work.
- Incrementality overlay: the suggested ROAS target per channel = aMER target / the client's factor (already built); the missing default factors are added (YouTube 0.75; TikTok, Pinterest, Snapchat 0.30; the Bridge says 0.25 for Google brand, but the app's 0.30 is a confirmed decision, so it changes only on the strategist's say-so).

### Honest limits
The expected revenue comes from a model fitted on the same history, so y averages near zero by construction; the chart shows relative differences between months, not proof of cause. A client whose mix barely changes (Meta always 80%) gets "Unclear" for every channel. A full Bayesian MMM with adstock and saturation (the Canon's version) is a later spec and needs more months of channel-level variation than most clients have.

## Data
No new tables. Pure logic in `lib/planning/channel-mix.ts` (monthly points, curve fit, suggestion, confidence, normalisation), reading monthly channel spend, monthly new revenue and the New Customer model's expected revenue function. Settings: per-channel minimum and maximum share in `plan_models` (kind `channel_mix`).

## Tests
Synthetic fixture with a known peak (the suggestion lands within 3 points of it); a flat relationship returns Unclear; fewer than 12 months returns Unclear; shares normalise to 100% with min and max respected; a channel with zero spend is excluded; the suggestion never leaves the observed range plus 5 points.

## Not in scope
Bayesian MMM, incrementality test design and analysis, budget change recommendations by day, creative.

## Done when
For a client with at least 12 months of channel spend, the Channel mix tab shows a chart and a suggested share with confidence for each channel, and "Use as starting point" fills the platform split in the Spend step.
