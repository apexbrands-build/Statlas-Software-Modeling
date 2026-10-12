import { describe, expect, it, vi } from "vitest";
import type { Repository } from "../repository/types";
import type { PlanVersion } from "../types";
import { FLAT_SEASONALITY } from "./generate";
import { DEFAULT_NEW_CUSTOMER } from "./models";
import { baseMonths, baseRows, cohortsFor, factsFrom, lastData, settings } from "./stretch-fixtures";
import { checkStretch, createStretch, explainStretchError, regenerateStretch, type StretchCtx } from "./stretch-actions";

const baseline: PlanVersion = { id: "base", clientId: "c", name: "2026 Plan", isDefault: true, year: 2026, description: "", seasonality: FLAT_SEASONALITY, updatedAt: null, updatedBy: null, scenario: "baseline", baseId: null, goal: null };
const ctx: StretchCtx = { clientId: "c", settings, history: { facts: factsFrom("2024-01-01", lastData), lastData, loading: false }, openPlanId: "base", seasonality: FLAT_SEASONALITY, eventMults: {} };
const goal = { metric: "newRevenueGrowth", value: 20 } as const;

function repoWith(over: Partial<Record<keyof Repository, unknown>> = {}) {
  const calls = { createPlan: vi.fn(), deletePlan: vi.fn(), savePlanMonths: vi.fn(), updatePlan: vi.fn(), savePlanModel: vi.fn() };
  const repo = {
    listPlans: async () => [baseline],
    getPlanMonths: async () => baseMonths,
    getPlanTargets: async () => Object.values(baseRows).flat(),
    getPlanModel: async (_id: string, kind: string) => (kind === "new_customer" ? { settings: { ...DEFAULT_NEW_CUSTOMER, months: {} }, results: null, updatedAt: null, updatedBy: null } : null),
    getCohortData: async () => ({ available: true, stats: [], cohorts: cohortsFor() }),
    createPlan: async (clientId: string, input: Record<string, unknown>) => {
      calls.createPlan(clientId, input);
      return { ...baseline, id: "stretch", isDefault: false, name: String(input.name), scenario: "target", baseId: "base", goal } as PlanVersion;
    },
    updatePlan: async (...a: unknown[]) => void calls.updatePlan(...a),
    deletePlan: async (...a: unknown[]) => void calls.deletePlan(...a),
    savePlanMonths: async (...a: unknown[]) => void calls.savePlanMonths(...a),
    savePlanModel: async (...a: unknown[]) => void calls.savePlanModel(...a),
    ...over,
  };
  return { repo: repo as unknown as Repository, calls };
}

describe("explainStretchError", () => {
  it("names the missing migration when the database lacks the scenario columns", () => {
    expect(explainStretchError(new Error('column "scenario" of relation "plan_versions" does not exist'))).toMatch(/migration 0011/i);
    expect(explainStretchError(new Error("Could not find the 'base_plan_id' column of 'plan_versions' in the schema cache"))).toMatch(/migration 0011/i);
  });

  it("says a stretch already exists when the one-per-year index is hit", () => {
    expect(explainStretchError(new Error('duplicate key value violates unique constraint "plan_versions_one_target"'))).toMatch(/already has a stretch/i);
  });

  it("passes any other message through", () => {
    expect(explainStretchError(new Error("network down"))).toBe("network down");
    expect(explainStretchError("odd")).toMatch(/could not/i);
  });
});

describe("createStretch", () => {
  it("builds and saves a stretch plan linked to its baseline", async () => {
    const { repo, calls } = repoWith();
    const out = await createStretch(repo, ctx, baseline, goal);
    expect(out.ok).toBe(true);
    expect(calls.createPlan).toHaveBeenCalledWith("c", expect.objectContaining({ scenario: "target", baseId: "base", goal, name: "2026 Plan (stretch)" }));
    const items = calls.savePlanMonths.mock.calls[0][1] as { rows: { planId: string }[] }[];
    expect(items.flatMap((i) => i.rows).every((r) => r.planId === "stretch")).toBe(true);
  });

  it("answers with a plain message, and saves nothing, when the database lacks migration 0011", async () => {
    const { repo, calls } = repoWith({ createPlan: async () => { throw new Error('column "scenario" of relation "plan_versions" does not exist'); } });
    const out = await createStretch(repo, ctx, baseline, goal);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toMatch(/migration 0011/i);
    expect(calls.savePlanMonths).not.toHaveBeenCalled();
    expect(calls.deletePlan).not.toHaveBeenCalled();
  });

  it("removes the plan it created when saving the months fails", async () => {
    const { repo, calls } = repoWith({ savePlanMonths: async () => { throw new Error("disk full"); } });
    const out = await createStretch(repo, ctx, baseline, goal);
    expect(out).toEqual({ ok: false, reason: "disk full" });
    expect(calls.deletePlan).toHaveBeenCalledTimes(1);
  });

  it("refuses when the year already has a stretch", async () => {
    const existing = { ...baseline, id: "old", scenario: "target" } as PlanVersion;
    const { repo, calls } = repoWith({ listPlans: async () => [baseline, existing] });
    const out = await createStretch(repo, ctx, baseline, goal);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toMatch(/already has a stretch/i);
    expect(calls.createPlan).not.toHaveBeenCalled();
  });

  it("explains a baseline whose New Customer Model was never saved", async () => {
    const { repo } = repoWith({ getPlanModel: async () => null });
    const out = await createStretch(repo, ctx, baseline, goal);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toMatch(/New Customer Model/);
  });
});

describe("checkStretch", () => {
  it("is ok for a baseline that can be stretched", async () => {
    expect((await checkStretch(repoWith().repo, ctx, baseline)).ok).toBe(true);
  });

  it("turns a repository failure into a message instead of throwing", async () => {
    const { repo } = repoWith({ getPlanMonths: async () => { throw new Error("connection reset"); } });
    expect(await checkStretch(repo, ctx, baseline)).toEqual({ ok: false, reason: "connection reset" });
  });
});

describe("regenerateStretch", () => {
  const stretch = { ...baseline, id: "stretch", isDefault: false, scenario: "target", baseId: "base", goal } as PlanVersion;

  it("saves the recomputed months to the stretch and keeps the goal", async () => {
    const { repo, calls } = repoWith({ getPlanMonths: async (id: string) => (id === "stretch" ? baseMonths : baseMonths) });
    const out = await regenerateStretch(repo, ctx, stretch, baseline);
    expect(out.ok).toBe(true);
    expect(calls.savePlanMonths).toHaveBeenCalledTimes(1);
    expect(calls.updatePlan).not.toHaveBeenCalled();
  });

  it("saves a changed goal on the plan", async () => {
    const { repo, calls } = repoWith();
    await regenerateStretch(repo, ctx, stretch, baseline, { metric: "newRevenueGrowth", value: 30 });
    expect(calls.updatePlan).toHaveBeenCalledWith(expect.objectContaining({ goal: { metric: "newRevenueGrowth", value: 30 } }), "Changed the stretch goal");
  });

  it("does not log a goal change when the goal is the same", async () => {
    const { repo, calls } = repoWith();
    await regenerateStretch(repo, ctx, stretch, baseline, { ...goal });
    expect(calls.updatePlan).not.toHaveBeenCalled();
  });

  it("answers with a message when the repository fails", async () => {
    const { repo } = repoWith({ savePlanMonths: async () => { throw new Error("rls denied"); } });
    expect(await regenerateStretch(repo, ctx, stretch, baseline)).toEqual({ ok: false, reason: "rls denied" });
  });
});
