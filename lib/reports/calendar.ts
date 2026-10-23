/** Rows of the Calendar Report: one per day with each column's actual, goal, tone and gap, plus the TOTAL row. */
import type { DashData } from "../dashboard-data";
import { aggregate, aggregatePlan, compare, type Tone } from "../metrics";
import { actionsByDay, type MarketingAction } from "./calendar-actions";
import type { MetricSpec } from "./metric-spec";

export interface CalendarCell {
  actual: number | null;
  goal: number | null;
  tone: Tone;
  /** (actual - goal) / |goal|; null when either is missing. */
  diff: number | null;
}

export interface CalendarRow {
  date: string;
  label: string;
  /** After the last day with data: the cell shows the plan's goal as the projection. */
  projected: boolean;
  actions: MarketingAction[];
  cells: Record<string, CalendarCell>;
}

type Data = Pick<DashData, "facts" | "plan" | "dates" | "effTo" | "settings" | "hasPlan" | "roasOf" | "mixOf">;

const dayLabel = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

/**
 * Days up to `effTo` with data show actuals against the day's plan goal (the Home tone rule); an elapsed day without data has a null actual;
 * later days are projected. The total covers the days that have data, its ratios come from the summed totals, and its goal covers the same days.
 */
export function buildCalendarRows(a: { data: Data; specs: MetricSpec[]; actions: MarketingAction[]; showProjection: boolean }): { rows: CalendarRow[]; total: CalendarRow } {
  const { data, specs } = a;
  const byDay = actionsByDay(a.actions);
  const planOf = (d: string) => (data.hasPlan ? data.plan.get(d) : undefined);
  const planTotals = (days: string[]) => aggregatePlan(days.map(planOf).filter((p): p is NonNullable<typeof p> => Boolean(p)), data.roasOf ?? undefined, data.mixOf ?? undefined);

  const rows: CalendarRow[] = [];
  for (const date of data.dates) {
    const projected = date > data.effTo;
    if (projected && !a.showProjection) continue;
    const fact = data.facts.get(date);
    const plan = planOf(date);
    const tot = fact && !projected ? aggregate([fact]) : null;
    const pt = plan ? planTotals([date]) : null;
    const cells: Record<string, CalendarCell> = {};
    for (const s of specs) {
      const goal = pt && s.goal ? s.goal(pt, data.settings) : null;
      if (projected) {
        cells[s.key] = { actual: goal, goal, tone: "neutral", diff: null };
        continue;
      }
      const actual = tot ? s.value(tot, data.settings) : null;
      const c = compare(actual, goal, s.direction);
      cells[s.key] = { actual, goal, tone: c.tone, diff: c.diff };
    }
    rows.push({ date, label: dayLabel(date), projected, actions: byDay.get(date) ?? [], cells });
  }

  const withData = data.dates.filter((d) => d <= data.effTo && data.facts.has(d));
  const tot = aggregate(withData.map((d) => data.facts.get(d)!));
  const pt = data.hasPlan ? planTotals(withData) : null;
  const cells: Record<string, CalendarCell> = {};
  for (const s of specs) {
    const actual = withData.length ? s.value(tot, data.settings) : null;
    const goal = pt && pt.days > 0 && s.goal ? s.goal(pt, data.settings) : null;
    const c = compare(actual, goal, s.direction);
    cells[s.key] = { actual, goal, tone: c.tone, diff: c.diff };
  }
  return { rows, total: { date: "total", label: "TOTAL", projected: false, actions: [], cells } };
}
