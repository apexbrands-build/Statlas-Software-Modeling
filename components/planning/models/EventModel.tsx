"use client";

import { useMemo, useState } from "react";
import { allCategoryStats, dayMultipliers, eventDays, liftsFor, STANCE_LABELS, TYPE_LABEL, typeGroup, type CategoryStats, type EventDayResult, type Lifts, type MarketingEvent, type Stance } from "@/lib/planning/events";
import type { PlanCtx } from "../ctx";
import { btn, inputClass, NumField } from "../ui";

const pct = (x: number | undefined, digits = 0) => (x === undefined || !Number.isFinite(x) ? "–" : `${x >= 1 ? "+" : ""}${((x - 1) * 100).toFixed(digits)}%`);
const tone = (x: number) => (x > 1.05 ? "text-good" : x < 0.95 ? "text-bad" : "text-text-muted");

function Panel({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <h3 className="text-sm font-semibold">{title}</h3>
      {sub && <p className="mb-3 mt-0.5 max-w-4xl text-xs text-text-muted">{sub}</p>}
      {children}
    </div>
  );
}

/** Average lifts per past event (one row per event, all its days). */
function perEvent(results: EventDayResult[]) {
  const m = new Map<string, EventDayResult[]>();
  for (const r of results) m.set(r.eventId, [...(m.get(r.eventId) ?? []), r]);
  return [...m.entries()].map(([id, rs]) => {
    const avg = (k: keyof Lifts) => rs.reduce((a, r) => a + r.lifts[k], 0) / rs.length;
    return { id, name: rs[0].name, type: rs[0].type, from: rs[0].date, to: rs[rs.length - 1].date, days: rs.length, lifts: { spend: avg("spend"), newRevenue: avg("newRevenue"), returning: avg("returning"), amer: avg("amer") } as Lifts };
  });
}

