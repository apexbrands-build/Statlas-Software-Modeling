/**
 * The shape of a day for the Hourly Report: each hour's share of the day's revenue, taken from reference days.
 * An hour's expectation is the day's target times that hour's share (spec 2026-11-27-hourly-report-design.md, "The numbers").
 *
 * Which days give the shape, in this order:
 *  1. Thanksgiving to Cyber Monday: the day at the same distance from Thanksgiving last year (those days repeat from year to year).
 *  2. A day inside another calendar event (an offer, a launch, a holiday): the same event type's day at the same offset last year.
 *  3. Any other day: the four same weekdays before it.
 *  4. None of them has orders: an even split.
 * The first rule whose reference days have revenue is used, and the page names it.
 */
import { addDays, addYears, bfcmRange, dayOfWeek, diffDays } from "../dates";
import { TYPE_LABEL, typeGroup, type MarketingEvent } from "../planning/events";

export type ShapeKind = "bfcm" | "event" | "weekdays" | "even";
export type ShapeChoice = "auto" | ShapeKind;
export const SHAPE_KINDS: ShapeKind[] = ["bfcm", "event", "weekdays", "even"];

/** A rule that applies to the day and the reference days it would read. */
export interface ShapeCandidate {
  kind: ShapeKind;
  dates: string[];
  /** In the page's words, as it reads after "the shape of": "last year's Black Friday (2025-11-28)", "the last four Fridays", "an even split". */
  label: string;
}

