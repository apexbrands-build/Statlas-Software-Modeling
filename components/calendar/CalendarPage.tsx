"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarStep, type CalendarCtx } from "@/components/planning/CalendarStep";
import { usePlanHistory } from "@/components/planning/useHistory";
import { inputClass } from "@/components/planning/ui";
import { useApp } from "@/lib/app-context";
import { todayLocal } from "@/lib/dates";
import { FLAT_SEASONALITY } from "@/lib/planning/generate";
import { dowFromHistory } from "@/lib/planning/history";
import type { MarketingEvent } from "@/lib/planning/events";
import { getRepository } from "@/lib/repository";

/**
 * The marketing calendar on its own, outside any plan. Events belong to the client (the same table the plan's Calendar tab uses),
 * so what is added here shows in every plan and the other way round.
 */
export function CalendarPage() {
  const { client, settings } = useApp();
  const thisYear = Number(todayLocal().slice(0, 4));
  const [year, setYear] = useState(thisYear);
  const [loaded, setLoaded] = useState<{ clientId: string; events: MarketingEvent[] } | null>(null);
  const history = usePlanHistory(client?.id, year);

  useEffect(() => {
    if (!client) return;
    let cancel = false;
    (async () => {
      const events = await getRepository().listEvents(client.id);
      if (!cancel) setLoaded({ clientId: client.id, events });
    })();
    return () => {
      cancel = true;
    };
  }, [client]);

  const events = useMemo(() => (loaded && client && loaded.clientId === client.id ? loaded.events : []), [loaded, client]);
  const dow = useMemo(() => (history.lastData ? dowFromHistory(history.facts, history.lastData)?.dow : undefined) ?? FLAT_SEASONALITY.dow, [history]);

  const saveEvents = useCallback<CalendarCtx["saveEvents"]>(
    async (list) => {
      if (!client) return "No store selected";
      try {
        const saved = await getRepository().saveEvents(client.id, list);
        setLoaded((cur) => (cur ? { ...cur, events: [...cur.events.filter((e) => !saved.some((s) => s.id === e.id)), ...saved].sort((a, b) => (a.date < b.date ? -1 : 1)) } : cur));
        return null;
      } catch (e) {
        return e instanceof Error ? e.message : "Could not save the events";
      }
    },
    [client],
  );

  const removeEvent = useCallback<CalendarCtx["removeEvent"]>(async (id) => {
    try {
      await getRepository().deleteEvent(id);
      setLoaded((cur) => (cur ? { ...cur, events: cur.events.filter((e) => e.id !== id) } : cur));
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : "Could not delete the event";
    }
  }, []);

  if (!client || !settings || !loaded) return <div className="h-40 animate-pulse rounded-xl bg-surface" />;

  const ctx: CalendarCtx = { year, settings, events, eventMults: {}, history, dow, saveEvents, removeEvent, inPlan: false };
  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <h1 className="text-xl font-semibold" style={{ fontFamily: "var(--apex-font-heading)" }}>
            Calendar
          </h1>
          <p className="text-xs text-text-muted">{client.name}: marketing events and initiatives. Plans use the same calendar for the Event Effect Model.</p>
        </div>
        <select className={inputClass} value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label="Year">
          {[thisYear - 3, thisYear - 2, thisYear - 1, thisYear, thisYear + 1].map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </div>
      <CalendarStep key={year} ctx={ctx} />
    </div>
  );
}
