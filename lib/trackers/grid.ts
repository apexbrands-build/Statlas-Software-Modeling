import { compare } from "../metrics";
import type { TrackerCell } from "./spend-tracker";

/** The two facts every block of the tracker's grid is read by: is it above or below its reference, and how much of its target has it spent so far. */

export type Standing = "above" | "below" | "on" | null;

/** Above or below a reference by more than 10% (the app's neutral band), or on it. Null when it cannot be read. */
export function standing(value: number | null, ref: number | null): Standing {
  const c = compare(value, ref, "up");
  if (c.diff === null) return null;
  return c.tone === "good" ? "above" : c.tone === "bad" ? "below" : "on";
}

/** What a block spent, and what it should have spent, on the days that have data. */
export function soFar(cells: TrackerCell[]): { actual: number; target: number | null; pace: number | null } {
  let actual = 0;
  let target: number | null = null;
  for (const c of cells) {
    if (c.actual === null) continue;
    actual += c.actual;
    if (c.target !== null) target = (target ?? 0) + c.target;
  }
  return { actual, target, pace: target !== null && target > 0 ? actual / target : null };
}