export interface DayShape {
  kind: ShapeKind;
  /** The reference days the shares were read from (the ones with orders). */
  dates: string[];
  label: string;
  /** 24 shares, hour 0 first, adding up to exactly 1. */
  shares: number[];
  /** True when the rule asked for (the first that applies, or the one picked by hand) had no orders and another one was used. */
  fellBack: boolean;
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const BFCM_NAMES = ["Thanksgiving", "Black Friday", "Black Friday weekend Saturday", "Black Friday weekend Sunday", "Cyber Monday"];
/** How far from the same date last year an event of the same type may start and still count as "the same event". */
const EVENT_MATCH_DAYS = 45;

/** Thanksgiving of a year: the day before the Black Friday of the date picker's BFCM presets. */
const thanksgiving = (year: number) => addDays(bfcmRange(year).from, -1);

/** For Thanksgiving to Cyber Monday: the day at the same distance from Thanksgiving a year earlier. Null on any other day. */
export function bfcmReference(date: string): { date: string; name: string } | null {
  const year = Number(date.slice(0, 4));
  const offset = diffDays(thanksgiving(year), date);
  if (offset < 0 || offset >= BFCM_NAMES.length) return null;
  return { date: addDays(thanksgiving(year - 1), offset), name: BFCM_NAMES[offset] };
}

/** "The same day last year": the same calendar date, or on a BFCM day the day at the same distance from Thanksgiving. */
export function lastYearDay(date: string): string {
  return bfcmReference(date)?.date ?? addYears(date, -1);
}

const mainEvent = (e: MarketingEvent) => {
  const g = typeGroup(e.type);
  return g !== "comms" && g !== "initiative";
};
const endOf = (e: MarketingEvent) => (e.endDate && e.endDate >= e.date ? e.endDate : e.date);
const nameOf = (e: MarketingEvent) => (e.name && e.name !== e.type ? e.name : (TYPE_LABEL[e.type] ?? e.type));

/**
 * For a day inside a calendar event (offers, launches, holidays; not sends, comms or initiatives): the day at the same offset inside
 * last year's event of the same type. Last year's event is the one of that type starting nearest to the same date a year back
 * (within 45 days), and it must have run long enough to hold that offset. The shortest event the day sits in is tried first.
 */
export function eventReference(date: string, events: MarketingEvent[]): { date: string; name: string; day: number; days: number } | null {
  const around = events
    .filter((e) => mainEvent(e) && e.date <= date && endOf(e) >= date)
    .sort((a, b) => diffDays(a.date, endOf(a)) - diffDays(b.date, endOf(b)) || (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) || a.id.localeCompare(b.id));
  for (const e of around) {
    const offset = diffDays(e.date, date);
    const lastStart = addYears(e.date, -1);
    const before = events
      .filter((x) => x.id !== e.id && x.type === e.type && Math.abs(diffDays(lastStart, x.date)) <= EVENT_MATCH_DAYS)
      .sort((a, b) => Math.abs(diffDays(lastStart, a.date)) - Math.abs(diffDays(lastStart, b.date)) || (a.date < b.date ? -1 : 1));
    for (const l of before) {
      const ref = addDays(l.date, offset);
      if (ref <= endOf(l)) return { date: ref, name: nameOf(l), day: offset + 1, days: diffDays(e.date, endOf(e)) + 1 };
    }
  }
  return null;
}

/** The `n` same weekdays before a day, nearest first. */
export function sameWeekdaysBefore(date: string, n = 4): string[] {
  return Array.from({ length: n }, (_, i) => addDays(date, -7 * (i + 1)));
}

const weekdayName = (date: string) => WEEKDAYS[dayOfWeek(date)];

/** The rules that apply to a day, in the order they are tried. The last one is always the even split. */
export function shapeCandidates(date: string, events: MarketingEvent[]): ShapeCandidate[] {
  const out: ShapeCandidate[] = [];
  const bfcm = bfcmReference(date);
  if (bfcm) out.push({ kind: "bfcm", dates: [bfcm.date], label: `last year's ${bfcm.name} (${bfcm.date})` });
  const event = eventReference(date, events);
  if (event) out.push({ kind: "event", dates: [event.date], label: `${event.days > 1 ? `day ${event.day} of ` : ""}last year's ${event.name} (${event.date})` });
  out.push({ kind: "weekdays", dates: sameWeekdaysBefore(date), label: `the last four ${weekdayName(date)}s` });
  out.push({ kind: "even", dates: [], label: "an even split" });
  return out;
}

const total = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/**
 * Shares of a total that add up to exactly 1 when summed hour by hour: every hour is its part of the total, and the last hour that has
 * any takes what is left of 1 (a difference in the last decimal place of a number that small). Summed in order, the result is exactly 1.
 */
function exact(values: number[], all: number): number[] {
  let last = -1;
  values.forEach((v, i) => {
    if (v > 0) last = i;
  });
  let given = 0;
  return values.map((v, i) => {
    if (i > last) return 0;
    if (i === last) return Math.max(0, 1 - given);
    const share = v / all;
    given += share;
    return share;
  });
}

/** Each hour's share of a day's revenue (24 numbers adding up to exactly 1); null when there is no revenue to read a shape from. */
export function hourShares(revenueByHour: number[]): number[] | null {
  const v = Array.from({ length: 24 }, (_, h) => Math.max(0, Number.isFinite(revenueByHour[h]) ? revenueByHour[h] : 0));
  const all = total(v);
  if (!(all > 0)) return null;
  return exact(v, all);
}

export const EVEN_SHARES: number[] = exact(Array.from({ length: 24 }, () => 1), 24);

/**
 * The shape to use. `revenueOf` gives a reference day's revenue by hour (null or all zero = no orders that day). On "auto" the rules are
 * tried in order; a rule picked by hand is used when it applies to the day (otherwise "auto"), and falls to an even split when its days
 * have no orders. Several reference days are pooled: their revenue is added up hour by hour, so a busier day weighs more.
 */
export function pickShape(candidates: ShapeCandidate[], revenueOf: (date: string) => number[] | null, choice: ShapeChoice): DayShape {
  const picked = choice === "auto" ? undefined : candidates.find((c) => c.kind === choice);
  const tryOrder = picked ? [picked] : candidates;
  for (const [i, c] of tryOrder.entries()) {
    if (c.kind === "even") return { kind: "even", dates: [], label: c.label, shares: EVEN_SHARES, fellBack: i > 0 };
    const withOrders = c.dates.filter((d) => total(revenueOf(d) ?? []) > 0);
    const pooled = Array.from({ length: 24 }, (_, h) => withOrders.reduce((s, d) => s + (revenueOf(d)?.[h] ?? 0), 0));
    const shares = hourShares(pooled);
    if (!shares) continue;
    const label = c.kind === "weekdays" && withOrders.length < c.dates.length ? `${withOrders.length} of ${c.label} (the others have no orders)` : c.label;
    return { kind: c.kind, dates: withOrders, label, shares, fellBack: i > 0 };
  }
  return { kind: "even", dates: [], label: "an even split", shares: EVEN_SHARES, fellBack: true };
}
