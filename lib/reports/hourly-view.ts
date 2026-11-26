/** What the Hourly Report remembers per browser and store: the columns, the charted columns, the comparison, the shape and the cumulative switch. The day is not remembered: the page opens on the store's today. */
import type { CompareMode } from "./hourly";
import { SHAPE_KINDS, type ShapeChoice } from "./hourly-shape";
import { DEFAULT_HOURLY_COLS, HOURLY_SPECS } from "./hourly-specs";

export interface HourlyViewState {
  cols: string[];
  /** Columns drawn in the chart (only ones with hourly actuals); empty hides the chart. */
  graph: string[];
  /** "auto" = the plan when the day has a target, else the last four same weekdays. */
  compare: "auto" | CompareMode;
  shape: ShapeChoice;
  cumulative: boolean;
}

export const DEFAULT_HOURLY_VIEW: HourlyViewState = { cols: DEFAULT_HOURLY_COLS, graph: ["rev"], compare: "auto", shape: "auto", cumulative: false };

const MODES: CompareMode[] = ["plan", "lastWeek", "fourWeeks", "lastYear"];
const ordered = (keys: unknown[], allowed: (key: string) => boolean) => HOURLY_SPECS.filter((s) => keys.includes(s.key) && allowed(s.key)).map((s) => s.key);
const chartable = (key: string) => HOURLY_SPECS.some((s) => s.key === key && !s.noHourly);

/** The saved view, or the defaults for whatever is missing or cannot be read. Unknown columns are dropped. */
export function readHourlyView(raw: string | null): HourlyViewState {
  if (!raw) return DEFAULT_HOURLY_VIEW;
  let o: unknown;
  try {
    o = JSON.parse(raw);
  } catch {
    return DEFAULT_HOURLY_VIEW;
  }
  if (typeof o !== "object" || o === null || Array.isArray(o)) return DEFAULT_HOURLY_VIEW;
  const r = o as Record<string, unknown>;
  const cols = Array.isArray(r.cols) ? ordered(r.cols, () => true) : [];
  return {
    cols: cols.length ? cols : DEFAULT_HOURLY_VIEW.cols,
    graph: Array.isArray(r.graph) ? ordered(r.graph, chartable) : DEFAULT_HOURLY_VIEW.graph,
    compare: MODES.includes(r.compare as CompareMode) ? (r.compare as CompareMode) : "auto",
    shape: SHAPE_KINDS.includes(r.shape as (typeof SHAPE_KINDS)[number]) ? (r.shape as ShapeChoice) : "auto",
    cumulative: typeof r.cumulative === "boolean" ? r.cumulative : DEFAULT_HOURLY_VIEW.cumulative,
  };
}

/** The comparison in force: the plan needs a target for the day; without one the last four same weekdays stand in. */
export function resolveCompare(choice: HourlyViewState["compare"], hasPlan: boolean): CompareMode {
  if (choice === "auto" || choice === "plan") return hasPlan ? "plan" : "fourWeeks";
  return choice;
}

/** A column ticked or unticked, in the report's own column order. */
export function toggleColumn(cols: string[], key: string): string[] {
  const next = cols.includes(key) ? cols.filter((k) => k !== key) : [...cols, key];
  return HOURLY_SPECS.filter((s) => next.includes(s.key)).map((s) => s.key);
}
