import type { PlanScenario, PlanVersion, StretchGoal } from "../types";

const GOAL_METRICS = new Set<StretchGoal["metric"]>(["newRevenueGrowth", "totalRevenueGrowth", "totalRevenue"]);

function readGoal(raw: unknown): StretchGoal | null {
  if (!raw || typeof raw !== "object") return null;
  const g = raw as Record<string, unknown>;
  if (!GOAL_METRICS.has(g.metric as StretchGoal["metric"])) return null;
  if (typeof g.value !== "number" || !Number.isFinite(g.value)) return null;
  const goal: StretchGoal = { metric: g.metric as StretchGoal["metric"], value: g.value };
  if (typeof g.cmFloor === "number" && Number.isFinite(g.cmFloor)) goal.cmFloor = g.cmFloor;
  if (typeof g.amerFloor === "number" && Number.isFinite(g.amerFloor)) goal.amerFloor = g.amerFloor;
  return goal;
}

/** The scenario columns of a plan_versions row; a row from before migration 0011 is a baseline. */
export function readScenarioFields(row: Record<string, unknown>): { scenario: PlanScenario; baseId: string | null; goal: StretchGoal | null } {
  return {
    scenario: row.scenario === "target" ? "target" : "baseline",
    baseId: typeof row.base_plan_id === "string" ? row.base_plan_id : null,
    goal: readGoal(row.goal),
  };
}

/** The plan Home and the reports use for a year. Baseline = the default plan (never a stretch); target = the year's stretch, else the baseline. */
export function pickPlan(plans: PlanVersion[], year: number, scenario: PlanScenario): PlanVersion | undefined {
  if (scenario === "target") {
    const stretch = stretchOf(plans, year);
    if (stretch) return stretch;
  }
  const baselines = plans.filter((p) => p.scenario !== "target");
  return baselines.find((p) => p.isDefault && p.year === year) ?? baselines.find((p) => p.isDefault) ?? baselines[0];
}

/** The stretch ("Would like") plan of a year, if one was generated. */
export function stretchOf(plans: PlanVersion[], year: number): PlanVersion | undefined {
  return plans.find((p) => p.scenario === "target" && p.year === year);
}

const choiceKey = (clientId: string) => `apex.scenario.${clientId}`;

function browserStorage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

/** The scenario Home was last set to for a client; baseline when nothing usable is stored. */
export function readScenarioChoice(clientId: string, storage: Pick<Storage, "getItem"> | undefined = browserStorage()): PlanScenario {
  try {
    return storage?.getItem(choiceKey(clientId)) === "target" ? "target" : "baseline";
  } catch {
    return "baseline";
  }
}

export function writeScenarioChoice(clientId: string, scenario: PlanScenario, storage: Pick<Storage, "setItem"> | undefined = browserStorage()): void {
  try {
    storage?.setItem(choiceKey(clientId), scenario);
  } catch {
    // Blocked or full storage: the choice just is not remembered.
  }
}

/** Name of the stretch plan generated from a baseline; the suffix is never stacked. */
export function stretchName(baselineName: string): string {
  return baselineName.endsWith(" (stretch)") ? baselineName : `${baselineName} (stretch)`;
}
