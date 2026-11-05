# Calendar Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `/reporting/calendar`: a day-by-day table of metrics against plan goals with a Marketing Actions column, and a line chart with action markers above it.

**Architecture:** Pure logic first (action model, metric specs and presets, row builder), then one repository read for Meta launches, then the screen (table, chart, controls). The report reads one list of `MarketingAction`s, so Klaviyo and Postscript sends plug in later without touching the report. It reuses `useDashboardData`, `MetricSpec`, `compare` and `ReportFrame`.

**Tech Stack:** Next.js (read `node_modules/next/dist/docs/` before writing page code; AGENTS.md), React client components, Supabase repository (seed and live), Vitest, plain SVG for the chart.

**Spec:** `docs/superpowers/specs/2026-10-22-calendar-report-design.md` (approved mock: calendar-report mock Artifact).

## Global Constraints
- Name the software "Apex Analytics"; never name Statlas in the UI or client-facing text.
- Heat/tone rule is the existing `compare()` in `lib/metrics.ts`: within 10% neutral; ad spend counts as higher-is-better; CAC is lower-is-better.
- Graph items: no limit; each line on its own scale; the first item also draws its goal as a dashed line.
- Days with no data show a dash, never 0. Future days show the plan's goal values in grey as the projection.
- Selections (columns, graph items, toggles) live in `localStorage` per client, never the database; wrap every access in try/catch.
- Export, Save, the Ads filter and Links are not in v1 (hidden, not inert).
- Work on `development`; commit one task at a time, named files only; never merge into `preview` or `main`.

## Review Focus
- Client with no plan: goal columns, deltas, heat and the goal line disappear; the table still shows actuals.
- A multi-day event that crosses a month edge, or starts before the range: marks only the days inside the range.
- Several actions of one type on one day (and two with the same name): one icon with a count, names listed once each.
- Days in the range with no facts (store not connected yet, data gap): dash, not 0, and excluded from totals' averages.
- Very many ticked graph items (all columns) and a range over 62 days: chart still renders, markers stack, no crash on an empty series.

---

### Task 1: Marketing actions model and sources
**Files:** Create `lib/reports/calendar-actions.ts`; Test `lib/reports/calendar-actions.test.ts`.

**Interfaces:**
- Produces: `type ActionType = "event" | "email" | "sms" | "meta"`; `interface MarketingAction { date: string; type: ActionType; name: string }`; `eventActions(events: MarketingEvent[], range: Range): MarketingAction[]` (one action per day the event covers inside the range; type "event"); `metaLaunchActions(launches: { date: string; campaign: string }[]): MarketingAction[]` (type "meta", name = campaign, one per distinct campaign per day); `actionsByDay(list: MarketingAction[]): Map<string, MarketingAction[]>` (duplicates by type+name collapsed, order: event, email, sms, meta); `groupByType(list): { type: ActionType; names: string[] }[]`.

- [ ] **Step 1: Write failing tests** `eventActions spreads a 3-day event over its days and clips to the range`, `eventActions ignores events entirely outside the range`, `metaLaunchActions collapses two ads of one campaign on one day to one action`, `actionsByDay collapses identical type+name on a day and orders event before email before meta`, `groupByType returns names per type`.
- [ ] **Step 2: Run** `npx vitest run lib/reports/calendar-actions.test.ts`; expect FAIL (module missing).
- [ ] **Step 3: Implement** the five exports above (use `eachDay` from `lib/dates`).
- [ ] **Step 4: Run** the same command; expect PASS.
- [ ] **Step 5: Commit** `feat(calendar-report): marketing action model and sources`.

### Task 2: Metric specs and presets
**Files:** Create `lib/reports/calendar-specs.ts`; Test `lib/reports/calendar-specs.test.ts`.

