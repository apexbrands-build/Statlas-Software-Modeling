/** Marketing actions shown on the Calendar Report: events, Meta launches and (when their syncs exist) email and SMS sends, all in one shape. */
import { eachDay, type Range } from "../dates";
import type { MarketingEvent } from "../planning/events";

export type ActionType = "event" | "email" | "sms" | "meta";

export interface MarketingAction {
  date: string;
  type: ActionType;
  name: string;
}

const ORDER: ActionType[] = ["event", "email", "sms", "meta"];

/** One action per day the event covers inside the range. */
export function eventActions(events: MarketingEvent[], range: Range): MarketingAction[] {
  const out: MarketingAction[] = [];
  for (const e of events) {
    const from = e.date > range.from ? e.date : range.from;
    const to = (e.endDate || e.date) < range.to ? e.endDate || e.date : range.to;
    if (from > to) continue;
    for (const date of eachDay(from, to)) out.push({ date, type: "event", name: e.name });
  }
  return out;
}

/** One action per distinct campaign per day. */
export function metaLaunchActions(launches: { date: string; campaign: string }[]): MarketingAction[] {
  const seen = new Set<string>();
  const out: MarketingAction[] = [];
  for (const l of launches) {
    const key = `${l.date}|${l.campaign}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ date: l.date, type: "meta", name: l.campaign });
  }
  return out;
}

/** Actions by date, identical type and name collapsed, ordered event, email, sms, meta. */
export function actionsByDay(list: MarketingAction[]): Map<string, MarketingAction[]> {
  const by = new Map<string, MarketingAction[]>();
  const seen = new Set<string>();
  for (const a of list) {
    const key = `${a.date}|${a.type}|${a.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const day = by.get(a.date) ?? [];
    day.push(a);
    by.set(a.date, day);
  }
  for (const day of by.values()) day.sort((x, y) => ORDER.indexOf(x.type) - ORDER.indexOf(y.type));
  return by;
}

export function groupByType(list: MarketingAction[]): { type: ActionType; names: string[] }[] {
  const out: { type: ActionType; names: string[] }[] = [];
  for (const a of list) {
    const g = out.find((x) => x.type === a.type);
    if (g) g.names.push(a.name);
    else out.push({ type: a.type, names: [a.name] });
  }
  return out.sort((x, y) => ORDER.indexOf(x.type) - ORDER.indexOf(y.type));
}
