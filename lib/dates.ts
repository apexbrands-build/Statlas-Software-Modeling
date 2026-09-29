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

export type CompareModeName = "plan" | "yoy" | "prev";

/** Range whose actuals are the comparison baseline for `mode`, given the data-clamped current range. */
export function comparisonRange(mode: CompareModeName, cur: Range): Range {
  if (mode === "yoy") return { from: addYears(cur.from, -1), to: addYears(cur.to, -1) };
  const len = diffDays(cur.from, cur.to) + 1;
  if (mode === "prev") return { from: addDays(cur.from, -len), to: addDays(cur.from, -1) };
  return cur; // plan: targets for the same days
}