**Interfaces:**
- Consumes: `MetricSpec` (`lib/reports/metric-spec.ts`), `METRICS`, `groupStats`, `totalSpend`, `orderRevenue`, `div`, `PlanTotals` (`lib/metrics.ts`).
- Produces: `CALENDAR_SPECS: MetricSpec[]` in this order with these keys: `cm`, `rev`, `spend`, `mer`, `acqRev`, `acqSpend`, `amer`, `retRev`, `aov`, `cac`, `email`, `sms`, `organic`, then `fbAcqSpend`, `fbAcqRev`, `fbAcqRoas`, `fbNonAcqSpend`, `fbNonAcqRev`, `fbNonAcqRoas`, `fbSpend`, `fbRev`, `fbRoas`, `gAcqSpend`, `gAcqRev`, `gAcqRoas`, `gBrandSpend`, `gBrandRev`, `gBrandRoas`, `gSpend`, `gRev`, `gRoas`. Labels as in the spec ("Marketing Efficiency Rating", "Facebook Acq Spend", ...). Goals: `cm`, `rev`, `spend`, `mer`, `acqRev`, `acqSpend`, `amer`, `retRev`, `email`, `sms`, `organic` (from `p.mixRevenue`), and the platform spend rows (from `p.spendByChannel`); others have none. `CALENDAR_PRESETS: { id: PresetId; label: string; description: string; keys: string[] | null; goals: "show" | "only" | "hide" | "keep" }[]` where `PresetId = "all" | "basic" | "social" | "search" | "mess" | "onlyGoals" | "hideGoals"`; `basic` keys are `cm, rev, spend, mer`; `social` the Facebook rows; `search` the Google rows; `mess` `email, sms, organic`; `all` = every key; `onlyGoals`/`hideGoals` keep the current columns (`keys: null`).

- [ ] **Step 1: Write failing tests** `keys are unique and every preset key exists`, `basic preset is cm, rev, spend, mer`, `acqRev equals Totals.newOrderRevenue and its goal equals PlanTotals.newRevenue on a fixture`, `fb rows sum meta_acquisition and meta_returning channels as total`, `cac is lower-is-better, others higher`.
- [ ] **Step 2: Run** `npx vitest run lib/reports/calendar-specs.test.ts`; expect FAIL.
- [ ] **Step 3: Implement** the specs, reusing the existing definitions (copy value/goal functions from `MER_SPECS` and `METRICS`; no new formula).
- [ ] **Step 4: Run**; expect PASS.
- [ ] **Step 5: Commit** `feat(calendar-report): metric specs and presets`.

### Task 3: Row builder
**Files:** Create `lib/reports/calendar.ts`; Test `lib/reports/calendar.test.ts`.

**Interfaces:**
- Consumes: `DashData` (`lib/dashboard-data.ts`), `MetricSpec`, `aggregate`, `aggregatePlan`, `compare`, `MarketingAction`, `actionsByDay` (Task 1).
- Produces: `interface CalendarCell { actual: number | null; goal: number | null; tone: Tone; diff: number | null }`; `interface CalendarRow { date: string; label: string; projected: boolean; actions: MarketingAction[]; cells: Record<string, CalendarCell> }`; `buildCalendarRows(a: { data: DashData; specs: MetricSpec[]; actions: MarketingAction[]; showProjection: boolean }): { rows: CalendarRow[]; total: CalendarRow }`. Past days (date <= `data.effTo` and a fact exists): actual from `spec.value`, goal from `spec.goal` on that day's plan row. Days after `effTo`: `projected: true`, `actual` = the goal value (the projection), tone neutral, diff null. Past days without a fact: actual null. `showProjection: false` drops projected days. Total: actual/goal recomputed from the aggregate of the included days (ratios from sums), with goal only over elapsed days with data (the Home rule).

