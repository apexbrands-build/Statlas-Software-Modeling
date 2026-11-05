/** What the Calendar Report remembers per browser: columns, graph items and the view toggles. */
import { CALENDAR_PRESETS, CALENDAR_SPECS, type GoalsMode, type PresetId } from "./calendar-specs";

export interface CalendarViewState {
  cols: string[];
  graph: string[];
  heat: boolean;
  deltas: boolean;
  chart: boolean;
  projection: boolean;
  goals: GoalsMode;
}

const ALL = CALENDAR_SPECS.map((s) => s.key);

export const DEFAULT_VIEW: CalendarViewState = { cols: ALL, graph: ["cm", "rev", "spend"], heat: true, deltas: false, chart: true, projection: true, goals: "show" };

export function applyPreset(s: CalendarViewState, id: PresetId): CalendarViewState {
  const p = CALENDAR_PRESETS.find((x) => x.id === id);
  if (!p) return s;
  return { ...s, cols: p.keys ? [...p.keys] : s.cols, goals: p.goals };
}

const known = (v: unknown, fallback: string[]) => {
  if (!Array.isArray(v)) return fallback;
  const keys = v.filter((k): k is string => typeof k === "string" && ALL.includes(k));
  return keys.length ? keys : fallback;
};
const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);

/** The saved state, or null when there is none or it cannot be read. Unknown columns are dropped; missing fields take the defaults. */
export function readViewState(raw: string | null): CalendarViewState | null {
  if (!raw) return null;
  let o: unknown;
  try {
    o = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof o !== "object" || o === null || Array.isArray(o)) return null;
  const r = o as Record<string, unknown>;
  const goals: GoalsMode = r.goals === "only" || r.goals === "hide" ? r.goals : "show";
  return {
    cols: known(r.cols, DEFAULT_VIEW.cols),
    // an empty graph selection is allowed: the chart then says nothing is ticked
    graph: Array.isArray(r.graph) ? r.graph.filter((k): k is string => typeof k === "string" && ALL.includes(k)) : DEFAULT_VIEW.graph,
    heat: bool(r.heat, DEFAULT_VIEW.heat),
    deltas: bool(r.deltas, DEFAULT_VIEW.deltas),
    chart: bool(r.chart, DEFAULT_VIEW.chart),
    projection: bool(r.projection, DEFAULT_VIEW.projection),
    goals,
  };
}
