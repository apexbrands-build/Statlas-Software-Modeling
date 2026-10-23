"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarTable } from "./CalendarTable";
import { Empty, Loading, ReportFrame, selectClass, useReportRange } from "./ReportFrame";
import { useApp } from "@/lib/app-context";
import { useDashboardData } from "@/lib/dashboard-data";
import { buildCalendarRows } from "@/lib/reports/calendar";
import { eventActions, metaLaunchActions, type MarketingAction } from "@/lib/reports/calendar-actions";
import { CALENDAR_PRESETS, CALENDAR_SPECS } from "@/lib/reports/calendar-specs";
import { applyPreset, DEFAULT_VIEW, readViewState, type CalendarViewState } from "@/lib/reports/calendar-view";
import { getRepository } from "@/lib/repository";

const btn = "rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-text-muted hover:text-text";
const toggleClass = (on: boolean) => `rounded-lg border px-3 py-1.5 text-sm ${on ? "border-accent bg-accent/10 text-text" : "border-border bg-surface text-text-muted hover:text-text"}`;

/** Day-by-day metrics against plan goals, with the marketing actions of each day (events, Meta launches, later email and SMS). */
export function CalendarReport() {
  const { client, settings } = useApp();
  const { range, setRange } = useReportRange();
  const data = useDashboardData(client, settings, range, null);
  const [state, setState] = useState<CalendarViewState>(DEFAULT_VIEW);
  const [restored, setRestored] = useState<string | null>(null);
  const [actions, setActions] = useState<MarketingAction[]>([]);
  const [presets, setPresets] = useState(false);

  const storeKey = client ? `apex.calendar.${client.id}` : null;

  // Remembered per browser and client; storage can be blocked, so every access is guarded.
  useEffect(() => {
    if (!storeKey || restored === storeKey) return;
    let saved: CalendarViewState | null = null;
    try {
      saved = readViewState(window.localStorage.getItem(storeKey));
    } catch {
      saved = null;
    }
    setState(saved ?? DEFAULT_VIEW);
    setRestored(storeKey);
  }, [storeKey, restored]);
  useEffect(() => {
    if (!storeKey || restored !== storeKey) return;
    try {
      window.localStorage.setItem(storeKey, JSON.stringify(state));
    } catch {
      /* the view still works without being remembered */
    }
  }, [state, storeKey, restored]);

  useEffect(() => {
    if (!client || !range) return;
    let cancel = false;
    const repo = getRepository();
    Promise.all([repo.listEvents(client.id).catch(() => []), repo.getMetaLaunches(client.id, range).catch(() => undefined)]).then(([events, launches]) => {
      if (cancel) return;
      setActions([...eventActions(events, range), ...metaLaunchActions(launches ?? [])]);
    });
    return () => {
      cancel = true;
    };
  }, [client, range]);

  const shown = useMemo(() => CALENDAR_SPECS.filter((s) => state.cols.includes(s.key)), [state.cols]);
  const built = useMemo(() => {
    if (!data) return null;
    return buildCalendarRows({ data, specs: shown, actions, showProjection: state.projection });
  }, [data, shown, actions, state.projection]);

  // Without a plan there is nothing to compare with: goal columns, deltas and heat go away rather than showing dashes.
  const view: CalendarViewState = data && !data.hasPlan ? { ...state, goals: "hide", heat: false, deltas: false } : state;
  const set = (patch: Partial<CalendarViewState>) => setState((s) => ({ ...s, ...patch }));
  const hasActuals = Boolean(built && built.rows.some((r) => !r.projected && Object.values(r.cells).some((c) => c.actual !== null)));

  return (
    <ReportFrame
      slug="calendar"
      range={range}
      setRange={setRange}
      controls={
        <>
          <button className={btn} onClick={() => setPresets(true)}>
            Presets
          </button>
          <details className="relative">
            <summary className={`${selectClass} cursor-pointer list-none`}>Columns: {state.cols.length === CALENDAR_SPECS.length ? "All" : `${state.cols.length}/${CALENDAR_SPECS.length}`}</summary>
            <div className="absolute right-0 z-30 mt-1 max-h-80 w-64 overflow-auto rounded-lg border border-border bg-surface-raised p-2 text-sm">
              {CALENDAR_SPECS.map((s) => (
                <label key={s.key} className="flex items-center gap-2 px-2 py-1">
                  <input type="checkbox" checked={state.cols.includes(s.key)} onChange={() => set({ cols: state.cols.includes(s.key) ? state.cols.filter((k) => k !== s.key) : CALENDAR_SPECS.filter((x) => x.key === s.key || state.cols.includes(x.key)).map((x) => x.key) })} />
                  {s.label}
                </label>
              ))}
            </div>
          </details>
          <label className="flex items-center gap-2 text-sm text-text-muted">
            <input type="checkbox" checked={state.projection} onChange={(e) => set({ projection: e.target.checked })} /> Projection
          </label>
          <button className={toggleClass(state.heat)} aria-pressed={state.heat} onClick={() => set({ heat: !state.heat })}>
            HeatMap
          </button>
          <button className={toggleClass(state.deltas)} aria-pressed={state.deltas} onClick={() => set({ deltas: !state.deltas })}>
            Deltas
          </button>
        </>
      }
    >
      {!built || !client ? (
        <Loading />
      ) : !hasActuals && built.rows.every((r) => !r.projected) ? (
        <Empty>No actual data in this range{data ? ` (data runs through ${data.lastData})` : ""}. Pick an earlier period.</Empty>
      ) : (
        <>
          <p className="text-xs text-text-muted">{data?.hasPlan ? `Goals from plan “${data.planName}”, counted for the days with data only. Future days show the plan as the projection.` : "No plan for this client: showing actuals only."}</p>
          <CalendarTable rows={built.rows} total={built.total} specs={shown} state={view} currency={client.currency} />
        </>
      )}

      {presets && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setPresets(false)}>
          <div role="dialog" aria-modal="true" aria-label="Select preset" className="w-full max-w-lg space-y-2 rounded-2xl border border-border bg-surface-raised p-5" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-sm font-semibold">Select Preset</h2>
            {CALENDAR_PRESETS.map((p) => (
              <div key={p.id} className="grid grid-cols-[150px_1fr] items-center gap-3 text-xs text-text-muted">
                <button
                  className="rounded-lg border border-border bg-surface px-3 py-1.5 text-left text-sm text-text hover:border-accent"
                  onClick={() => {
                    setState((s) => applyPreset(s, p.id));
                    setPresets(false);
                  }}
                >
                  {p.label}
                </button>
                <span>{p.description}</span>
              </div>
            ))}
            <div className="text-right">
              <button className={btn} onClick={() => setPresets(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </ReportFrame>
  );
}