- [ ] **Step 1: Write failing tests** `actual days use spec.value, goal from the plan row, tone via compare`, `days after effTo are projected and show the goal`, `a past day with no fact has null actual and is left out of the total`, `no plan (data.hasPlan false) gives null goals and neutral tones`, `showProjection false drops projected rows`, `total MER is total revenue over total spend, not the mean of the daily MERs`, `actions are attached per day`.
- [ ] **Step 2: Run** `npx vitest run lib/reports/calendar.test.ts`; expect FAIL.
- [ ] **Step 3: Implement** `buildCalendarRows` (label like `Thu, Oct 1` via the existing date helpers).
- [ ] **Step 4: Run**; expect PASS.
- [ ] **Step 5: Commit** `feat(calendar-report): day rows with goals, tones and projection`.

### Task 4: Meta launches read
**Files:** Modify `lib/repository/types.ts`, `lib/repository/supabase.ts`, `lib/repository/seed.ts`; Test `lib/repository/meta-launches.test.ts` (pure mapper).

**Interfaces:**
- Produces: repository method `getMetaLaunches(clientId: string, range: Range): Promise<{ date: string; campaign: string }[] | undefined>` (`undefined` when the ad tables are missing, like `getLastAdDate`); exported pure `mapMetaLaunches(rows: { campaign_name: string | null; created_at: string | null; is_catalog: boolean | null }[]): { date: string; campaign: string }[]` that drops catalog ads and rows without a date, takes `created_at` as the date (first 10 chars), uses `"Unnamed campaign"` when the name is empty, and returns distinct date+campaign pairs sorted by date.
- Seed: returns a few demo launches inside the demo range (so the demo build shows markers).

- [ ] **Step 1: Write failing test** `mapMetaLaunches drops catalog ads, dedupes ads of one campaign and names an unnamed campaign`.
- [ ] **Step 2: Run** `npx vitest run lib/repository/meta-launches.test.ts`; expect FAIL.
- [ ] **Step 3: Implement** the mapper and the Supabase method (`select("campaign_name,created_at,is_catalog")` on `meta_ads`, `eq client_id`, `gte created_at` from, `lte created_at` to end of day; treat a missing-table error like `getLastAdDate`); add the seed version and the interface entry.
- [ ] **Step 4: Run** the test and `npx tsc --noEmit`; expect PASS and no type errors.
- [ ] **Step 5: Commit** `feat(calendar-report): Meta launches read (live and demo)`.

### Task 5: Screen, table and controls
**Files:** Create `components/reports/CalendarReport.tsx`, `components/reports/CalendarTable.tsx`; Modify `components/reports/ReportRouter.tsx` (case `"calendar"`), `lib/reports/registry.ts` (`calendar` status `ready`); Test `lib/reports/calendar-view.test.ts` (pure helpers only).

**Interfaces:**
- Consumes: Tasks 1 to 4; `useApp`, `useReportRange`, `useDashboardData(client, settings, range, null)`, `ReportFrame`, `Loading`, `Empty`.
- Produces: `CalendarReport()` (client component): loads events (`getRepository().listEvents`) and launches (`getMetaLaunches`) for the range, builds actions with `eventActions` and `metaLaunchActions`, holds the view state `{ cols: string[]; graph: string[]; heat: boolean; deltas: boolean; chart: boolean; projection: boolean; goals: "show" | "only" | "hide" }` (defaults: all columns, graph `cm, rev, spend`, heat on, deltas off, chart on, projection on, goals show), restores and saves it to `localStorage` key `apex.calendar.<clientId>`; exports pure `applyPreset(state, presetId): State` and `readViewState(raw: string | null): State | null` (tolerates damaged JSON and unknown keys) from `lib/reports/calendar-view.ts`.
- `CalendarTable({ rows, total, specs, state, currency })`: layout per the spec (sticky Daily and Marketing Actions columns, tinted goal columns, heat via `tone`, deltas in the cell corner, grey projected rows, TOTAL row); the actions cell shows up to three icons with counts and a hover list from `groupByType`.

