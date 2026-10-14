# ROAS targets per channel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every plan month carries a ROAS target per channel (platform ROAS = the month's aMER divided by the channel's incrementality factor, editable per month in Details), shown in the Spend step and used as the plan target on Home's channel ROAS and iROAS tiles.

**Architecture:** A pure module (`lib/planning/roas.ts`) turns plan months plus client factors into month-by-channel targets; `aggregatePlan` takes an optional `roasOf` so plan totals carry planned spend and expected platform revenue per channel; the channel ROAS metric defs read them as targets. Manual targets live in `PlanMonthInputs.roas` (inside the existing `plan_months.inputs` JSON, no migration). Home loads the plan's months next to its daily targets.

**Tech Stack:** Next.js 16 client components, Vitest (pure functions only).

**Spec:** the strategist's decision of 2026-10-14 in chat (platform ROAS target = aMER ÷ channel factor; a ROAS line in Details with a Suggested method, monthly values and Actualize YTD), the Statlas Details ROAS screenshots (`Statlas Original UX/Forecasting and Calendar Layer/Details and ROAS/`), and `docs/beta-readiness-audit-2026-10-14.md` gap 3. No older spec; the formula is the whole method.

## Global Constraints

- Platform ROAS target = month aMER ÷ channel factor (`settings.multipliers[channel] ?? 1`); incremental ROAS target = platform target × factor (equals aMER while Suggested).
- Channels with a target: every acquisition channel and Google Brand; the returning channels (`RETENTION_CHANNELS`) get none (aMER is an acquisition measure). A group containing spending returning channels shows no target.
- Month aMER = `PlanMonthInputs.amer` (the number the Spend step shows as aMER).
- Manual values are stored per channel and month in `PlanMonthInputs.roas`; absent = Suggested; a value of 0 or less clears it.
- Never `NaN`: missing or zero denominators give null and render as a dash.
- No migration. No change to how revenue, spend or CM targets are generated.
- `AGENTS.md`: components only here; no route or page files change.

## Review Focus

1. A channel with no factor (treated as 1), a factor of 0, or a month with aMER 0: the target is the aMER or null, never Infinity or NaN. Task 1.
2. A group of channels where one has spend and no target (returning): no target is shown, not a wrong one. Task 2.
3. A range that spans months with different aMERs: the target is spend-weighted (expected platform revenue over planned spend), not an average of months. Task 2.
4. Editing a ROAS cell in a locked month, or clearing it: locked months cannot change; clearing returns to Suggested. Task 4.
5. A plan saved before this feature (no `roas` field), and a stretch plan copied from a baseline: both still load and target Suggested values. Task 1.

---

### Task 1: The pure module

**Files:** Create `lib/planning/roas.ts`, `lib/planning/roas.test.ts`. Modify `lib/planning/types.ts` (`PlanMonthInputs.roas?: Partial<Record<ChannelKey, number>>`).

**Interfaces:** Produces `suggestedRoas(amer: number, factor: number): number | null`; `roasChannels(settings: ClientSettings, months: PlanMonth[]): ChannelKey[]`; `roasTarget(inputs: PlanMonthInputs | null, channel: ChannelKey, factor: number): { value: number | null; manual: boolean }`; `MonthRoasTargets = Record<string, Partial<Record<ChannelKey, number>>>` (key `YYYY-MM`); `planRoasTargets(months: PlanMonth[], settings: ClientSettings): MonthRoasTargets`; `RoasOf = (date: string, channel: ChannelKey) => number | null`; `roasOf(targets: MonthRoasTargets): RoasOf`.

- [ ] **Step 1: Write failing tests:** `suggestedRoas(2.2, 0.75)` is 2.9333 (rounded by callers), factor 0 or aMER 0 give null; with Statlas's example (aMER 2.21, factors 0.75, 1.2, 0.3) the targets are 2.95, 1.84, 7.37; `roasChannels` lists Google, Google Brand and Meta acquisition always, adds Pinterest when it has a factor or planned spend, never `meta_returning`; `roasTarget` with a manual value returns it with `manual: true`, with `0` falls back to suggested, with null inputs gives null; `planRoasTargets` skips months with no inputs, uses `inputs.amer` and the client's factor, and a channel with no factor uses 1; `roasOf` answers by the date's month and returns null for an unknown month or channel.
- [ ] **Step 2: Run:** FAIL. **Step 3: Implement.** **Step 4: Run:** PASS.

