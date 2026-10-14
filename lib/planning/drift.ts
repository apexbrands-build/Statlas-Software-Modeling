import type { PlanTargetDay } from "../types";

const FIELDS = ["spend", "newRevenue", "returningRevenue", "orderRevenue", "cm"] as const;

/** A day differs when a figure moved by more than 1 currency unit and more than `tolerance` of the saved figure (rounding and a refreshed event measurement stay below). */
const moved = (generated: number, saved: number, tolerance: number) => Math.abs(generated - saved) > Math.max(1, tolerance * Math.abs(saved));

/**
 * Months (YYYY-MM, in order) whose saved daily targets no longer match what the editor generates today from the same plan inputs:
 * events added on the Calendar page, changed cost settings or aMER exclusions, or a month never saved. Home and the reports read the
 * saved targets, so these months need a new Save plan.
 */
export function driftedMonths(saved: PlanTargetDay[], generated: Record<string, PlanTargetDay[]>, tolerance = 0.02): string[] {
  const byDate = new Map(saved.map((r) => [r.date, r]));
  return Object.keys(generated)
    .sort()
    .filter((month) =>
      generated[month].some((g) => {
        const s = byDate.get(g.date);
        return !s || FIELDS.some((f) => moved(g[f], s[f], tolerance));
      }),
    );
}