- [ ] **Step 1: Write failing tests** for `applyPreset`: `basic selects cm, rev, spend, mer and shows goals`, `onlyGoals keeps columns and sets goals to only`, `hideGoals sets goals to hide`, and `readViewState returns null for damaged JSON and drops unknown column keys`.
- [ ] **Step 2: Run** `npx vitest run lib/reports/calendar-view.test.ts`; expect FAIL.
- [ ] **Step 3: Implement** `lib/reports/calendar-view.ts`, then the two components and the Columns, Graph items and Presets controls (checkbox popovers as in the mock; Presets dialog lists the seven presets with their descriptions), the toolbar toggles, and the router and registry entries. Hide Goals/Ads/Links per Global Constraints; show the Goals selector only when the client has more than one plan version.
- [ ] **Step 4: Run** `npx vitest run` and `npx tsc --noEmit`; expect all pass. Then run the demo build (`NEXT_PUBLIC_DATA_MODE` unset) and open `/reporting/calendar`: table renders with heat, deltas toggle works, presets change columns, a day with a marker shows names on hover.
- [ ] **Step 5: Commit** `feat(calendar-report): table, controls and route`.

### Task 6: Chart
**Files:** Create `components/reports/CalendarChart.tsx`; Modify `components/reports/CalendarReport.tsx`; Test `lib/reports/calendar-chart.test.ts` (pure scaling helper `chartSeries`).

**Interfaces:**
- Consumes: `CalendarRow[]`, the graph keys and `CALENDAR_SPECS`.
- Produces: pure `chartSeries(rows: CalendarRow[], keys: string[]): { key: string; label: string; values: (number | null)[]; goals: (number | null)[]; max: number; min: number }[]` (skips unknown keys; `max`/`min` per series, never equal so a flat or empty series does not divide by zero); `CalendarChart({ rows, series, actions, currency })` as in the mock: lines per series (own scale), goal as dashed line for the first series, projected segment dashed with a faint band, marker rows under the axis per type, crosshair plus tooltip with every plotted value and the day's action names, legend.

- [ ] **Step 1: Write failing tests** `chartSeries gives each series its own min and max`, `a flat or all-null series gets distinct min and max`, `unknown keys are skipped`, `goals line up with rows`.
- [ ] **Step 2: Run** `npx vitest run lib/reports/calendar-chart.test.ts`; expect FAIL.
- [ ] **Step 3: Implement** `chartSeries` and the component; mount it above the table when `state.chart` is on; the legend colours cycle through eight tokens.
- [ ] **Step 4: Run** `npx vitest run` and `npx tsc --noEmit`; then check in the demo build with 1, 3 and all columns ticked, a 90-day range and the projection toggle; the chart renders and the tooltip lists action names.
- [ ] **Step 5: Commit** `feat(calendar-report): line chart with action markers`.

### Task 7: Docs and release notes
**Files:** Modify `docs/changelog.md`, `docs/reports-plan.md` (Calendar status), `CLAUDE.md` (one line under Reports), `docs/statlas-findings.md` (build log line).

- [ ] **Step 1:** Add the changelog entry (what was built, what reads real data now, what waits for Klaviyo and Postscript), update the reports plan status to "built", add the CLAUDE.md line.
- [ ] **Step 2:** Run `npx vitest run` and `npx tsc --noEmit`; expect clean.
- [ ] **Step 3: Commit** `docs: calendar report built` (named files only), then tell the strategist it is ready to push and release.

---

## Self-review
- **Spec coverage:** controls (Task 5), chart (6), table/tones/deltas/totals (3, 5), presets (2, 5), actions sources and shape (1, 4), no-plan, projection, long range, remembered selections (3, 5, 6), not-in-v1 items (Global Constraints), structure units (Tasks 1 to 6). The spec says Meta launches come "via the creative read functions"; the plan reads `meta_ads.campaign_name` directly because those functions return ad names, not campaigns (the reference shows campaign names). The spec is updated to match.
- **Type consistency:** `MarketingAction`, `CalendarRow`, `CalendarCell`, `chartSeries` names are used identically across tasks.
- **Proportion:** logic and tests are specified by signature and assertions; no function bodies are written out.
