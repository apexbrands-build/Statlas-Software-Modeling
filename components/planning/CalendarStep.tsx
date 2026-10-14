"use client";

import { useMemo, useState } from "react";
import { addDays, dayOfWeek, eachDay, endOfMonth } from "@/lib/dates";
import { aggregate, amerSpend } from "@/lib/metrics";
import { monthEventCounts } from "@/lib/planning/calendar-grid";
import { CSV_TEMPLATE, EVENT_TYPES, eventDays, GROUP_LABELS, parseEventCsv, suggestEvents, toDayFacts, TYPE_LABEL, typeGroup, type DayMultipliers, type EventGroup, type MarketingEvent } from "@/lib/planning/events";
import type { ClientSettings, DailyFact } from "@/lib/types";
import type { PlanCtx } from "./ctx";
import { CalendarGrid } from "./CalendarGrid";
import { GROUP_STYLE, QUICK_TYPES } from "./calendar-colors";
import { btn, btnPrimary, inputClass, Modal, MONTHS, WEEKDAYS } from "./ui";


type Draft = Omit<MarketingEvent, "id" | "clientId"> & { id?: string };

/**
 * What the calendar needs. The plan editor passes its own (`planCalendarCtx`); the standalone Calendar page builds one from the client alone.
 * Events belong to the client, so both show and edit the same events.
 */
export interface CalendarCtx {
  /** Year whose months the selector lists. */
  year: number;
  settings: ClientSettings;
  events: MarketingEvent[];
  /** Day multipliers the plan applies (empty on the standalone page). */
  eventMults: Record<string, DayMultipliers>;
  history: { facts: DailyFact[]; lastData: string };
  /** Weekday offsets (index 0 = Sunday) used to find unlabelled spikes. */
  dow: number[];
  saveEvents: (list: (Omit<MarketingEvent, "id" | "clientId"> & { id?: string })[]) => Promise<string | null>;
  removeEvent: (id: string) => Promise<string | null>;
  /** Inside a plan the days are reshaped and need Save plan; on the standalone page plans pick the events up when they next open. */
  inPlan: boolean;
}

export const planCalendarCtx = (ctx: PlanCtx): CalendarCtx => ({
  year: ctx.plan.year,
  settings: ctx.settings,
  events: ctx.events,
  eventMults: ctx.eventMults,
  history: ctx.history,
  dow: ctx.seasonality.dow,
  saveEvents: ctx.saveEvents,
  removeEvent: ctx.removeEvent,
  inPlan: true,
});
const blank = (date: string): Draft => ({ date, endDate: date, type: "promotion", name: "", source: "manual" });

