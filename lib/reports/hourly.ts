/**
 * The Hourly Report's numbers: one day by the hour of the store's own clock, each column's actual against what was expected, the Day
 * row, where the day is heading, and the readings above the grid (spec docs/superpowers/specs/2026-11-27-hourly-report-design.md).
 *
 * It is the Calendar Report by hour: an hour is turned into a fact in the daily shape (`hourFact`) and valued with the same metric
 * definitions (`aggregate` + each column's `value`). The expectation of an hour is:
 *  - against the plan: the day's goal (`aggregatePlan` of the day's plan row + the column's `goal`, exactly like the Calendar Report)
 *    times the hour's share of the day (the day's shape). A ratio (AOV, MER, aMER, CAC, ROAS) is not spread: every hour carries the
 *    day's target.
 *  - against other days (last week, the last four same weekdays, last year): those days' own hourly actuals, valued the same way.
 *
 * On the store's today, orders load about once an hour, so the page reads the day up to the last order loaded, not up to the clock:
 * hours before it are done, from there to the clock they are partial (shown, not judged), the rest is to come (expectation only).
 */
import { addDays, dayOfWeek } from "../dates";
import { formatDiff, formatValue } from "../format";
import { aggregate, aggregatePlan, compare, emptyTotals, type Tone } from "../metrics";
import { TYPE_LABEL, type MarketingEvent } from "../planning/events";
import type { MixOf } from "../planning/mix";
import type { RoasOf } from "../planning/roas";
import type { MetaLaunchHour } from "../repository/meta-launches";
import type { OrderHour } from "../repository/order-hours";
import type { ClientSettings, Currency, DailyFact, PlanTargetDay } from "../types";
import type { CalendarRow } from "./calendar";
import type { ActionType } from "./calendar-actions";
import { bfcmReference, lastYearDay, sameWeekdaysBefore, shapeCandidates } from "./hourly-shape";
import { hourlySpec, type HourlySpec } from "./hourly-specs";

/* ------------------------------------------------------------------ */
/* The store's clock                                                   */
/* ------------------------------------------------------------------ */

export interface StoreClock {
  date: string;
  hour: number;
  minute: number;
}
export interface ClockTime {
  hour: number;
  minute: number;
}

/** The date and time a store's clock shows at an instant. An unknown time zone reads as UTC. */
export function storeClock(now: Date, timeZone: string): StoreClock {
  const read = (zone: string) => {
    const p = Object.fromEntries(
      new Intl.DateTimeFormat("en-CA", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(now).map((x) => [x.type, x.value]),
    );
    return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), minute: Number(p.minute) };
  };
  try {
    return read(timeZone);
  } catch {
    return read("UTC");
  }
}

const pad = (n: number) => String(n).padStart(2, "0");
export const hhmm = (t: ClockTime) => `${pad(t.hour)}:${pad(t.minute)}`;
const hourLabel = (h: number) => `${pad(h)}:00`;

/**
 * How far a day's loaded orders reach on the store's clock: the time of the latest order loaded. Without order times (or when a time
 * does not fall in the last hour that has orders) it is the end of that hour. Null when the day has no orders loaded.
 */
export function lastOrderClock(hours: OrderHour[], day: string, timeZone: string): (ClockTime & { at: string | null }) | null {
  const own = hours.filter((h) => h.date === day && h.orders > 0);
  if (!own.length) return null;
  const lastHour = Math.max(...own.map((h) => h.hour));
  const at = own.map((h) => h.lastOrderAt).filter((x): x is string => Boolean(x)).sort((a, b) => new Date(a).getTime() - new Date(b).getTime()).pop() ?? null;
  if (at) {
    const c = storeClock(new Date(at), timeZone);
    if (c.date === day && c.hour === lastHour) return { hour: c.hour, minute: c.minute, at };
  }
  return { hour: lastHour, minute: 59, at };
}

/* ------------------------------------------------------------------ */
/* Comparison modes                                                    */
/* ------------------------------------------------------------------ */

export type CompareMode = "plan" | "lastWeek" | "fourWeeks" | "lastYear";

