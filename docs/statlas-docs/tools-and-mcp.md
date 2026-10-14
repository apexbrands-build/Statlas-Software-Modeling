# Tools, MCP and Statlas Ads

## Email Plan (monthly email forecast)
Four numbers: **Target** (goal for email), **Actual** (earned so far), **Planned** (audience x revenue-per-recipient benchmark), **Projected** (actual for sent + planned for scheduled + flows).
- Plan Gap = Projected - Target
- Type RPR benchmark = average (conversion value / audience) of sent campaigns of that type
- Flow monthly estimate = daily average revenue x days in month
- Target card: doughnut, total order revenue vs store target, actual MTD, plan gap. Campaign calendar edits recalc instantly. Flows table compares each flow RPR to benchmark. Health: spam rate, net list growth.
- Early month Projected ~ Planned + flows; late month converges to Actual.

## MCP (Ad Log, beta)
Review-gated import of ad batches from a Google Drive folder: submitted -> grouping_ready -> (edits, preview) -> explicit confirm -> entering -> ready_to_deploy. Saving is not approval; campaign/ad set IDs are added after confirmation.

## Statlas Ads (creative production platform)
Plan ad needs per marketing moment (video/static), order batches from design partners, track In Production / In Review / Completed, approve/reject/revise with threads, auto-build final creatives and share links.
API (alpha, partners): base api.statlas.io/v1, bearer token; batches list/get/deliver/complete, per-ad asset upload and update; webhooks batch.created, batch.updated, revision.requested; limits 100 GET, 30 POST/PATCH, 10 uploads per minute.
Best Creatives is now in scope as our own design (released 2026-10-12, plan `docs/superpowers/plans/2026-10-13-best-creatives-report.md`); Global Creatives stays out of scope.
