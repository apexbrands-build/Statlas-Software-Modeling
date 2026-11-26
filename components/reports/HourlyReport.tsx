"use client";

import { useMemo, useState } from "react";
import { CalendarChart, type ChartCopy } from "./CalendarChart";
import { HourlyTable } from "./HourlyTable";
import { Empty, Loading, ReportFrame, selectClass } from "./ReportFrame";
import { useMinute, useStoredView } from "./use-stored-view";
import { useApp } from "@/lib/app-context";
import { addDays } from "@/lib/dates";
import { mixOf } from "@/lib/planning/mix";
import { roasOf } from "@/lib/planning/roas";
import { readScenarioChoice, writeScenarioChoice } from "@/lib/planning/scenarios";
import { chartSeries } from "@/lib/reports/calendar-chart";
import { buildHourly, COMPARE_MODES, compareDates, compareLabel, dayListing, eventMarkers, hhmm, hourlyCsv, lastOrderClock, launchMarkers, sendsOn, storeClock, summarise, toChartRows, type CompareMode } from "@/lib/reports/hourly";
import { useHourlyData } from "@/lib/reports/hourly-data";
import { pickShape, shapeCandidates, type ShapeChoice } from "@/lib/reports/hourly-shape";
import { HOURLY_BLOCKS, HOURLY_SPECS } from "@/lib/reports/hourly-specs";
import { readHourlyView, resolveCompare, toggleColumn, type HourlyViewState } from "@/lib/reports/hourly-view";
import type { PlanScenario } from "@/lib/types";

const btn = "rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-text-muted hover:text-text disabled:opacity-40";
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const CHARTABLE = HOURLY_SPECS.filter((s) => !s.noHourly);

const CHART_COPY: ChartCopy = {
  goal: "Expected (first item)",
  goalShort: "Expected",
  empty: "Tick at least one item under Chart to draw it.",
  aria: "Line chart of the ticked columns by hour, with the sends, events and ad launches marked below on their hour",
  note: "Each line is drawn on its own scale; hover an hour for the real values. Dashed = hours to come, drawn at what is expected. An hour that is still open is left out of the line.",
};

