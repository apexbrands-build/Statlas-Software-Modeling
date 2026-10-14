"use client";

import { dayHeat, monthWeeks, weekdayLabels } from "@/lib/planning/calendar-grid";
import { TYPE_LABEL, typeGroup, type DayMultipliers, type EventGroup, type MarketingEvent } from "@/lib/planning/events";
import { GROUP_STYLE, HEAT_STYLE } from "./calendar-colors";

/** The month as a real calendar: every day is a button that adds an event, every chip opens that event, colours show the kind of event and how hard the plan leans on the day. */
export function CalendarGrid({
  month,
  weekStart,
  byDate,
  lastYear,
  eventMults,
  today,
  focus,
  onAdd,
  onEdit,
}: {
  month: string;
  weekStart: string;
  byDate: Map<string, MarketingEvent[]>;
  /** Events of the same weekday a year earlier (364 days back), shown faint. */
  lastYear: (date: string) => MarketingEvent[];
  eventMults: Record<string, DayMultipliers>;
  today: string;
  /** When set, other groups are dimmed. */
  focus: EventGroup | null;
  onAdd: (date: string) => void;
  onEdit: (e: MarketingEvent) => void;
}) {
  const weeks = monthWeeks(month, weekStart);
  return (
    <div role="grid" aria-label="Marketing calendar" className="space-y-1.5">
      <div className="grid grid-cols-7 gap-1.5">
        {weekdayLabels(weekStart).map((w) => (
          <div key={w} className="px-1 text-center text-[11px] font-semibold uppercase tracking-wide text-text-muted">
            {w}
          </div>
        ))}
      </div>
      {weeks.map((week, r) => (
        <div key={r} className="grid grid-cols-7 gap-1.5" role="row">
          {week.map((d, c) => {
            if (!d) return <div key={c} className="min-h-[104px] rounded-lg bg-surface/30" />;
            const evs = byDate.get(d) ?? [];
            const ly = lastYear(d);
            const heat = dayHeat(eventMults[d]);
            const first = evs[0] ? typeGroup(evs[0].type) : null;
            const isToday = d === today;
            return (
              <div
                key={c}
                role="gridcell"
                className={`group relative min-h-[104px] overflow-hidden rounded-lg border p-1.5 transition ${first ? GROUP_STYLE[first].cell : "border-border bg-surface hover:border-accent/60 hover:bg-surface-raised"} ${isToday ? "ring-2 ring-accent" : ""}`}
              >
                <button type="button" aria-label={`Add event on ${d}`} className="absolute inset-0 z-0 cursor-pointer rounded-lg focus-visible:outline-2 focus-visible:outline-accent" onClick={() => onAdd(d)} />
                <div className="pointer-events-none relative z-10 flex items-center justify-between">
                  <span className={`text-xs font-semibold ${isToday ? "rounded-full bg-accent px-1.5 py-0.5 text-black" : "text-text"}`}>{Number(d.slice(8))}</span>
                  <span className="flex items-center gap-1">
                    {heat !== "flat" && (
                      <span className={`rounded px-1 text-[10px] font-medium ${HEAT_STYLE[heat].badge}`} title={eventMults[d] ? `Spend ×${eventMults[d].spend.toFixed(2)}, returning ×${eventMults[d].returning.toFixed(2)}, aMER ×${eventMults[d].amer.toFixed(2)}` : undefined}>
                        {HEAT_STYLE[heat].label}
                      </span>
                    )}
                    <span className="rounded-full bg-accent/90 px-1.5 text-xs font-bold leading-4 text-black opacity-0 transition group-hover:opacity-100">+</span>
                  </span>
                </div>
                <div className="relative z-10 mt-1 space-y-1">
                  {evs.map((e) => {
                    const g = typeGroup(e.type);
                    const label = e.name && e.name !== TYPE_LABEL[e.type] ? e.name : TYPE_LABEL[e.type];
                    return (
                      <button key={e.id} type="button" title={`${TYPE_LABEL[e.type]}${e.promo ? ` · ${e.promo}` : ""}`} onClick={() => onEdit(e)} className={`block w-full truncate rounded px-1.5 py-0.5 text-left text-[11px] font-medium hover:brightness-125 ${GROUP_STYLE[g].chip} ${focus && focus !== g ? "opacity-25" : ""}`}>
                        {label}
                      </button>
                    );
                  })}
                  {ly.slice(0, 2).map((e) => (
                    <div key={`ly${e.id}`} className="pointer-events-none truncate rounded border border-dashed border-border px-1.5 py-0.5 text-[10px] text-text-faint" title="Last year, same weekday">
                      LY · {e.name && e.name !== TYPE_LABEL[e.type] ? e.name : TYPE_LABEL[e.type]}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