function TypeSelect({ value, onChange, className = inputClass }: { value: string; onChange: (v: string) => void; className?: string }) {
  return (
    <select className={className} value={value} onChange={(e) => onChange(e.target.value)} aria-label="Event type">
      {(Object.keys(GROUP_LABELS) as EventGroup[]).map((g) => (
        <optgroup key={g} label={GROUP_LABELS[g]}>
          {EVENT_TYPES.filter((t) => t.group === g).map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

function Chip({ e, onClick, faint }: { e: Pick<MarketingEvent, "type" | "name">; onClick?: () => void; faint?: boolean }) {
  const label = e.name && e.name !== TYPE_LABEL[e.type] ? `${e.name}` : TYPE_LABEL[e.type];
  return (
    <button type="button" onClick={onClick} disabled={!onClick} title={TYPE_LABEL[e.type]} className={`rounded-full px-2 py-0.5 text-xs ${faint ? "bg-surface-raised text-text-faint" : GROUP_STYLE[typeGroup(e.type)].chip} ${onClick ? "hover:opacity-80" : ""}`}>
      <span className="opacity-70">{TYPE_LABEL[e.type] !== label ? `${TYPE_LABEL[e.type]}: ` : ""}</span>
      {label}
    </button>
  );
}

function EventForm({ draft, onChange, onSave, onCancel, onDelete, busy }: { draft: Draft; onChange: (d: Draft) => void; onSave: () => void; onCancel: () => void; onDelete?: () => void; busy: boolean }) {
  const set = (patch: Partial<Draft>) => onChange({ ...draft, ...patch });
  const lab = "text-[11px] text-text-muted";
  return (
    <div className="grid gap-2 rounded-lg border border-accent/40 bg-bg p-3 sm:grid-cols-2 lg:grid-cols-4">
      <label className={lab}>
        Type
        <TypeSelect value={draft.type} onChange={(v) => set({ type: v })} className={`${inputClass} mt-0.5 w-full`} />
      </label>
      <label className={lab}>
        Event name
        <input className={`${inputClass} mt-0.5 w-full`} value={draft.name} placeholder={TYPE_LABEL[draft.type]} onChange={(e) => set({ name: e.target.value })} />
      </label>
      <label className={lab}>
        Start
        <input type="date" className={`${inputClass} mt-0.5 w-full`} value={draft.date} onChange={(e) => e.target.value && set({ date: e.target.value, endDate: draft.endDate < e.target.value ? e.target.value : draft.endDate })} />
      </label>
      <label className={lab}>
        End (included)
        <input type="date" className={`${inputClass} mt-0.5 w-full`} value={draft.endDate} min={draft.date} onChange={(e) => e.target.value && set({ endDate: e.target.value })} />
      </label>
      <label className={lab}>
        Promo / offer
        <input className={`${inputClass} mt-0.5 w-full`} value={draft.promo ?? ""} placeholder="e.g. 20% off" onChange={(e) => set({ promo: e.target.value })} />
      </label>
      <label className={lab}>
        Product
        <input className={`${inputClass} mt-0.5 w-full`} value={draft.product ?? ""} onChange={(e) => set({ product: e.target.value })} />
      </label>
      <label className={lab}>
        Audience
        <input className={`${inputClass} mt-0.5 w-full`} value={draft.audience ?? ""} placeholder="e.g. VIP list" onChange={(e) => set({ audience: e.target.value })} />
      </label>
      <label className={lab}>
        Segment size
        <input className={`${inputClass} mt-0.5 w-full`} inputMode="numeric" value={draft.segmentSize ?? ""} onChange={(e) => set({ segmentSize: e.target.value === "" ? null : Number(e.target.value.replace(/[^0-9]/g, "")) })} />
      </label>
      {typeGroup(draft.type) === "initiative" && <p className="text-xs text-text-muted sm:col-span-2 lg:col-span-4">Initiatives (a creative batch, a funnel launch, a test) are logged so the team can see what changed and when. They do not change the forecast yet.</p>}
      <div className="flex gap-2 sm:col-span-2 lg:col-span-4">
        <button className={btnPrimary} disabled={busy} onClick={onSave}>
          {busy ? "Saving…" : draft.id ? "Save event" : "Add event"}
        </button>
        <button className={btn} onClick={onCancel}>
          Cancel
        </button>
        {onDelete && (
          <button className={`${btn} ml-auto text-bad`} disabled={busy} onClick={onDelete}>
            Delete
          </button>
        )}
      </div>
    </div>
  );
}

const MONTH_FULL = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** Marketing calendar: a colour-coded month grid (click a day to add, click an event to edit), last year's events for reference, CSV import and suggestions from the data. */
export function CalendarStep({ ctx }: { ctx: CalendarCtx }) {
  const { year, events, eventMults, saveEvents, removeEvent } = ctx;
  const today = new Date().toISOString().slice(0, 10);
  const [month, setMonth] = useState(() => (today.slice(0, 4) === String(year) ? `${today.slice(0, 7)}-01` : `${year}-01-01`));
  const [view, setView] = useState<"grid" | "list">("grid");
  const [focus, setFocus] = useState<EventGroup | null>(null);
  const [onlyEvents, setOnlyEvents] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [showSuggest, setShowSuggest] = useState(false);

  const days = useMemo(() => eachDay(month, endOfMonth(month)), [month]);
  const byDate = useMemo(() => {
    const m = new Map<string, MarketingEvent[]>();
    for (const e of events) for (const d of eventDays(e)) m.set(d, [...(m.get(d) ?? []), e]);
    return m;
  }, [events]);
  const counts = useMemo(() => monthEventCounts(events, year), [events, year]);
  const monthIndex = Number(month.slice(5, 7)) - 1;
  const monthCount = new Set(days.flatMap((d) => (byDate.get(d) ?? []).map((e) => e.id))).size;
  const lyCount = new Set(days.flatMap((d) => (byDate.get(addDays(d, -364)) ?? []).map((e) => e.id))).size;
  const eventDayCount = days.filter((d) => byDate.has(d)).length;
  const lastYearOf = (d: string) => byDate.get(addDays(d, -364)) ?? [];
  const goMonth = (i: number) => setMonth(`${year}-${String(((i + 12) % 12) + 1).padStart(2, "0")}-01`);

  const save = async () => {
    if (!draft) return;
    setBusy(true);
    const err = await saveEvents([{ ...draft, name: draft.name.trim() || TYPE_LABEL[draft.type], endDate: draft.endDate || draft.date }]);
    setBusy(false);
    if (err) setMsg({ tone: "bad", text: err });
    else {
      setMsg({ tone: "ok", text: ctx.inPlan ? "Event saved. The plan days are reshaped; press Save plan to update the targets." : "Event saved. Plans that use the event model pick it up the next time they are opened." });
      setDraft(null);
    }
  };
  const del = async () => {
    if (!draft?.id) return;
    setBusy(true);
    const err = await removeEvent(draft.id);
    setBusy(false);
    if (err) setMsg({ tone: "bad", text: err });
    else setDraft(null);
  };

  const tile = "rounded-xl border px-4 py-2";
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button className={btn} aria-label="Previous month" onClick={() => goMonth(monthIndex - 1)}>
          ‹
        </button>
        <h3 className="min-w-44 text-center text-lg font-semibold" style={{ fontFamily: "var(--apex-font-heading)" }}>
          {MONTH_FULL[monthIndex]} {year}
        </h3>
        <button className={btn} aria-label="Next month" onClick={() => goMonth(monthIndex + 1)}>
          ›
        </button>
        <div className="ml-auto flex flex-wrap gap-2">
          <div role="group" aria-label="View" className="flex overflow-hidden rounded-lg border border-border text-sm">
            {(["grid", "list"] as const).map((v) => (
              <button key={v} aria-pressed={view === v} onClick={() => setView(v)} className={`px-3 py-1.5 capitalize ${view === v ? "bg-accent font-medium text-black" : "text-text-muted hover:text-text"}`}>
                {v}
              </button>
            ))}
          </div>
          <button className={btn} onClick={() => setShowSuggest((v) => !v)}>
            Suggest events from data
          </button>
          <button className={btn} onClick={() => setShowImport(true)}>
            Import CSV
          </button>
          <button className={btnPrimary} onClick={() => setDraft(blank(month <= today && today.startsWith(month.slice(0, 7)) ? today : month))}>
            + Add event
          </button>
        </div>
      </div>

      <div role="tablist" aria-label="Month" className="flex flex-wrap gap-1.5">
        {MONTHS.map((m, i) => (
          <button key={m} role="tab" aria-selected={i === monthIndex} onClick={() => goMonth(i)} className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm transition ${i === monthIndex ? "border-accent bg-accent font-semibold text-black" : counts[i] > 0 ? "border-accent/40 bg-accent/10 text-text hover:border-accent" : "border-border text-text-muted hover:text-text"}`}>
            {m}
            {counts[i] > 0 && <span className={`rounded-full px-1.5 text-[10px] font-bold ${i === monthIndex ? "bg-black/20 text-black" : "bg-accent/80 text-black"}`}>{counts[i]}</span>}
          </button>
        ))}
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <div className={`${tile} border-accent/50 bg-accent/10`}>
          <p className="text-[11px] uppercase tracking-wide text-text-muted">Events this month</p>
          <p className="text-2xl font-semibold tabular text-accent">{monthCount}</p>
        </div>
        <div className={`${tile} border-orange-400/40 bg-orange-500/10`}>
          <p className="text-[11px] uppercase tracking-wide text-text-muted">Days with an event</p>
          <p className="text-2xl font-semibold tabular text-orange-300">{eventDayCount}</p>
        </div>
        <div className={`${tile} border-border bg-surface`}>
          <p className="text-[11px] uppercase tracking-wide text-text-muted">Same month last year</p>
          <p className="text-2xl font-semibold tabular text-text-muted">{lyCount}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2" aria-label="Legend">
        <span className="text-xs text-text-muted">Show:</span>
        {(Object.keys(GROUP_LABELS) as EventGroup[]).map((g) => (
          <button key={g} aria-pressed={focus === g} onClick={() => setFocus((f) => (f === g ? null : g))} className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition ${focus === g ? "border-text bg-surface-raised text-text" : "border-border text-text-muted hover:text-text"}`}>
            <span className={`h-2.5 w-2.5 rounded-full ${GROUP_STYLE[g].dot}`} />
            {GROUP_LABELS[g]}
          </button>
        ))}
        {focus && (
          <button className="text-xs text-text-muted underline" onClick={() => setFocus(null)}>
            Show all
          </button>
        )}
      </div>

      <p className="max-w-4xl text-xs text-text-muted">
        Register what is planned (and what already happened, so the Event Effect Model can learn from it). Click a day to add an event, or an event to edit it. Every event with an effect makes its days run hotter in the plan and compresses the other days; the month totals stay what the models say.
      </p>
      {msg && <p className={`rounded-lg border p-3 text-sm ${msg.tone === "ok" ? "border-good/40 bg-good/10 text-good" : "border-bad/40 bg-bad/10 text-bad"}`}>{msg.text}</p>}

      {showSuggest && <Suggestions ctx={ctx} onAdd={(d) => setDraft(d)} onClose={() => setShowSuggest(false)} />}

      {view === "grid" ? (
        <CalendarGrid month={month} weekStart={ctx.settings.extra.weekStartDay} byDate={byDate} lastYear={lastYearOf} eventMults={eventMults} today={today} focus={focus} onAdd={(d) => setDraft(blank(d))} onEdit={(e) => setDraft({ ...e })} />
      ) : (
        <>
          <label className="flex items-center gap-1.5 text-sm text-text-muted">
            <input type="checkbox" checked={onlyEvents} onChange={(e) => setOnlyEvents(e.target.checked)} /> Only days with events
          </label>
          <div className="divide-y divide-border/50 overflow-hidden rounded-xl border border-border bg-surface">
            {days
              .filter((d) => !onlyEvents || byDate.has(d) || byDate.has(addDays(d, -364)))
              .map((d) => {
                const evs = byDate.get(d) ?? [];
                const ly = lastYearOf(d);
                const mult = eventMults[d];
                const g = evs[0] ? typeGroup(evs[0].type) : null;
                return (
                  <div key={d} className={`flex flex-wrap items-start gap-x-4 gap-y-1 border-l-4 px-3 py-2 ${g ? `${GROUP_STYLE[g].cell} ${GROUP_STYLE[g].dot.replace("bg-", "border-l-")}` : "border-l-transparent"}`}>
                    <div className="w-24 shrink-0 text-sm">
                      <span className="font-medium">{WEEKDAYS[dayOfWeek(d)]}</span> <span className="text-text-muted">{d.slice(8)}</span>
                    </div>
                    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                      {evs.map((e) => (
                        <Chip key={e.id} e={e} onClick={() => setDraft({ ...e })} />
                      ))}
                      {ly.map((e) => (
                        <Chip key={`ly${e.id}`} e={e} faint />
                      ))}
                      {ly.length > 0 && <span className="text-[10px] text-text-faint">last year</span>}
                    </div>
                    {mult && <span className="text-[11px] text-text-muted tabular">spend ×{mult.spend.toFixed(2)} · returning ×{mult.returning.toFixed(2)} · aMER ×{mult.amer.toFixed(2)}</span>}
                    <button className="rounded border border-border px-2 text-sm text-text-muted hover:border-accent hover:text-accent" aria-label={`Add event on ${d}`} onClick={() => setDraft(blank(d))}>
                      +
                    </button>
                  </div>
                );
              })}
          </div>
        </>
      )}

      {draft && (
        <Modal title={draft.id ? "Edit event" : `Add event · ${draft.date}`} onClose={() => setDraft(null)} wide>
          {!draft.id && (
            <div className="mb-3 flex flex-wrap gap-1.5" aria-label="Quick types">
              {QUICK_TYPES.map((t) => {
                const g = typeGroup(t);
                const on = draft.type === t;
                return (
                  <button key={t} type="button" aria-pressed={on} onClick={() => setDraft({ ...draft, type: t })} className={`rounded-full px-3 py-1 text-xs font-medium transition ${on ? `${GROUP_STYLE[g].chip} ring-2` : "border border-border text-text-muted hover:text-text"}`}>
                    <span className={`mr-1.5 inline-block h-2 w-2 rounded-full ${GROUP_STYLE[g].dot}`} />
                    {TYPE_LABEL[t]}
                  </button>
                );
              })}
            </div>
          )}
          <EventForm draft={draft} onChange={setDraft} onSave={save} onCancel={() => setDraft(null)} onDelete={draft.id ? del : undefined} busy={busy} />
        </Modal>
      )}

      {showImport && <ImportModal ctx={ctx} onClose={() => setShowImport(false)} onDone={(t) => setMsg({ tone: "ok", text: t })} />}
    </div>
  );
}

function ImportModal({ ctx, onClose, onDone }: { ctx: CalendarCtx; onClose: () => void; onDone: (text: string) => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const parsed = useMemo(() => (text.trim() ? parseEventCsv(text) : null), [text]);

  const download = () => {
    const url = URL.createObjectURL(new Blob([CSV_TEMPLATE], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "marketing-calendar-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const run = async () => {
    if (!parsed?.events.length) return;
    setBusy(true);
    const e = await ctx.saveEvents(parsed.events);
    setBusy(false);
    if (e) setErr(e);
    else {
      onDone(`Imported ${parsed.events.length} event${parsed.events.length === 1 ? "" : "s"}. Past ones now feed the Event Effect Model.`);
      onClose();
    }
  };

  return (
    <Modal title="Import marketing calendar" onClose={onClose} wide>
      <div className="space-y-3 text-sm">
        <p className="text-text-muted">
          One row per event, past or planned. Columns (header names are matched, order does not matter): <b>date</b> (YYYY-MM-DD or DD/MM/YYYY), end_date, <b>type</b> (e.g. Promotion, Mother&apos;s Day, Email, Black Friday; anything unknown becomes Other), name, promo, product, audience, segment_size. Paste from a spreadsheet or load a CSV file.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <button className={btn} onClick={download}>
            Download template
          </button>
          <input
            type="file"
            accept=".csv,text/csv,text/plain"
            className="text-xs"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) setText(await f.text());
            }}
          />
        </div>
        <textarea className={`${inputClass} h-40 w-full font-mono text-xs`} placeholder={"date,end_date,type,name\n2026-11-24,2026-11-30,Black Friday,BFCM 2026"} value={text} onChange={(e) => setText(e.target.value)} />
        {parsed && (
          <div className="space-y-1">
            <p>
              <b>{parsed.events.length}</b> event{parsed.events.length === 1 ? "" : "s"} ready
              {parsed.errors.length > 0 && <span className="text-bad"> · {parsed.errors.length} row{parsed.errors.length === 1 ? "" : "s"} skipped</span>}
            </p>
            {parsed.errors.slice(0, 5).map((x) => (
              <p key={x} className="text-xs text-bad">
                {x}
              </p>
            ))}
            {parsed.events.slice(0, 5).map((x, i) => (
              <p key={i} className="text-xs text-text-muted">
                {x.date}
                {x.endDate !== x.date ? ` → ${x.endDate}` : ""} · {TYPE_LABEL[x.type]} · {x.name}
              </p>
            ))}
          </div>
        )}
        {err && <p className="text-sm text-bad">{err}</p>}
        <div className="flex gap-2">
          <button className={btnPrimary} disabled={busy || !parsed?.events.length} onClick={run}>
            {busy ? "Importing…" : "Import"}
          </button>
          <button className={btn} onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </Modal>
  );
}

function Suggestions({ ctx, onAdd, onClose }: { ctx: CalendarCtx; onAdd: (d: Draft) => void; onClose: () => void }) {
  const { history, settings, dow, events } = ctx;
  const list = useMemo(() => {
    if (!history.lastData) return [];
    const days = toDayFacts(history.facts, (f) => amerSpend(aggregate([f]), settings));
    return suggestEvents(days, events, dow, addDays(history.lastData, -730), history.lastData).slice(0, 25);
  }, [history, settings, dow, events]);
  return (
    <div className="space-y-2 rounded-xl border border-border bg-surface p-4">
      <div className="flex items-center">
        <h3 className="mr-auto text-sm font-semibold">Unlabelled spikes in the last 2 years</h3>
        <button className="text-text-muted hover:text-text" onClick={onClose} aria-label="Close suggestions">
          ✕
        </button>
      </div>
      <p className="text-xs text-text-muted">Days where order revenue ran at least 40% above an ordinary day of the same weekday and no event is registered. Label the ones you recognise so the model can learn from them.</p>
      {list.length === 0 ? (
        <p className="text-sm text-text-muted">No unlabelled spikes found.</p>
      ) : (
        <ul className="grid gap-1 sm:grid-cols-2">
          {list.map((s) => (
            <li key={s.date} className="flex items-center justify-between gap-2 rounded-lg bg-bg px-3 py-1.5 text-sm">
              <span>
                {s.date}
                {s.endDate !== s.date ? ` → ${s.endDate.slice(5)}` : ""} <span className="text-xs text-text-muted">×{s.lift.toFixed(1)}</span>
              </span>
              <button className={btn} onClick={() => onAdd({ ...blank(s.date), endDate: s.endDate })}>
                Label
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