function download(name: string, head: string[], rows: (string | number | null)[][]) {
  const esc = (v: string | number | null) => (v === null ? "" : typeof v === "number" ? String(Math.round(v * 100) / 100) : `"${v.replace(/"/g, '""')}"`);
  const url = URL.createObjectURL(new Blob([[head.map(esc).join(","), ...rows.map((r) => r.map(esc).join(","))].join("\n")], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/** One day by the hour of the store's own clock, against what was expected: the Calendar Report by hour. Numbers come from `buildHourly`. */
export function HourlyReport() {
  const { client } = useApp();
  // A new store starts from its own today.
  return <HourlyPage key={client?.id ?? "none"} />;
}

function HourlyPage() {
  const { client, settings } = useApp();
  const minute = useMinute();
  const clock = useMemo(() => (client && minute !== null ? storeClock(new Date(minute * 60_000), client.timezone) : null), [client, minute]);
  const [pickedDay, setPickedDay] = useState<string | null>(null);
  const day = pickedDay ?? clock?.date ?? null;
  const isToday = Boolean(day && clock && day === clock.date);

  // The plan the targets come from: the choice made on Home (the Calendar Report and the trackers follow it too).
  const [picked, setPicked] = useState<PlanScenario | null>(null);
  const scenario: PlanScenario = client ? (picked ?? readScenarioChoice(client.id)) : "baseline";
  const chooseScenario = (s: PlanScenario) => {
    if (!client) return;
    setPicked(s);
    writeScenarioChoice(client.id, s);
  };

  const [view, setView] = useStoredView<HourlyViewState>(client ? `apex.hourly.${client.id}` : null, readHourlyView);
  const set = (patch: Partial<HourlyViewState>) => setView({ ...view, ...patch });

  // Today's orders load about once an hour: re-read the day every five minutes while it is on screen.
  const loaded = useHourlyData(client, settings, day, scenario, isToday && minute !== null ? Math.floor(minute / 5) : 0);
  const data = loaded?.data ?? null;

  const built = useMemo(() => {
    if (!client || !settings || !clock || !day || !data || !data.ready) return null;
    const hoursOf = (d: string) => data.hours.get(d) ?? [];
    const revenueOf = (d: string) => {
      const hs = hoursOf(d);
      if (!hs.length) return null;
      const out = Array.from({ length: 24 }, () => 0);
      for (const h of hs) out[h.hour] += h.orderRevenue;
      return out;
    };
    const candidates = shapeCandidates(day, data.events);
    const shape = pickShape(candidates, revenueOf, view.shape);
    const mode = resolveCompare(view.compare, data.plan !== null);
    const refDates = compareDates(mode, day);
    const used = refDates.filter((d) => hoursOf(d).some((h) => h.orders > 0));
    const label = compareLabel(mode, day, used);
    const last = isToday ? lastOrderClock(hoursOf(day), day, client.timezone) : null;
    const result = buildHourly({
      clientId: client.id,
      day,
      clock,
      asOf: last,
      hours: hoursOf(day),
      specs: HOURLY_SPECS,
      settings,
      compare: mode,
      plan: data.plan,
      roasOf: data.roas ? roasOf(data.roas) : null,
      mixOf: data.mix ? mixOf(data.mix) : null,
      shares: shape.shares,
      reference: refDates.map(hoursOf),
      cumulative: view.cumulative,
      markers: [...eventMarkers(data.events, day), ...launchMarkers(data.launches, day)],
    });
    const summary = summarise({ result, clock, sends: sendsOn(data.events, day), compare: mode, compareLabel: label, currency: client.currency });
    return { candidates, shape, mode, label, used, last, result, summary, listing: dayListing(data.events, day), chartRows: toChartRows(day, result.rows) };
  }, [client, settings, clock, day, data, view.shape, view.compare, view.cumulative, isToday]);

  const shown = useMemo(() => HOURLY_SPECS.filter((s) => view.cols.includes(s.key)), [view.cols]);
  const series = useMemo(() => (built ? chartSeries(built.chartRows, view.graph, HOURLY_SPECS) : []), [built, view.graph]);
  const shapeValue: ShapeChoice = built && built.candidates.some((c) => c.kind === view.shape) ? view.shape : "auto";
  const hasPlan = data?.plan != null;

  const downloadCsv = () => {
    if (!built || !day || !client) return;
    const csv = hourlyCsv(built.result, shown);
    download(`hourly-${client.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${day}${view.cumulative ? "-cumulative" : ""}`, csv.head, csv.rows);
  };

  const controls = (
    <>
      {data?.hasStretch && (
        <label className="flex items-center gap-2 text-sm text-text-muted" title="The plan the targets come from. The same choice as on Home, in the Calendar Report and in the trackers.">
          Goals
          <select aria-label="Plan the targets come from" className={selectClass} value={data.planScenario} onChange={(e) => chooseScenario(e.target.value as PlanScenario)}>
            <option value="baseline">Baseline</option>
            <option value="target">Stretch</option>
          </select>
        </label>
      )}
      <div className="flex items-center gap-1" role="group" aria-label="Day">
        <button className={btn} aria-label="Previous day" disabled={!day} onClick={() => day && setPickedDay(addDays(day, -1))}>
          ‹
        </button>
        <input type="date" aria-label="Day" className={selectClass} value={day ?? ""} onChange={(e) => e.target.value && setPickedDay(e.target.value)} />
        <button className={btn} aria-label="Next day" disabled={!day} onClick={() => day && setPickedDay(addDays(day, 1))}>
          ›
        </button>
        {!isToday && clock && (
          <button className={btn} onClick={() => setPickedDay(null)}>
            Today
          </button>
        )}
      </div>
      <label className="flex items-center gap-2 text-sm text-text-muted">
        Compare with
        <select aria-label="Compare with" className={selectClass} value={built?.mode ?? resolveCompare(view.compare, hasPlan)} onChange={(e) => set({ compare: e.target.value as CompareMode })}>
          {COMPARE_MODES.map((m) => (
            <option key={m.id} value={m.id} disabled={m.id === "plan" && data !== null && !hasPlan}>
              {m.id === "plan" && data !== null && !hasPlan ? "The plan (no target for this day)" : m.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-2 text-sm text-text-muted" title={built && built.mode !== "plan" ? "The shape spreads the plan's day target over the hours. The other comparisons use the reference day's own hours." : "How the day's target is spread over the hours."}>
        Shape
        <select aria-label="Shape of the day" className={selectClass} value={shapeValue} disabled={!built || built.mode !== "plan"} onChange={(e) => set({ shape: e.target.value as ShapeChoice })}>
          <option value="auto">Automatic</option>
          {(built?.candidates ?? []).map((c) => (
            <option key={c.kind} value={c.kind}>
              {capital(c.label)}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-2 text-sm text-text-muted" title="Turns every column into a running total from midnight; ratios are worked out on the running sums.">
        <input type="checkbox" checked={view.cumulative} onChange={(e) => set({ cumulative: e.target.checked })} /> Cumulative
      </label>
      <details className="relative">
        <summary className={`${selectClass} cursor-pointer list-none`}>
          Columns: {view.cols.length}/{HOURLY_SPECS.length}
        </summary>
        <div className="absolute right-0 z-30 mt-1 max-h-96 w-72 overflow-auto rounded-lg border border-border bg-surface-raised p-2 text-sm">
          {HOURLY_BLOCKS.map((b) => (
            <div key={b.id} className="mb-1">
              <div className="px-2 pt-1 text-[10px] uppercase tracking-wide text-text-faint">{b.label}</div>
              {HOURLY_SPECS.filter((s) => s.block === b.id).map((s) => (
                <label key={s.key} className="flex items-center gap-2 px-2 py-1">
                  <input type="checkbox" checked={view.cols.includes(s.key)} onChange={() => set({ cols: toggleColumn(view.cols, s.key) })} />
                  <span>{s.label}</span>
                  {s.noHourly && <span className="ml-auto whitespace-nowrap text-[10px] text-text-faint">expected only</span>}
                </label>
              ))}
            </div>
          ))}
        </div>
      </details>
      <details className="relative">
        <summary className={`${selectClass} cursor-pointer list-none`}>Chart: {view.graph.length === 0 ? "Off" : `${CHARTABLE.find((s) => s.key === view.graph[0])?.label ?? ""}${view.graph.length > 1 ? ` +${view.graph.length - 1}` : ""}`}</summary>
        <div className="absolute right-0 z-30 mt-1 w-56 rounded-lg border border-border bg-surface-raised p-2 text-sm">
          {CHARTABLE.map((s) => (
            <label key={s.key} className="flex items-center gap-2 px-2 py-1">
              <input type="checkbox" checked={view.graph.includes(s.key)} onChange={() => set({ graph: view.graph.includes(s.key) ? view.graph.filter((k) => k !== s.key) : [...view.graph, s.key] })} />
              {s.label}
            </label>
          ))}
        </div>
      </details>
      <button className={btn} disabled={!built || !day || !client} onClick={downloadCsv}>
        Download CSV
      </button>
    </>
  );

  let body: React.ReactNode;
  if (!client || !clock || !day || !loaded) body = <Loading />;
  else if (loaded.error) body = <Empty>The numbers for this day could not be loaded ({loaded.error}). Try again in a moment.</Empty>;
  else if (data && !data.ready)
    body = (
      <Empty>
        The Hourly Report needs a database update that has not been applied yet (migration 0023, the file <code>supabase/migrations/0023_hourly_report.sql</code>). Once it is applied this page fills in by itself; nothing else has to be set up.
      </Empty>
    );
  else if (!built) body = <Loading />;
  else {
    const { result, summary, shape, mode, label, used, last, listing } = built;
    const wantsPlan = view.compare === "auto" || view.compare === "plan";
    const planB = summary.planB ? summary.lines[summary.lines.length - 1] : null;
    const status = planB ? summary.lines.slice(0, -1) : summary.lines;
    const expectedOnly = shown.filter((s) => s.noHourly);
    body = (
      <div className="space-y-4">
        <section className="space-y-2 rounded-xl border border-border bg-surface p-4" aria-label="Where the day stands">
          {status.map((line, i) => (
            <p key={line} className={i === 0 ? "text-base font-medium" : "text-sm text-text-muted"}>
              {line}
            </p>
          ))}
          {planB && <p className="rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-sm">{planB}</p>}
          {summary.readingLines.length > 0 && (
            <div className="border-t border-border/60 pt-2 text-sm text-text-muted">
              <p className="text-[11px] uppercase tracking-wide text-text-faint">What each send did</p>
              <ul className="mt-1 space-y-0.5">
                {summary.readingLines.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              <p className="mt-1 text-[11px] text-text-faint">Each send is read over the three hours from its send time, against what those hours were expected to bring. It is a reading against the day&apos;s shape, not an incrementality test.</p>
            </div>
          )}
          {(listing.events.length > 0 || listing.untimed.length > 0) && (
            <div className="border-t border-border/60 pt-2 text-sm text-text-muted">
              <p className="text-[11px] uppercase tracking-wide text-text-faint">On the calendar this day, with no hour on the grid</p>
              <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5">
                {listing.events.map((e) => (
                  <li key={`${e.type}|${e.name}`}>{e.name === e.type ? e.name : `${e.type}: ${e.name}`}</li>
                ))}
                {listing.untimed.map((s) => (
                  <li key={`${s.type}|${s.name}`}>
                    {s.type === "email" ? "Email" : "SMS"} &ldquo;{s.name}&rdquo; <span className="text-text-faint">(time not set: add it in the Calendar to put this send on its hour)</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <p className="text-xs text-text-muted">
          {mode === "plan"
            ? `Expected = the day's target in plan “${data?.planName ?? ""}” × each hour's share of the day. The day is shaped like ${shape.label}${shape.fellBack ? `, because ${shape.kind === "even" ? "there are no orders to read a shape from" : `the first choice (${built.candidates[0].label}) has no orders`}` : ""}. A ratio (AOV) keeps the day's target on every hour.`
            : `${wantsPlan ? "There is no plan target for this day, so the hours are compared with " : "Compared with "}${label}: each hour against the same hour there.${used.length === 0 ? " That reference has no orders, so there is nothing to compare with." : ""}`}
          {isToday && ` ${last ? `Last order loaded at ${hhmm(last)}.` : "No order is loaded for today yet."} Today's orders load about once an hour, so the latest hours can still fill in: they are marked “open” and are not judged.`}
        </p>

        {view.graph.length > 0 && (
          <section className="rounded-xl border border-border bg-surface p-4" aria-label="Chart">
            <CalendarChart rows={built.chartRows} series={series} currency={client.currency} tick={(r, i) => (i % 3 === 0 || i === 23 ? r.label : null)} copy={CHART_COPY} />
          </section>
        )}

        <HourlyTable result={result} specs={shown} currency={client.currency} cumulative={view.cumulative} />

        {expectedOnly.length > 0 && (
          <p className="text-xs text-text-faint">
            {expectedOnly.map((s) => s.label).join(", ")}: these have no hourly numbers yet, so the grid shows what is expected for each hour and no actual. Ad spend by hour and email and SMS revenue by hour are the next steps of this report.
          </p>
        )}
      </div>
    );
  }

  return (
    <ReportFrame slug="hourly" range={null} controls={controls}>
      {body}
    </ReportFrame>
  );
}
