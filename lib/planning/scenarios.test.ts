import { describe, expect, it } from "vitest";
import type { PlanScenario, PlanVersion } from "../types";
import { pickPlan, readScenarioChoice, readScenarioFields, stretchName, stretchOf, writeScenarioChoice } from "./scenarios";

function plan(id: string, year: number, o: Partial<PlanVersion> = {}): PlanVersion {
  return { id, clientId: "c1", name: id, isDefault: false, year, description: "", seasonality: null, updatedAt: null, updatedBy: null, scenario: "baseline", baseId: null, goal: null, ...o };
}

const A = plan("A", 2026, { isDefault: true });
const B = plan("B", 2026);
const C = plan("C", 2026, { scenario: "target", baseId: "A" });
const D = plan("D", 2025, { isDefault: true });
const plans = [A, B, C, D];

describe("pickPlan", () => {
  it("baseline is the default plan of the year, never a stretch", () => {
    expect(pickPlan(plans, 2026, "baseline")?.id).toBe("A");
    expect(pickPlan([C, B], 2026, "baseline")?.id).toBe("B");
  });

  it("target is the year's stretch plan", () => {
    expect(pickPlan(plans, 2026, "target")?.id).toBe("C");
  });

  it("target falls back to the baseline when the year has no stretch", () => {
    expect(pickPlan(plans, 2025, "target")?.id).toBe("D");
  });

  it("keeps the old fallbacks for a year with no plan: any default, then the first plan", () => {
    expect(pickPlan(plans, 2027, "baseline")?.id).toBe("A");
    expect(pickPlan([B], 2027, "baseline")?.id).toBe("B");
    expect(pickPlan([], 2026, "baseline")).toBeUndefined();
  });
});

describe("stretchOf", () => {
  it("finds the stretch plan of a year only", () => {
    expect(stretchOf(plans, 2026)?.id).toBe("C");
    expect(stretchOf(plans, 2025)).toBeUndefined();
  });
});

function store(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return { data, getItem: (k: string) => data[k] ?? null, setItem: (k: string, v: string) => void (data[k] = v) };
}
const throwing = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };

describe("Home scenario choice", () => {
  it("defaults to baseline when nothing, something unknown or a blocked store is read", () => {
    expect(readScenarioChoice("c1", store())).toBe("baseline");
    expect(readScenarioChoice("c1", store({ "apex.scenario.c1": "optimistic" }))).toBe("baseline");
    expect(readScenarioChoice("c1", throwing)).toBe("baseline");
  });

  it("remembers the choice per client", () => {
    const s = store();
    writeScenarioChoice("c1", "target" as PlanScenario, s);
    expect(readScenarioChoice("c1", s)).toBe("target");
    expect(readScenarioChoice("c2", s)).toBe("baseline");
  });

  it("never throws when the store is blocked", () => {
    expect(() => writeScenarioChoice("c1", "target", throwing)).not.toThrow();
  });
});

describe("readScenarioFields", () => {
  it("defaults a row from before migration 0011 to a baseline plan", () => {
    expect(readScenarioFields({})).toEqual({ scenario: "baseline", baseId: null, goal: null });
  });

  it("reads a stretch plan with its goal and base plan", () => {
    const row = { scenario: "target", base_plan_id: "base-1", goal: { metric: "newRevenueGrowth", value: 20, cmFloor: 1000 } };
    expect(readScenarioFields(row)).toEqual({
      scenario: "target",
      baseId: "base-1",
      goal: { metric: "newRevenueGrowth", value: 20, cmFloor: 1000 },
    });
  });

  it("falls back to baseline for an unknown scenario value", () => {
    expect(readScenarioFields({ scenario: "optimistic" }).scenario).toBe("baseline");
  });

  it("drops a malformed goal instead of passing it on", () => {
    expect(readScenarioFields({ goal: "20%" }).goal).toBeNull();
    expect(readScenarioFields({ goal: { metric: "profit", value: 5 } }).goal).toBeNull();
    expect(readScenarioFields({ goal: { metric: "totalRevenue", value: Number.NaN } }).goal).toBeNull();
  });
});

describe("stretchName", () => {
  it("adds the suffix once", () => {
    expect(stretchName("2026 Plan")).toBe("2026 Plan (stretch)");
    expect(stretchName("2026 Plan (stretch)")).toBe("2026 Plan (stretch)");
  });
});
