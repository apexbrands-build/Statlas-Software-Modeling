/** Series for the Calendar Report's line chart: one per ticked Graph item, each with its own scale. */
import type { Format } from "../format";
import type { CalendarRow } from "./calendar";
import { CALENDAR_SPECS } from "./calendar-specs";

export interface ChartSeries {
  key: string;
  label: string;
  format: Format;
  values: (number | null)[];
  goals: (number | null)[];
  min: number;
  max: number;
}

/** Unknown keys are skipped. min is 0 or lower, and max is always above min, so a flat or empty series cannot divide by zero. */
export function chartSeries(rows: CalendarRow[], keys: string[]): ChartSeries[] {
  const out: ChartSeries[] = [];
  for (const key of keys) {
    const spec = CALENDAR_SPECS.find((s) => s.key === key);
    if (!spec) continue;
    const values = rows.map((r) => r.cells[key]?.actual ?? null);
    const goals = rows.map((r) => r.cells[key]?.goal ?? null);
    const nums = [...values, ...goals].filter((v): v is number => v !== null && Number.isFinite(v));
    const min = Math.min(0, ...nums);
    let max = nums.length ? Math.max(...nums) : 0;
    if (!(max > min)) max = min + 1;
    out.push({ key, label: spec.label, format: spec.format, values, goals, min, max });
  }
  return out;
}

/** Where the solid line ends and the dashed (projected) one starts, for `n` days whose first projected day is `firstProj` (-1 = none). A range wholly in the future is all dashed. */
export function splitProjection(n: number, firstProj: number): { solidTo: number; dashedFrom: number | null } {
  if (firstProj < 0) return { solidTo: n - 1, dashedFrom: null };
  return { solidTo: firstProj - 1, dashedFrom: Math.max(0, firstProj - 1) };
}