export function EventModel({ ctx }: { ctx: PlanCtx }) {
  const { plan, events, eventResults, eventSettings: S, setEventSettings, history } = ctx;
  const [open, setOpen] = useState<string | null>(null);
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const stats = useMemo(() => allCategoryStats(eventResults), [eventResults]);
  const pastEvents = useMemo(() => perEvent(eventResults), [eventResults]);

  const lastData = history.lastData;
  const future = events.filter((e) => e.endDate > lastData && e.date <= `${plan.year}-12-31` && typeGroup(e.type) !== "initiative");
  const initiatives = events.filter((e) => typeGroup(e.type) === "initiative").length;
  const mult = useMemo(() => dayMultipliers(future, S, eventResults), [future, S, eventResults]);

  const setItem = (id: string, patch: Partial<NonNullable<(typeof S.perEvent)[string]>>) =>
    setEventSettings({ ...S, perEvent: { ...S.perEvent, [id]: { ...(S.perEvent[id] ?? { stance: S.stance }), ...patch } } });
  const setOverride = (e: MarketingEvent, key: keyof Lifts, v: number | null) => {
    const cur = S.perEvent[e.id]?.override ?? {};
    const next = { ...cur };
    if (v === null) delete next[key];
    else next[key] = 1 + v / 100;
    setItem(e.id, { override: Object.keys(next).length ? next : undefined });
  };

  const th = "px-2 py-1.5 text-right font-medium";
  const td = "px-2 py-1 text-right tabular";
  const row = (s: CategoryStats, label: string) => (
    <tr key={s.type} className="border-b border-border/50">
      <td className="px-2 py-1 text-left">
        {label}
        {s.lowConfidence && s.type !== "all" && <span className="ml-1 rounded bg-bad/15 px-1 text-[10px] text-bad">few events</span>}
      </td>
      <td className={td}>{s.events}</td>
      <td className={td}>{s.n}</td>
      <td className={`${td} ${tone(s.spend.median)}`}>{pct(s.spend.median)}</td>
      <td className={`${td} ${tone(s.newRevenue.median)}`}>{pct(s.newRevenue.median)}</td>
      <td className={`${td} text-text-muted`}>
        {pct(s.newRevenue.low)} to {pct(s.newRevenue.high)}
      </td>
      <td className={`${td} ${tone(s.returning.median)}`}>{pct(s.returning.median)}</td>
      <td className={`${td} text-text-muted`}>
        {pct(s.returning.low)} to {pct(s.returning.high)}
      </td>
      <td className={`${td} ${tone(s.amer.median)}`}>{pct(s.amer.median)}</td>
    </tr>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="mr-auto text-lg font-semibold" style={{ fontFamily: "var(--apex-font-heading)" }}>
          {plan.year} Event Effect Model
        </h3>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={S.apply} onChange={(e) => setEventSettings({ ...S, apply: e.target.checked })} />
          Apply events to the plan days
        </label>
        <label className="flex items-center gap-2 text-sm">
          Default for future events
          <select className={inputClass} value={S.stance} onChange={(e) => setEventSettings({ ...S, stance: e.target.value as Stance })}>
            {(Object.keys(STANCE_LABELS) as Stance[]).map((k) => (
              <option key={k} value={k}>
                {STANCE_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="max-w-4xl text-sm text-text-muted">
        Event days run hotter than ordinary days: more spend, more new revenue, more returning revenue. This model measures that from the events you registered in the Calendar, then applies the same pattern to the events still to come. The month totals stay what the New and Returning models say; the event days take a bigger share and the other days a smaller one. Changes apply live in Spend, Input and P&amp;L; press Save plan to keep them.
      </p>

      {eventResults.length === 0 ? (
        <div className="space-y-2 rounded-xl border border-border bg-surface p-6 text-sm">
          <p className="font-medium">No past events to learn from yet.</p>
          <p className="text-text-muted">
            Register past events in the Calendar tab (or import a CSV, or use &quot;Suggest events from data&quot; to label spikes). The more events of each type, the more reliable the effect. {events.length ? `${events.length} event(s) are registered, but none has enough ordinary days around it with data.` : ""}
          </p>
        </div>
      ) : (
        <Panel title="By event type" sub="Each past event day is compared with ordinary days of the same weekday around it. The median is the middle result. The range runs from the 5th to the 95th percentile: nine out of ten past event days landed between the two numbers, so a wide range means the effect is unpredictable. aMER impact is the change in efficiency after the extra spend.">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] border-collapse text-xs">
              <thead>
                <tr className="border-b border-border text-text-muted">
                  <th className="px-2 py-1.5 text-left font-medium">Type</th>
                  <th className={th}>Events</th>
                  <th className={th}>Days</th>
                  <th className={th}>Spend</th>
                  <th className={th}>New revenue</th>
                  <th className={th}>90% range</th>
                  <th className={th}>Returning</th>
                  <th className={th}>90% range</th>
                  <th className={th}>aMER impact</th>
                </tr>
              </thead>
              <tbody>
                {stats.all && row(stats.all, "All events")}
                {stats.byType.map((s) => row(s, TYPE_LABEL[s.type] ?? s.type))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      <Panel title="Future events" sub="Choose how strong each one should be. Conservative, Typical and Strong take the lower quartile, the median and the upper quartile of that type's own past results (pulled toward the all-events figure when the type has few events). Open 'compare' to see the past events behind the numbers, tick the ones that look like this one, and use their average. You can also type your own %.">
        {future.length === 0 ? (
          <p className="text-sm text-text-muted">No upcoming events in {plan.year}. Add them in the Calendar tab.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] border-collapse text-xs">
              <thead>
                <tr className="border-b border-border text-text-muted">
                  <th className="px-2 py-1.5 text-left font-medium">Event</th>
                  <th className="px-2 py-1.5 text-left font-medium">Date</th>
                  <th className="px-2 py-1.5 text-left font-medium">Strength</th>
                  <th className={th}>Spend</th>
                  <th className={th}>New revenue</th>
                  <th className={th}>Returning</th>
                  <th className={th}>aMER</th>
                  <th className="w-24" />
                </tr>
              </thead>
              <tbody>
                {future.map((e) => {
                  const it = S.perEvent[e.id];
                  const base = liftsFor(e.type, it?.stance ?? S.stance, eventResults);
                  const v = (k: keyof Lifts) => it?.override?.[k] ?? base[k];
                  const similar = pastEvents.filter((p) => p.type === e.type).slice(-5).reverse();
                  const sel = picked[e.id] ?? similar.map((p) => p.id);
                  const chosen = similar.filter((p) => sel.includes(p.id));
                  const avg = (k: keyof Lifts) => chosen.reduce((a, p) => a + p.lifts[k], 0) / Math.max(1, chosen.length);
                  return (
                    <>
                      <tr key={e.id} className={`border-b border-border/50 ${it?.off ? "opacity-50" : ""}`}>
                        <td className="px-2 py-1">
                          {e.name} <span className="text-text-faint">{TYPE_LABEL[e.type]}</span>
                        </td>
                        <td className="px-2 py-1 tabular">
                          {e.date}
                          {e.endDate !== e.date ? ` → ${e.endDate.slice(5)}` : ""} <span className="text-text-faint">({eventDays(e).length}d)</span>
                        </td>
                        <td className="px-2 py-1">
                          <select className={inputClass} value={it?.stance ?? S.stance} disabled={it?.off} onChange={(x) => setItem(e.id, { stance: x.target.value as Stance, override: undefined })}>
                            {(Object.keys(STANCE_LABELS) as Stance[]).map((k) => (
                              <option key={k} value={k}>
                                {STANCE_LABELS[k]}
                              </option>
                            ))}
                          </select>
                          {!base.known && <span className="ml-1 text-[10px] text-text-faint">no history of this type</span>}
                        </td>
                        {(["spend", "newRevenue", "returning", "amer"] as const).map((k) => (
                          <td key={k} className={td}>
                            {k === "newRevenue" || k === "amer" ? (
                              <span className={tone(v(k))}>{pct(v(k))}</span>
                            ) : (
                              <NumField value={Math.round((v(k) - 1) * 1000) / 10} decimals={1} className="w-16" suffix="%" disabled={it?.off} onCommit={(x) => setOverride(e, k, x)} />
                            )}
                          </td>
                        ))}
                        <td className="px-2 py-1 text-right">
                          <button className="text-accent underline" onClick={() => setOpen(open === e.id ? null : e.id)}>
                            compare
                          </button>{" "}
                          <button className="text-text-faint underline" onClick={() => setItem(e.id, { off: !it?.off })}>
                            {it?.off ? "turn on" : "off"}
                          </button>
                        </td>
                      </tr>
                      {open === e.id && (
                        <tr key={`${e.id}c`} className="border-b border-border/50 bg-bg">
                          <td colSpan={8} className="px-3 py-2">
                            {similar.length === 0 ? (
                              <p className="text-text-muted">No past {TYPE_LABEL[e.type]} events measured yet.</p>
                            ) : (
                              <div className="space-y-1">
                                <p className="text-text-muted">Past {TYPE_LABEL[e.type]} events (latest 5). Tick the ones that look like this one.</p>
                                {similar.map((p) => (
                                  <label key={p.id} className="flex items-center gap-3 tabular">
                                    <input type="checkbox" checked={sel.includes(p.id)} onChange={(x) => setPicked({ ...picked, [e.id]: x.target.checked ? [...sel, p.id] : sel.filter((i) => i !== p.id) })} />
                                    <span className="w-56 truncate">{p.name}</span>
                                    <span className="w-24 text-text-faint">{p.from}</span>
                                    <span>spend {pct(p.lifts.spend)}</span>
                                    <span>new {pct(p.lifts.newRevenue)}</span>
                                    <span>returning {pct(p.lifts.returning)}</span>
                                    <span>aMER {pct(p.lifts.amer)}</span>
                                  </label>
                                ))}
                                <div className="flex items-center gap-3 pt-1">
                                  <span className="font-medium">
                                    Average of the ticked: spend {pct(avg("spend"))} · new {pct(avg("newRevenue"))} · returning {pct(avg("returning"))} · aMER {pct(avg("amer"))}
                                  </span>
                                  <button className={btn} disabled={!chosen.length} onClick={() => setItem(e.id, { override: { spend: avg("spend"), newRevenue: avg("newRevenue"), returning: avg("returning"), amer: avg("amer") } })}>
                                    Use this average
                                  </button>
                                  {it?.override && (
                                    <button className="text-xs text-text-muted underline" onClick={() => setItem(e.id, { override: undefined })}>
                                      back to {STANCE_LABELS[it?.stance ?? S.stance]}
                                    </button>
                                  )}
                                </div>
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-xs text-text-faint">
          {Object.keys(mult).length} plan day(s) are reshaped by events. When events overlap on a day the strongest offer, launch or holiday sets the lift; email, SMS and PR only count on days without one.
          {initiatives ? ` ${initiatives} initiative(s) are logged and have no effect yet.` : ""}
        </p>
      </Panel>

      {pastEvents.length > 0 && (
        <Panel title="Past events measured" sub="One line per event: the average over its days against ordinary days around it.">
          <div className="max-h-96 overflow-auto">
            <table className="w-full min-w-[760px] border-collapse text-xs">
              <thead>
                <tr className="border-b border-border text-text-muted">
                  <th className="px-2 py-1.5 text-left font-medium">Event</th>
                  <th className="px-2 py-1.5 text-left font-medium">Type</th>
                  <th className="px-2 py-1.5 text-left font-medium">Dates</th>
                  <th className={th}>Spend</th>
                  <th className={th}>New revenue</th>
                  <th className={th}>Returning</th>
                  <th className={th}>aMER</th>
                </tr>
              </thead>
              <tbody>
                {[...pastEvents].reverse().slice(0, 60).map((p) => (
                  <tr key={p.id} className="border-b border-border/40">
                    <td className="px-2 py-1">{p.name}</td>
                    <td className="px-2 py-1 text-text-muted">{TYPE_LABEL[p.type]}</td>
                    <td className="px-2 py-1 tabular text-text-muted">
                      {p.from}
                      {p.to !== p.from ? ` → ${p.to.slice(5)}` : ""}
                    </td>
                    <td className={`${td} ${tone(p.lifts.spend)}`}>{pct(p.lifts.spend)}</td>
                    <td className={`${td} ${tone(p.lifts.newRevenue)}`}>{pct(p.lifts.newRevenue)}</td>
                    <td className={`${td} ${tone(p.lifts.returning)}`}>{pct(p.lifts.returning)}</td>
                    <td className={`${td} ${tone(p.lifts.amer)}`}>{pct(p.lifts.amer)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </div>
  );
}
