import { addDays, dayOfWeek, startOfMonth, startOfQuarter, startOfWeek } from "../dates";

export type GroupBy = "daily" | "weekly" | "biweekly" | "monthly" | "quarterly" | "yearly" | "dow";

export const GROUP_LABELS: Record<GroupBy, string> = {
  daily: "Daily",
  weekly: "Weekly",
  biweekly: "Bi-Weekly",
  monthly: "Monthly",
  quarterly: "Quarterly",
  yearly: "Yearly",
  dow: "Day Of Week",
};

export interface Bucket {
  key: string;
  label: string;
  dates: string[];
}

const DOW = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Groups an ordered list of days into report rows. Weeks start on Monday; bi-weeks pair consecutive weeks. */
export function groupDates(dates: string[], by: GroupBy): Bucket[] {
  const map = new Map<string, Bucket>();
  const first = dates[0];
  for (const d of dates) {
    let key: string;
    let label: string;
    switch (by) {
      case "daily":
        key = d;
        label = `${d} ${DOW[dayOfWeek(d)].slice(0, 3)}`;
        break;
      case "weekly": {
        const s = startOfWeek(d);
        key = s;
        label = `${s} – ${addDays(s, 6)}`;
        break;
      }
      case "biweekly": {
        const s = startOfWeek(d);
        const s0 = startOfWeek(first);
        const n = Math.floor((Date.parse(s) - Date.parse(s0)) / (14 * 86400000));
        const start = addDays(s0, n * 14);
        key = start;
        label = `${start} – ${addDays(start, 13)}`;
        break;
      }
      case "monthly":
        key = startOfMonth(d);
        label = d.slice(0, 7);
        break;
      case "quarterly":
        key = startOfQuarter(d);
        label = `${d.slice(0, 4)} Q${Math.floor((Number(d.slice(5, 7)) - 1) / 3) + 1}`;
        break;
      case "yearly":
        key = d.slice(0, 4);
        label = key;
        break;
      case "dow": {
        const w = (dayOfWeek(d) + 6) % 7; // Monday first
        key = String(w);
        label = DOW[dayOfWeek(d)];
        break;
      }
    }
    const b = map.get(key) ?? { key, label, dates: [] };
    b.dates.push(d);
    map.set(key, b);
  }
  return [...map.values()].sort((a, b) => a.key.localeCompare(b.key));
}

