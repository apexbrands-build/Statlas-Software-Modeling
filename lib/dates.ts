// All dates are 'YYYY-MM-DD' strings handled in UTC to avoid timezone drift.

const MS_DAY = 86_400_000;

export function parse(d: string): Date {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day));
}

export function fmt(dt: Date): string {
  return dt.toISOString().slice(0, 10);
}

export function addDays(d: string, n: number): string {
  return fmt(new Date(parse(d).getTime() + n * MS_DAY));
}

export function diffDays(a: string, b: string): number {
  return Math.round((parse(b).getTime() - parse(a).getTime()) / MS_DAY);
}

/** Same calendar date n years earlier (Feb 29 -> Feb 28). */
export function addYears(d: string, n: number): string {
  const [y, m, day] = d.split("-").map(Number);
  const target = new Date(Date.UTC(y + n, m - 1, day));
  if (target.getUTCMonth() !== m - 1) return fmt(new Date(Date.UTC(y + n, m, 0)));
  return fmt(target);
}

export function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

export function startOfMonth(d: string): string {
  return d.slice(0, 8) + "01";
}

export function endOfMonth(d: string): string {
  const [y, m] = d.split("-").map(Number);
  return fmt(new Date(Date.UTC(y, m, 0)));
}

export function addMonths(d: string, n: number): string {
  const [y, m] = d.split("-").map(Number);
  return fmt(new Date(Date.UTC(y, m - 1 + n, 1)));
}

export function dayOfWeek(d: string): number {
  return parse(d).getUTCDay(); // 0 = Sun
}

export function min(a: string, b: string): string {
  return a < b ? a : b;
}

export function todayLocal(): string {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
}

export function shortLabel(d: string): string {
  const dt = parse(d);
  return dt.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

export interface Range {
  from: string;
  to: string;
}

export type CompareModeName = "plan" | "yoy" | "prev" | "custom";

/** Range whose actuals are the comparison baseline for `mode`, given the data-clamped current range. */
export function comparisonRange(mode: CompareModeName, cur: Range, custom?: Range): Range {
  if (mode === "custom" && custom) return custom;
  if (mode === "yoy") return { from: addYears(cur.from, -1), to: addYears(cur.to, -1) };
  const len = diffDays(cur.from, cur.to) + 1;
  if (mode === "prev") return { from: addDays(cur.from, -len), to: addDays(cur.from, -1) };
  return cur; // plan: targets for the same days
}

/* ---------- calendar helpers for the date picker and monthly trend windows ---------- */

export function monthKey(d: string): string {
  return d.slice(0, 4) + d.slice(5, 7); // 202601
}

/** Month keys (YYYYMM) from the month of `from` through the month of `to`. */
export function monthKeys(from: string, to: string): string[] {
  const out: string[] = [];
  let d = startOfMonth(from);
  while (d <= to) {
    out.push(monthKey(d));
    d = addMonths(d, 1);
  }
  return out;
}

export function startOfWeek(d: string, weekStartsOn = 1): string {
  const dow = dayOfWeek(d);
  return addDays(d, -((dow - weekStartsOn + 7) % 7));
}

export function startOfQuarter(d: string): string {
  const m = Number(d.slice(5, 7));
  const qm = Math.floor((m - 1) / 3) * 3 + 1;
  return `${d.slice(0, 4)}-${String(qm).padStart(2, "0")}-01`;
}

export function endOfQuarter(d: string): string {
  return endOfMonth(addMonths(startOfQuarter(d), 2));
}

/** Black Friday (day after the 4th Thursday of November) through Cyber Monday. */
export function bfcmRange(year: number): Range {
  const nov1 = `${year}-11-01`;
  const dow = dayOfWeek(nov1); // 0 Sun
  const firstThu = addDays(nov1, (4 - dow + 7) % 7);
  const blackFriday = addDays(firstThu, 22);
  return { from: blackFriday, to: addDays(blackFriday, 3) };
}

/** US-style label used by the picker: 1/1/2026 */
export function usDate(d: string): string {
  const [y, m, day] = d.split("-").map(Number);
  return `${m}/${day}/${y}`;
}