### Task 2: Plan totals and the channel ROAS targets

**Files:** Modify `lib/metrics.ts` (`PlanTotals.platformRoasPlan`, `aggregatePlan(rows, roasOf?)`, `groupRoasTarget`, `channelMetricDefs` iroas `target`), `lib/plan-roas.test.ts` (new).

**Interfaces:** `PlanTotals.platformRoasPlan: Partial<Record<ChannelKey, { spend: number; expectedRevenue: number }>>` (empty without `roasOf`); `groupRoasTarget(p: PlanTotals, s: ClientSettings, channels: ChannelKey[], incremental: boolean): number | null`.

- [ ] **Step 1: Write failing tests:** two days of Meta spend 100 and 300 in months with platform targets 2.0 and 1.0 give a range target of (200 + 300) / 400 = 1.25 (spend-weighted); incremental mode multiplies each channel's expected revenue by its factor, so Meta (factor 1.2) at Suggested equals the month aMER; a group of Meta acquisition plus spending Meta Returning gives null; a channel with no spend gives null; no `roasOf` gives null; `METRICS`-style defs from `channelMetricDefs` expose the target on `.iroas` only.
- [ ] **Step 2: Run:** FAIL. **Step 3: Implement.** **Step 4: Run** the whole suite: PASS.

### Task 3: Home and the reports read the targets

**Files:** Modify `lib/dashboard-data.ts` (load `repo.getPlanMonths(plan.id)`, `DashData.roasOf`, pass it to `aggregatePlan`), `lib/monthly.ts` (two `aggregatePlan` calls pass `data.roasOf`).

- [ ] **Step 1:** wire the load and the argument. **Step 2:** `npx tsc --noEmit`, `npx eslint .`, `npm test`: PASS. A failing `getPlanMonths` leaves `roasOf` null (the tile simply has no target).

### Task 4: Details line and Spend panel

**Files:** Create `components/planning/RoasLine.tsx`. Modify `components/planning/DetailsStep.tsx` (line `roas`, after SG&A, with Back/Next), `components/planning/SpendStep.tsx` (a "ROAS targets" panel for the selected month: channel, planned spend, factor, iROAS target, platform ROAS target, expected platform revenue).

- [ ] **Step 1:** `RoasLine`: table channel rows by month columns (like the reference), Factor column, Method per row (Suggested clears manual values on unlocked months; Manual copies the current values), editable cells (disabled when the month is locked or has no inputs), "Actualize all YTD" sets completed months to the actual platform ROAS from history (7-day click platform revenue over spend). **Step 2:** the Spend panel. **Step 3:** `npx tsc --noEmit`, `npx eslint .`, `npm run build`, browser check in demo mode.

### Task 5: Docs

**Files:** Modify `docs/planning-layer.md`, `docs/changelog.md`, `CLAUDE.md`, and the two docs that call ROAS targets "built" (`docs/future-vision.md`, the channel-mix spec) so they say what exists.

---

## Self-review

- **Spec coverage:** formula, Details line (Suggested/Manual/Actualize YTD), Spend display, Home tile targets and the daily MetricModal target are covered; Paid Media Overview goals follow if time allows (not in this plan).
- **Type consistency:** `roasOf`, `RoasOf`, `planRoasTargets`, `platformRoasPlan`, `groupRoasTarget`, `PlanMonthInputs.roas` are spelled the same in every task.
- **Proportion:** five tasks, signatures and assertions only.

**Sizing:** about 1.5 working days for Claude (test first, one independent review at the end). Risk: Home gains one more request; the browser check needs a plan with inputs. Needs from the strategist: nothing further (formula and screens confirmed 2026-10-14).
