import type { Repository } from "../repository/types";
import type { ClientSettings, DailyFact, PlanSeasonality, PlanTargetDay, PlanVersion, StretchGoal } from "../types";
import type { DayMultipliers } from "./events";
import { FLAT_SEASONALITY } from "./generate";
import { DEFAULT_NEW_CUSTOMER, DEFAULT_RETURNING, type NewCustomerSettings, type ReturningSettings } from "./models";
import { stretchName } from "./scenarios";
import { planStretch, type StretchPlanInput } from "./stretch-plan";
import type { PlanMonth } from "./types";

/** What the stretch actions need from the open plan editor. */
export interface StretchCtx {
  clientId: string;
  settings: ClientSettings;
  /** The client's whole history, as the editor loaded it. */
  history: { facts: DailyFact[]; lastData: string; loading: boolean };
  /** The plan currently open in the editor. */
  openPlanId: string;
  seasonality: PlanSeasonality;
  eventMults: Record<string, DayMultipliers>;
}

/** What the stretch needs from the baseline, loaded from what is saved (so an unsaved draft in the editor is not part of it). */
type Loaded = Omit<StretchPlanInput, "planId" | "goal">;

const byMonth = (rows: PlanTargetDay[]) => {
  const out: Record<string, PlanTargetDay[]> = {};
  for (const r of rows) (out[`${r.date.slice(0, 7)}-01`] ??= []).push(r);
  return out;
};

/** A repository or database error as a sentence the strategist can act on. */
export function explainStretchError(e: unknown): string {
  const msg = e instanceof Error ? e.message : "";
  if (/scenario|base_plan_id|\bgoal\b/i.test(msg) && /column|schema cache|does not exist/i.test(msg)) return "The database needs migration 0011 (plan scenarios) before a stretch can be saved. Ask for it to be applied, then try again.";
  if (/plan_versions_one_target|duplicate key/i.test(msg)) return "This year already has a stretch plan. Open it and use Regenerate.";
  return msg || "Could not save the stretch plan.";
}

async function loadBaseline(repo: Repository, ctx: StretchCtx, baseline: PlanVersion): Promise<{ ok: true; input: Loaded } | { ok: false; reason: string }> {
  if (ctx.history.loading || !ctx.history.lastData) return { ok: false, reason: "The client's history is still loading. Try again in a moment." };
  const year = baseline.year;
  const [months, targets, nc, rt, cohort] = await Promise.all([
    repo.getPlanMonths(baseline.id),
    repo.getPlanTargets(ctx.clientId, baseline.id, `${year}-01-01`, `${year}-12-31`),
    repo.getPlanModel(baseline.id, "new_customer"),
    repo.getPlanModel(baseline.id, "returning"),
    repo.getCohortData(ctx.clientId),
  ]);
  if (!nc) return { ok: false, reason: "Save the New Customer Model on the baseline first (Models tab): the stretch uses its curve and settings." };
  return {
    ok: true,
    input: {
      clientId: ctx.clientId,
      year,
      settings: ctx.settings,
      facts: ctx.history.facts,
      lastData: ctx.history.lastData,
      seasonality: baseline.seasonality ?? (ctx.openPlanId === baseline.id ? ctx.seasonality : FLAT_SEASONALITY),
      eventMults: ctx.eventMults,
      newSettings: { ...DEFAULT_NEW_CUSTOMER, months: {}, ...(nc.settings as Partial<NewCustomerSettings>) } as NewCustomerSettings,
      retSettings: { ...DEFAULT_RETURNING, ...((rt?.settings as Partial<ReturningSettings> | undefined) ?? {}) },
      cohort,
      baseline: { months, rows: byMonth(targets) },
    },
  };
}

export type StretchOutcome = { ok: true; plan: PlanVersion; message: string } | { ok: false; reason: string };

/** Whether a stretch can be built for this baseline, and if not, why in plain words (shown instead of the Create form). */
export async function checkStretch(repo: Repository, ctx: StretchCtx, baseline: PlanVersion): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    const loaded = await loadBaseline(repo, ctx, baseline);
    if (!loaded.ok) return loaded;
    const out = planStretch({ ...loaded.input, planId: "check", goal: { metric: "totalRevenue", value: 1 } });
    return out.ok ? { ok: true } : { ok: false, reason: out.reason };
  } catch (e) {
    return { ok: false, reason: explainStretchError(e) };
  }
}