export const COMPARE_MODES: { id: CompareMode; label: string }[] = [
  { id: "plan", label: "The plan" },
  { id: "lastWeek", label: "Same weekday last week" },
  { id: "fourWeeks", label: "Average of the last four same weekdays" },
  { id: "lastYear", label: "Same day last year" },
];

/** The days whose own hours are the expectation in each mode (none for the plan). */
export function compareDates(mode: CompareMode, day: string): string[] {
  if (mode === "lastWeek") return sameWeekdaysBefore(day, 1);
  if (mode === "fourWeeks") return sameWeekdaysBefore(day, 4);
  if (mode === "lastYear") return [lastYearDay(day)];
  return [];
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** What the day is compared with, in the page's words. `used` are the reference days that have orders. */
export function compareLabel(mode: CompareMode, day: string, used: string[]): string {
  if (mode === "plan") return "the plan";
  const [first] = compareDates(mode, day);
  if (mode === "lastWeek") return `the same weekday last week (${first})`;
  if (mode === "lastYear") {
    const bfcm = bfcmReference(day);
    return bfcm ? `last year's ${bfcm.name} (${bfcm.date})` : `the same day last year (${first})`;
  }
  const name = `the last four ${WEEKDAYS[dayOfWeek(day)]}s`;
  return used.length >= 4 ? `the average of ${name}` : `the average of ${used.length} of ${name} (the others have no orders)`;
}

/**
 * The days whose hours the page needs for one day: the day itself and the four weeks before it (one read: last week, the last four same
 * weekdays), plus every reference day further back (last year's day, an event's day last year), each read on its own.
 */
export function daysToLoad(day: string, events: MarketingEvent[]): { from: string; to: string; extra: string[] } {
  const from = addDays(day, -28);
  const wanted = [...shapeCandidates(day, events).flatMap((c) => c.dates), ...COMPARE_MODES.flatMap((m) => compareDates(m.id, day))];
  return { from, to: day, extra: [...new Set(wanted.filter((d) => d < from || d > day))].sort() };
}

/* ------------------------------------------------------------------ */
/* Hours as facts                                                      */
/* ------------------------------------------------------------------ */

type Sums = Pick<OrderHour, "orderRevenue" | "newRevenue" | "returningRevenue" | "orders" | "newOrders" | "returningOrders" | "grossSales" | "discounts" | "shipping" | "tax">;
const SUM_KEYS: (keyof Sums)[] = ["orderRevenue", "newRevenue", "returningRevenue", "orders", "newOrders", "returningOrders", "grossSales", "discounts", "shipping", "tax"];
const zero = (): Sums => ({ orderRevenue: 0, newRevenue: 0, returningRevenue: 0, orders: 0, newOrders: 0, returningOrders: 0, grossSales: 0, discounts: 0, shipping: 0, tax: 0 });
const add = (into: Sums, s: Sums, k = 1) => {
  for (const key of SUM_KEYS) into[key] += s[key] * k;
  return into;
};
/** A day's rows as 24 hours (hours with no order are zero). */
function byHour(hours: OrderHour[]): Sums[] {
  const out = Array.from({ length: 24 }, zero);
  for (const h of hours) if (h.hour >= 0 && h.hour < 24) add(out[h.hour], h);
  return out;
}
/** The hours added up, each weighted (1 = the whole hour, 0 = left out). */
const weighted = (hours: Sums[], weights: number[]) => hours.reduce((t, s, h) => (weights[h] ? add(t, s, weights[h]) : t), zero());

/**
 * One hour (or any sum of hours) in the daily fact's shape, so the report's metrics are computed by the same code as every other
 * report. Only the order numbers have an hourly source: refunds, product costs, email, SMS and every ad channel stay at zero.
 */
export function hourFact(clientId: string, date: string, s: Sums): DailyFact {
  return {
    clientId,
    date,
    grossSales: s.grossSales,
    discounts: s.discounts,
    netSales: s.orderRevenue - s.shipping - s.tax,
    shippingCollected: s.shipping,
    tax: s.tax,
    newOrderRevenue: s.newRevenue,
    returningOrderRevenue: s.returningRevenue,
    newOrders: s.newOrders,
    returningOrders: s.returningOrders,
    refunds: 0,
    cogs: 0,
    cogsUnmappedSales: 0,
    emailRevenue: 0,
    emailCampaignRevenue: 0,
    emailFlowRevenue: 0,
    emailOrders: 0,
    emailSent: 0,
    channels: emptyTotals().channels,
  };
}

/* ------------------------------------------------------------------ */
/* Rows                                                                */
/* ------------------------------------------------------------------ */

/** done = loaded and over; partial = still open (orders may still be loading), shown but not judged; tocome = expectation only. */
export type HourState = "done" | "partial" | "tocome";

export interface HourlyCell {
  actual: number | null;
  expected: number | null;
  /** actual - expected. */
  gap: number | null;
  /** gap ÷ |expected|: the difference the tone is read from. */
  diff: number | null;
  tone: Tone;
  /** The column has no hourly source yet, so there is no actual to show. */
  noData: boolean;
}

export interface DayCell extends HourlyCell {
  /** The whole day's expectation: the day's target, or the reference day's total. */
  full: number | null;
  /** Today, for columns that add up: where the day ends at the pace so far (so far ÷ the share of the day elapsed). */
  heading: number | null;
}

export interface HourMarker {
  type: ActionType;
  name: string;
}
export interface HourMarkerAt extends HourMarker {
  hour: number;
}

export interface HourlyRow {
  hour: number;
  /** "09:00" */
  label: string;
  state: HourState;
  markers: HourMarker[];
  cells: Record<string, HourlyCell>;
}

export interface HourlyProgress {
  kind: "past" | "today" | "future";
  /** Today: how far the loaded orders reach. Null when nothing is loaded yet, and on other days. */
  asOf: ClockTime | null;
  states: HourState[];
  /** The part of each hour the loaded orders cover: 1, a fraction for the hour of the last order, 0 after it. */
  covered: number[];
  /** Today: the share of the day's expected revenue that falls before the last order loaded. Null when it cannot be told. */
  elapsedShare: number | null;
}

export interface HourlyResult {
  /** The grid's rows: per hour, or running totals in cumulative mode. */
  rows: HourlyRow[];
  /** Always per hour, for the readings. */
  hourRows: HourlyRow[];
  day: { label: string; cells: Record<string, DayCell> };
  progress: HourlyProgress;
  /** Some column has something to be compared with. */
  hasExpectation: boolean;
  /** The day has orders loaded. */
  hasOrders: boolean;
}

export interface HourlyInput {
  clientId: string;
  day: string;
  /** The store's clock now. */
  clock: StoreClock;
  /** On the store's today: how far the loaded orders reach (`lastOrderClock`); null when none is loaded. Ignored on other days. */
  asOf: ClockTime | null;
  /** The day's own hours. */
  hours: OrderHour[];
  specs: HourlySpec[];
  settings: ClientSettings;
  compare: CompareMode;
  /** Against the plan: the day's plan row (null = the day has no target), its ROAS targets and email / SMS shares, and the day's shape. */
  plan: PlanTargetDay | null;
  roasOf: RoasOf | null;
  mixOf: MixOf | null;
  shares: number[];
  /** Against other days: each reference day's hours. Days without orders are left out of the average. */
  reference: OrderHour[][];
  cumulative: boolean;
  markers: HourMarkerAt[];
}

/** Below this share of the day elapsed, "where the day is heading" would multiply a few orders by a large number, so none is given. */
export const MIN_ELAPSED_SHARE = 0.05;

const ONES = Array.from({ length: 24 }, () => 1);
const only = (hour: number) => Array.from({ length: 24 }, (_, h) => (h === hour ? 1 : 0));
const upTo = (hour: number) => Array.from({ length: 24 }, (_, h) => (h <= hour ? 1 : 0));

/** Which hours are over, open or to come, and how much of each the loaded orders cover. */
function progressOf(day: string, clock: StoreClock, asOf: ClockTime | null): Omit<HourlyProgress, "elapsedShare"> {
  if (day < clock.date) return { kind: "past", asOf: null, states: ONES.map(() => "done"), covered: [...ONES] };
  if (day > clock.date) return { kind: "future", asOf: null, states: ONES.map(() => "tocome"), covered: ONES.map(() => 0) };
  if (!asOf) return { kind: "today", asOf: null, states: ONES.map((_, h) => (h <= clock.hour ? "partial" : "tocome")), covered: ONES.map(() => 0) };
  const open = Math.max(clock.hour, asOf.hour);
  return {
    kind: "today",
    asOf,
    states: ONES.map((_, h) => (h < asOf.hour ? "done" : h <= open ? "partial" : "tocome")),
    covered: ONES.map((_, h) => (h < asOf.hour ? 1 : h === asOf.hour ? Math.min(1, (asOf.minute + 1) / 60) : 0)),
  };
}

function cellOf(spec: HourlySpec, actual: number | null, expected: number | null, judged: boolean): HourlyCell {
  if (spec.noHourly) return { actual: null, expected, gap: null, diff: null, tone: "neutral", noData: true };
  if (!judged || actual === null) return { actual, expected, gap: null, diff: null, tone: "neutral", noData: false };
  const c = compare(actual, expected, spec.direction);
  return { actual, expected, gap: expected === null ? null : actual - expected, diff: c.diff, tone: c.tone, noData: false };
}

export function buildHourly(a: HourlyInput): HourlyResult {
  const { settings } = a;
  const own = byHour(a.hours.filter((h) => h.date === a.day));
  const hasOrders = a.hours.some((h) => h.date === a.day && h.orders > 0);
  const base = progressOf(a.day, a.clock, hasOrders ? a.asOf : null);
  const valueOf = (spec: HourlySpec, s: Sums) => spec.value(aggregate([hourFact(a.clientId, a.day, s)]), settings);

  /** The expectation of a column over a weighting of the hours (1 = the whole hour). */
  let expected: (spec: HourlySpec, weights: number[]) => number | null;
  if (a.compare === "plan") {
    const totals = a.plan ? aggregatePlan([a.plan], a.roasOf ?? undefined, a.mixOf ?? undefined) : null;
    expected = (spec, weights) => {
      const goal = totals && spec.goal ? spec.goal(totals, settings) : null;
      if (goal === null || !spec.additive) return goal;
      return goal * weights.reduce((s, w, h) => s + w * (a.shares[h] ?? 0), 0);
    };
  } else {
    const days = a.reference.filter((d) => d.some((h) => h.orders > 0)).map(byHour);
    const mean = days.length ? ONES.map((_, h) => days.reduce((t, d) => add(t, d[h], 1 / days.length), zero())) : null;
    expected = (spec, weights) => (mean && !spec.noHourly ? valueOf(spec, weighted(mean, weights)) : null);
  }
  /** The actual of a column over whole hours. Nothing is loaded = nothing to show (not a zero). */
  const actual = (spec: HourlySpec, weights: number[]) => (hasOrders && !spec.noHourly ? valueOf(spec, weighted(own, weights)) : null);

  const markersAt = (hour: number): HourMarker[] => a.markers.filter((m) => m.hour === hour).map((m) => ({ type: m.type, name: m.name }));
  const build = (cumulative: boolean): HourlyRow[] =>
    ONES.map((_, hour) => {
      const state = base.states[hour];
      const weights = cumulative ? upTo(hour) : only(hour);
      const cells: Record<string, HourlyCell> = {};
      for (const spec of a.specs) cells[spec.key] = cellOf(spec, state === "tocome" ? null : actual(spec, weights), expected(spec, weights), state === "done");
      return { hour, label: hourLabel(hour), state, markers: markersAt(hour), cells };
    });
  const hourRows = build(false);
  const rows = a.cumulative ? build(true) : hourRows;

  const dayCells: Record<string, DayCell> = {};
  for (const spec of a.specs) {
    const full = expected(spec, ONES);
    if (base.kind === "future") {
      dayCells[spec.key] = { ...cellOf(spec, null, full, false), full, heading: null };
      continue;
    }
    const soFar = base.kind === "past" ? full : base.asOf ? expected(spec, base.covered) : null;
    const cell = cellOf(spec, actual(spec, ONES), soFar, true);
    const share = base.kind === "today" && spec.additive && soFar !== null && full !== null && full > 0 ? soFar / full : null;
    const heading = cell.actual !== null && share !== null && share >= MIN_ELAPSED_SHARE ? cell.actual / share : null;
    dayCells[spec.key] = { ...cell, full, heading };
  }

  const rev = hourlySpec("rev");
  const revFull = rev ? expected(rev, ONES) : null;
  const revSoFar = rev && base.kind === "today" && base.asOf ? expected(rev, base.covered) : null;
  return {
    rows,
    hourRows,
    day: { label: base.kind === "past" ? "Day" : base.kind === "today" ? "Day so far" : "Day (expected)", cells: dayCells },
    progress: { ...base, elapsedShare: revFull !== null && revFull > 0 && revSoFar !== null ? revSoFar / revFull : null },
    hasExpectation: Object.values(dayCells).some((c) => c.full !== null),
    hasOrders,
  };
}

/* ------------------------------------------------------------------ */
/* Sends, events and markers                                           */
/* ------------------------------------------------------------------ */

/** A send planned in the calendar: an email or SMS event that starts on the day. */
export interface PlannedSend {
  type: "email" | "sms";
  name: string;
  /** "HH:MM" on the store's clock; null = time not set, so it is never counted as already out. */
  time: string | null;
  hour: number | null;
}

const isSend = (e: MarketingEvent) => e.type === "email" || e.type === "sms";
const endOf = (e: MarketingEvent) => (e.endDate && e.endDate >= e.date ? e.endDate : e.date);
const nameOf = (e: MarketingEvent) => e.name || TYPE_LABEL[e.type] || e.type;
const hourOf = (time: string) => Number(time.slice(0, 2));

/** The day's planned sends: timed ones first, in clock order, then the ones with no time. */
export function sendsOn(events: MarketingEvent[], day: string): PlannedSend[] {
  return events
    .filter((e) => isSend(e) && e.date === day)
    .map((e): PlannedSend => ({ type: e.type as "email" | "sms", name: nameOf(e), time: e.sendTime ?? null, hour: e.sendTime ? hourOf(e.sendTime) : null }))
    .sort((x, y) => (x.time === null ? 1 : 0) - (y.time === null ? 1 : 0) || (x.time ?? "").localeCompare(y.time ?? "") || x.name.localeCompare(y.name));
}

/** Events that start on the day with a time, on their hour: a send as an email or SMS marker, anything else as a calendar event. */
export function eventMarkers(events: MarketingEvent[], day: string): HourMarkerAt[] {
  return events
    .filter((e) => e.date === day && e.sendTime)
    .sort((x, y) => (x.sendTime ?? "").localeCompare(y.sendTime ?? "") || nameOf(x).localeCompare(nameOf(y)))
    .map((e) => ({ hour: hourOf(e.sendTime!), type: isSend(e) ? (e.type as "email" | "sms") : "event", name: nameOf(e) }));
}

/** What is listed above the grid: the events the day sits in that have no hour on it, and the day's sends with no time set. */
export function dayListing(events: MarketingEvent[], day: string): { events: { type: string; name: string }[]; untimed: PlannedSend[] } {
  const listed = events
    .filter((e) => e.date <= day && endOf(e) >= day && !(e.date === day && (e.sendTime || isSend(e))))
    .sort((x, y) => x.date.localeCompare(y.date) || nameOf(x).localeCompare(nameOf(y)))
    .map((e) => ({ type: TYPE_LABEL[e.type] ?? e.type, name: nameOf(e) }));
  return { events: listed, untimed: sendsOn(events, day).filter((s) => s.time === null) };
}

/** Meta campaigns that got new ads, on the hour they were created. */
export function launchMarkers(launches: MetaLaunchHour[], day: string): HourMarkerAt[] {
  return launches.filter((l) => l.date === day).map((l) => ({ hour: l.hour, type: "meta", name: `${l.ads} new ad${l.ads === 1 ? "" : "s"} in ${l.campaign}` }));
}

const MARKER_WORD: Record<ActionType, string> = { event: "Event", email: "Email", sms: "SMS", meta: "Meta" };
export const markerText = (m: HourMarker) => `${MARKER_WORD[m.type]}: ${m.name}`;

/* ------------------------------------------------------------------ */
/* What a send did                                                     */
/* ------------------------------------------------------------------ */

export interface Reading {
  actual: number | null;
  expected: number | null;
  gap: number | null;
}

export interface SendReading {
  send: PlannedSend;
  /** The send's hour and the two after it (fewer at the end of the day). */
  hours: number[];
  /** All of those hours are over and loaded. */
  complete: boolean;
  revenue: Reading;
  returning: Reading;
}

/**
 * For each send with a time: the three hours from the send against the same hours' expectation, for total and returning revenue.
 * It is a reading against the day's shape, not an incrementality test. Needs the per-hour rows (`hourRows`) with the "rev" and
 * "retRev" columns. A send whose hours are not over has no numbers yet.
 */
export function sendReadings(hourRows: HourlyRow[], sends: PlannedSend[]): SendReading[] {
  return sends
    .filter((s) => s.hour !== null)
    .map((send) => {
      const hours = [0, 1, 2].map((i) => (send.hour as number) + i).filter((h) => h <= 23);
      const rows = hours.map((h) => hourRows[h]);
      const complete = rows.every((r) => r && r.state === "done");
      const read = (key: string): Reading => {
        const cells = rows.map((r) => r?.cells[key]);
        if (!complete || cells.some((c) => !c || c.actual === null)) return { actual: null, expected: null, gap: null };
        const actual = cells.reduce((s, c) => s + (c!.actual as number), 0);
        const expected = cells.some((c) => c!.expected === null) ? null : cells.reduce((s, c) => s + (c!.expected as number), 0);
        return { actual, expected, gap: expected === null ? null : actual - expected };
      };
      return { send, hours, complete, revenue: read("rev"), returning: read("retRev") };
    });
}

/* ------------------------------------------------------------------ */
/* The Plan B signal                                                   */
/* ------------------------------------------------------------------ */

export interface PlanB {
  /** The column that is behind: returning revenue is looked at first, then total revenue. */
  metric: "retRev" | "rev";
  /** Expected so far less actual so far. */
  behindBy: number;
  diff: number;
  /** Planned sends whose time has passed on the store's clock. */
  out: PlannedSend[];
  /** Planned sends still to come today. */
  toGo: PlannedSend[];
  /** Planned sends with no time set: never counted as out. */
  untimed: PlannedSend[];
  /** What a Plan B has to add by midnight: the day's expectation less where the day is heading at the pace so far (the gap so far when no heading can be given). */
  toClose: number;
}

/**
 * On the store's today, when returning revenue (or else total revenue) is more than 10% behind its expectation so far: which planned
 * sends are out, which are still to go, and the amount to close by midnight. Null when the day is on track, over, or has nothing to
 * be compared with. The page only says it; it sends nothing.
 */
export function planBSignal(result: HourlyResult, clock: StoreClock, sends: PlannedSend[]): PlanB | null {
  if (result.progress.kind !== "today" || !result.progress.asOf) return null;
  for (const metric of ["retRev", "rev"] as const) {
    const c = result.day.cells[metric];
    if (!c || c.tone !== "bad" || c.gap === null || c.diff === null) continue;
    const now = hhmm(clock);
    const timed = sends.filter((s) => s.time !== null);
    const behindBy = -c.gap;
    return {
      metric,
      behindBy,
      diff: c.diff,
      out: timed.filter((s) => (s.time as string) <= now),
      toGo: timed.filter((s) => (s.time as string) > now),
      untimed: sends.filter((s) => s.time === null),
      toClose: c.full !== null && c.heading !== null ? Math.max(0, c.full - c.heading) : behindBy,
    };
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* The sentences above the grid                                        */
/* ------------------------------------------------------------------ */

export interface HourlySummary {
  /** Where the day stands, the running ratios, and the Plan B sentence when there is one. */
  lines: string[];
  planB: PlanB | null;
  readings: SendReading[];
  /** One sentence per send that is out: what its three hours did. */
  readingLines: string[];
}

const sendWord = (s: PlannedSend) => `${s.time ? `${s.time} ` : ""}${s.type === "email" ? "Email" : "SMS"} "${s.name}"`;
const sendList = (xs: PlannedSend[]) => xs.map(sendWord).join(", ");
const pct = (diff: number | null) => (diff === null ? "" : ` (${formatDiff(diff)})`);

export function summarise(a: { result: HourlyResult; clock: StoreClock; sends: PlannedSend[]; compare: CompareMode; compareLabel: string; currency: Currency }): HourlySummary {
  const { result, currency } = a;
  const { kind, asOf } = result.progress;
  const money = (v: number) => formatValue(v, "currency0", currency);
  const money2 = (v: number) => formatValue(v, "currency2", currency);
  const signed = (v: number) => `${v >= 0 ? "+" : "-"}${money(Math.abs(v))}`;
  const rev = result.day.cells.rev;
  const aov = result.day.cells.aov;
  const orders = result.day.cells.orders?.actual ?? null;
  const fromOrders = orders === null ? "" : ` from ${formatValue(orders, "number", currency)} order${orders === 1 ? "" : "s"}`;
  const expectedDay = rev && rev.full !== null ? ` Expected revenue for the day: ${money(rev.full)}.` : "";
  const lines: string[] = [];

  if (!rev) return { lines, planB: null, readings: [], readingLines: [] };
  if (kind === "future") lines.push(`This day has not started yet.${expectedDay}`);
  else if (rev.actual === null) lines.push(kind === "today" ? `No orders are loaded for today yet.${expectedDay}` : "No orders are loaded for this day.");
  else if (kind === "past") {
    lines.push(rev.expected === null ? `The day closed at ${money(rev.actual)} revenue${fromOrders}. There is nothing to compare it with.` : `The day closed at ${money(rev.actual)} revenue against ${money(rev.expected)} expected${pct(rev.diff)}.`);
    if (aov && aov.actual !== null && aov.expected !== null) lines.push(`AOV was ${money2(aov.actual)} against ${money2(aov.expected)} expected${pct(aov.diff)}.`);
  } else {
    const to = `To ${asOf ? hhmm(asOf) : hhmm(a.clock)} (the last order loaded)`;
    if (rev.expected === null) lines.push(`${to}: revenue ${money(rev.actual)}${fromOrders}. There is nothing to compare it with.`);
    else {
      const against = rev.full === null ? "" : a.compare === "plan" ? `a target of ${money(rev.full)}` : a.compare === "fourWeeks" ? `${money(rev.full)}, ${a.compareLabel}` : `${money(rev.full)} on ${a.compareLabel}`;
      const tail = rev.full === null ? "." : rev.heading !== null ? `, heading for ${money(rev.heading)} against ${against}.` : `. Too early to say where the day is heading; the whole day stands at ${against}.`;
      lines.push(`${to}: revenue ${money(rev.actual)} of ${money(rev.expected)} expected${pct(rev.diff)}${tail}`);
    }
    if (aov && aov.actual !== null && aov.expected !== null) lines.push(`AOV so far is ${money2(aov.actual)} against ${money2(aov.expected)} expected${pct(aov.diff)}.`);
  }

  const planB = planBSignal(result, a.clock, a.sends);
  if (planB) {
    const n = (count: number, one: string, many: string) => `${count} planned send${count === 1 ? ` ${one}` : `s ${many}`}`;
    const close = `${money(planB.toClose)} to close by midnight`;
    const noTime = planB.untimed.length ? `${n(planB.untimed.length, "has", "have")} no time set (${sendList(planB.untimed)}), so the page cannot tell whether ${planB.untimed.length === 1 ? "it is" : "they are"} out.` : "";
    let rest: string;
    if (planB.toGo.length) rest = `${n(planB.toGo.length, "is", "are")} still to go today (${sendList(planB.toGo)}).${noTime ? ` ${noTime}` : ""}`;
    else if (planB.untimed.length) rest = `${planB.out.length ? `${n(planB.out.length, "is", "are")} out (${sendList(planB.out)}). ` : ""}${noTime} ${close[0].toUpperCase()}${close.slice(1)}.`;
    else if (planB.out.length) rest = `${planB.out.length === 1 ? "The planned send is" : planB.out.length === 2 ? "Both planned sends are" : `All ${planB.out.length} planned sends are`} out (${sendList(planB.out)}): nothing planned is left today, ${close}.`;
    else rest = `No send is planned today in the calendar: ${close}.`;
    lines.push(`${planB.metric === "retRev" ? "Returning revenue" : "Revenue"} is ${money(planB.behindBy)} behind${pct(planB.diff)}. ${rest}`);
  }

  // Only sends that are out get a reading: one still to come sits on its hour in the grid.
  const now = hhmm(a.clock);
  const out = kind === "past" ? a.sends : kind === "today" ? a.sends.filter((s) => s.time !== null && s.time <= now) : [];
  const readings = sendReadings(result.hourRows, out);
  const readingLines = readings.map((r) => {
    const who = `${r.send.type === "email" ? "Email" : "SMS"} "${r.send.name}" at ${r.send.time}`;
    const span = `${r.hours.length} hour${r.hours.length === 1 ? "" : "s"}`;
    if (!r.complete || r.revenue.actual === null) return kind === "past" ? `${who}: no orders are loaded for its hours.` : `${who}: its three hours are not over yet.`;
    if (r.revenue.gap === null) return `${who}: ${money(r.revenue.actual)} revenue in the ${span} from the send (nothing to compare it with).`;
    return `${who}: ${signed(r.revenue.gap)} revenue against expected over ${span}${r.returning.gap === null ? "" : ` (returning revenue ${signed(r.returning.gap)})`}.`;
  });
  return { lines, planB, readings, readingLines };
}

/* ------------------------------------------------------------------ */
/* Download and chart                                                  */
/* ------------------------------------------------------------------ */

const STATE_WORD: Record<HourState, string> = { done: "done", partial: "partial", tocome: "to come" };

/** The grid as rows for a CSV: every hour and the Day row, with actual, expected and difference (in %) for each column given. */
export function hourlyCsv(result: HourlyResult, specs: HourlySpec[]): { head: string[]; rows: (string | number | null)[][] } {
  const head = ["Hour", "Status", "What happened", ...specs.flatMap((s) => [s.label, `${s.label} expected`, `${s.label} difference %`])];
  const numbers = (cells: Record<string, HourlyCell>) => specs.flatMap((s) => [cells[s.key]?.actual ?? null, cells[s.key]?.expected ?? null, cells[s.key]?.diff == null ? null : (cells[s.key].diff as number) * 100]);
  return {
    head,
    rows: [...result.rows.map((r) => [r.label, STATE_WORD[r.state], r.markers.map(markerText).join(" · "), ...numbers(r.cells)]), [result.day.label, "", "", ...numbers(result.day.cells)]],
  };
}

/**
 * The hours as the Calendar Report's chart rows: done hours draw the actual, an hour to come draws its expectation as the projection,
 * and a partial hour is left out of the line (half an hour of orders would read as a drop).
 */
export function toChartRows(day: string, rows: HourlyRow[]): CalendarRow[] {
  return rows.map((r) => ({
    date: `${day}T${pad(r.hour)}`,
    label: r.label,
    projected: r.state === "tocome",
    actions: r.markers.map((m) => ({ date: day, type: m.type, name: m.name })),
    cells: Object.fromEntries(Object.entries(r.cells).map(([key, c]) => [key, { actual: r.state === "tocome" ? c.expected : r.state === "partial" ? null : c.actual, goal: c.expected, tone: c.tone, diff: c.diff }])),
  }));
}
