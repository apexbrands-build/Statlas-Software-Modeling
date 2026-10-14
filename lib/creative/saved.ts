/** What the Ad plan saves in the plan's `creative` model record (`plan_models`): the score snapshot and each month's block. */
import type { CreativeMonth } from "./plan";
import type { creativeScore, MetricKey } from "./score";

export interface SavedAdPlan {
  asOf: string;
  score: number | null;
  parts: Record<MetricKey, number | null> | null;
  mode: "provisional" | "percentile" | null;
  metrics: Record<MetricKey, number | null> | null;
  /** Keyed by the plan month (YYYY-MM-01). */
  months: Record<string, CreativeMonth>;
}

export function adPlanResults(a: { asOf: string; score: ReturnType<typeof creativeScore> | null; metrics: Record<MetricKey, number | null> | null; months: Record<string, CreativeMonth> }): SavedAdPlan {
  return { asOf: a.asOf, score: a.score?.score ?? null, parts: a.score?.parts ?? null, mode: a.score?.mode ?? null, metrics: a.metrics, months: a.months };
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The saved blocks, ignoring anything that is not a usable block (older results, damaged entries); a missing lock flag or overrides is filled in. */
export function readSavedBlocks(results: unknown): Record<string, CreativeMonth> {
  if (!isObject(results) || !isObject(results.months)) return {};
  const out: Record<string, CreativeMonth> = {};
  for (const [month, raw] of Object.entries(results.months)) {
    if (!isObject(raw)) continue;
    if (typeof raw.needed !== "number" || typeof raw.evergreen !== "number" || typeof raw.moments !== "number") continue;
    if (!isObject(raw.basis) || !isObject(raw.split)) continue;
    out[month] = { ...(raw as unknown as CreativeMonth), overrides: isObject(raw.overrides) ? (raw.overrides as CreativeMonth["overrides"]) : {}, locked: raw.locked === true };
  }
  return out;
}