/** Creates the year's stretch plan from the baseline and a goal. Nothing is left behind if saving fails, and no error escapes. */
export async function createStretch(repo: Repository, ctx: StretchCtx, baseline: PlanVersion, goal: StretchGoal): Promise<StretchOutcome> {
  let created: PlanVersion | null = null;
  try {
    const existing = (await repo.listPlans(ctx.clientId)).find((p) => p.scenario === "target" && p.year === baseline.year);
    if (existing) return { ok: false, reason: `${baseline.year} already has a stretch plan. Open it and use Regenerate.` };
    const loaded = await loadBaseline(repo, ctx, baseline);
    if (!loaded.ok) return loaded;
    const out = planStretch({ ...loaded.input, planId: "pending", goal });
    if (!out.ok) return out;

    created = await repo.createPlan(ctx.clientId, { name: stretchName(baseline.name), year: baseline.year, description: `Stretch of ${baseline.name}`, scenario: "target", baseId: baseline.id, goal });
    const plan = created;
    await repo.updatePlan({ ...plan, seasonality: loaded.input.seasonality }, undefined);
    const event = await repo.getPlanModel(baseline.id, "event");
    if (event) await repo.savePlanModel(plan, "event", event.settings, event.results, "Copied from the baseline");
    const items = out.months.map((month) => ({ month, rows: (out.rows[month.month] ?? []).map((r) => ({ ...r, planId: plan.id })) }));
    await repo.savePlanMonths(plan, items, "Created stretch scenario");
    return { ok: true, plan: { ...plan, seasonality: loaded.input.seasonality }, message: out.result.message };
  } catch (e) {
    if (created) await repo.deletePlan(created).catch(() => undefined);
    return { ok: false, reason: explainStretchError(e) };
  }
}

/** Recomputes the unlocked months of an existing stretch from the baseline's current saved plan. Locked months keep the stretch's own inputs. */
export async function regenerateStretch(repo: Repository, ctx: StretchCtx, stretch: PlanVersion, baseline: PlanVersion, goal?: StretchGoal): Promise<StretchOutcome> {
  try {
    const useGoal = goal ?? stretch.goal;
    if (!useGoal) return { ok: false, reason: "This stretch has no goal saved. Enter one and regenerate." };
    const loaded = await loadBaseline(repo, ctx, baseline);
    if (!loaded.ok) return loaded;
    const [ownMonths, ownTargets] = await Promise.all([repo.getPlanMonths(stretch.id), repo.getPlanTargets(ctx.clientId, stretch.id, `${stretch.year}-01-01`, `${stretch.year}-12-31`)]);
    // A month the strategist locked in the stretch is solved as locked and copied from the stretch, not the baseline.
    const own = new Map(ownMonths.map((m) => [m.month, m]));
    const ownRows = byMonth(ownTargets);
    const merged: PlanMonth[] = loaded.input.baseline.months.map((m) => (own.get(m.month)?.locked ? own.get(m.month)! : m));
    const rows = { ...loaded.input.baseline.rows };
    for (const m of merged) if (own.get(m.month)?.locked) rows[m.month] = ownRows[m.month] ?? [];
    const out = planStretch({ ...loaded.input, planId: stretch.id, goal: useGoal, baseline: { months: merged, rows } });
    if (!out.ok) return out;
    await repo.savePlanMonths(stretch, out.months.map((month) => ({ month, rows: out.rows[month.month] ?? [] })), "Regenerated stretch scenario");
    const updated = { ...stretch, goal: useGoal };
    if (goal && JSON.stringify(goal) !== JSON.stringify(stretch.goal)) await repo.updatePlan(updated, "Changed the stretch goal");
    return { ok: true, plan: updated, message: out.result.message };
  } catch (e) {
    return { ok: false, reason: explainStretchError(e) };
  }
}
