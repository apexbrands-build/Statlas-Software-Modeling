import { addDays, dayOfWeek, eachDay } from "../dates";
import type { DailyFact } from "../types";
import { isBfcm } from "./history";

/**
 * Marketing calendar and the Event Effect Model.
 *
 * Every event day is compared with the ordinary days around it (±28 days, event days and Black Friday week left out,
 * weekday-adjusted). That gives four lifts per event day: spend, new revenue, returning revenue and aMER.
 * Lifts are grouped by event type (Mother's Day has its own, Promotion has its own...). A future event gets the lifts of its type:
 * Conservative / Typical / Strong = lower quartile / median / upper quartile of that type's own past days, pulled toward the
 * all-events figure when the type has few days. The plan then reshapes each month (hotter event days, compressed others);
 * the month totals stay what the models say.
 */

export type EventGroup = "offer" | "launch" | "holiday" | "comms" | "bfcm" | "initiative";

export const GROUP_LABELS: Record<EventGroup, string> = {
  offer: "Offers",
  launch: "Launches",
  holiday: "Holidays and seasonal",
  comms: "Comms only",
  bfcm: "BFCM and Cyber Week",
  initiative: "Initiatives (logged, no effect yet)",
};

export const EVENT_TYPES: { id: string; label: string; group: EventGroup }[] = [
  { id: "promotion", label: "Promotion", group: "offer" },
  { id: "sitewide", label: "Sitewide", group: "offer" },
  { id: "clearance", label: "Clearance", group: "offer" },
  { id: "free_shipping", label: "Free Shipping", group: "offer" },
  { id: "gift_with_purchase", label: "Gift with Purchase", group: "offer" },
  { id: "product_launch", label: "Product Launch", group: "launch" },
  { id: "restock", label: "Restock", group: "launch" },
  { id: "vip_drop", label: "VIP Drop", group: "launch" },
  { id: "seasonal_event", label: "Seasonal Event", group: "holiday" },
  { id: "valentines_day", label: "Valentine's Day", group: "holiday" },
  { id: "international_womens_day", label: "International Women's Day", group: "holiday" },
  { id: "easter", label: "Easter", group: "holiday" },
  { id: "mothers_day", label: "Mother's Day", group: "holiday" },
  { id: "nurses_week", label: "Nurses' Week", group: "holiday" },
  { id: "memorial_day", label: "Memorial Day", group: "holiday" },
  { id: "fathers_day", label: "Father's Day", group: "holiday" },
  { id: "independence_day", label: "Independence Day", group: "holiday" },
  { id: "prime_day", label: "Prime Day", group: "holiday" },
  { id: "labor_day", label: "Labor Day", group: "holiday" },
  { id: "halloween", label: "Halloween", group: "holiday" },
  { id: "christmas", label: "Christmas", group: "holiday" },
  { id: "boxing_day", label: "Boxing Day", group: "holiday" },
  { id: "shipping_cutoff", label: "Shipping Cutoff Day", group: "holiday" },
  { id: "black_friday", label: "Black Friday", group: "bfcm" },
  { id: "cyber_monday", label: "Cyber Monday", group: "bfcm" },
  { id: "cyber_week", label: "Cyber Week excl BFCM", group: "bfcm" },
  { id: "email", label: "Email", group: "comms" },
  { id: "sms", label: "SMS", group: "comms" },
  { id: "influencer", label: "Influencer", group: "comms" },
  { id: "pr", label: "PR", group: "comms" },
  { id: "other", label: "Other", group: "comms" },
  { id: "initiative", label: "Initiative (creative batch, funnel, test)", group: "initiative" },
];

export const TYPE_LABEL: Record<string, string> = Object.fromEntries(EVENT_TYPES.map((t) => [t.id, t.label]));
export const typeGroup = (id: string): EventGroup => EVENT_TYPES.find((t) => t.id === id)?.group ?? "comms";

export interface MarketingEvent {
  id: string;
  clientId: string;
  date: string;
  /** Inclusive; same as `date` for a one-day event. */
  endDate: string;
  type: string;
  name: string;
  promo?: string;
  product?: string;
  audience?: string;
  segmentSize?: number | null;
  notes?: string;
  source: "manual" | "import" | "klaviyo" | "sms";
}

export const eventDays = (e: MarketingEvent): string[] => eachDay(e.date, e.endDate >= e.date ? e.endDate : e.date);

/* ------------------------------------------------------------------ */
/* Measuring past event days                                           */
/* ------------------------------------------------------------------ */

export interface Lifts {
  spend: number;
  newRevenue: number;
  returning: number;
  amer: number;
}

export interface EventDayResult {
  eventId: string;
  name: string;
  type: string;
  date: string;
  lifts: Lifts;
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  return n === 0 ? NaN : n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
};

export function quantile(xs: number[], q: number): number {
  const s = [...xs].sort((a, b) => a - b);
  if (!s.length) return NaN;
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

/** Facts used for the comparison: spend that counts toward aMER is passed in so the aMER lift matches the New Customer model. */
export interface DayFact {
  date: string;
  spend: number;
  newRevenue: number;
  returning: number;
}

export const toDayFacts = (facts: DailyFact[], spendOf: (f: DailyFact) => number): DayFact[] =>
  facts.map((f) => ({ date: f.date, spend: spendOf(f), newRevenue: f.newOrderRevenue, returning: f.returningOrderRevenue }));

/**
 * Lifts of every past event day against ordinary days within ±`window` days (weekday-adjusted by `dowOffsets`, % with index 0 = Sunday).
 * An event day needs at least 5 ordinary days around it, otherwise it is skipped.
 */
export function measureEventDays(days: DayFact[], events: MarketingEvent[], dowOffsets: number[], lastData: string, window = 28): EventDayResult[] {
  const eventDates = new Set<string>();
  for (const e of events) for (const d of eventDays(e)) eventDates.add(d);
  const byDate = new Map(days.map((d) => [d.date, d]));
  const adj = (date: string, v: number) => v / Math.max(0.2, 1 + (dowOffsets[dayOfWeek(date)] ?? 0) / 100);
  const out: EventDayResult[] = [];
  for (const e of events) {
    if (typeGroup(e.type) === "initiative") continue;
    for (const date of eventDays(e)) {
      const d = byDate.get(date);
      if (!d || date > lastData || d.spend <= 0) continue;
      const near: DayFact[] = [];
      for (let k = -window; k <= window; k++) {
        const x = byDate.get(addDays(date, k));
        if (k !== 0 && x && !eventDates.has(x.date) && !isBfcm(x.date) && x.spend > 0) near.push(x);
      }
      if (near.length < 5) continue;
      const base = {
        spend: median(near.map((x) => adj(x.date, x.spend))),
        newRevenue: median(near.map((x) => adj(x.date, x.newRevenue))),
        returning: median(near.map((x) => adj(x.date, x.returning))),
      };
      if (!(base.spend > 0 && base.newRevenue > 0 && base.returning > 0)) continue;
      const spend = adj(date, d.spend) / base.spend;
      const newRevenue = adj(date, d.newRevenue) / base.newRevenue;
      const returning = adj(date, d.returning) / base.returning;
      out.push({ eventId: e.id, name: e.name, type: e.type, date, lifts: { spend, newRevenue, returning, amer: newRevenue / spend } });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Category table                                                      */
/* ------------------------------------------------------------------ */

export type Stance = "conservative" | "typical" | "strong";
export const STANCE_LABELS: Record<Stance, string> = { conservative: "Conservative", typical: "Typical", strong: "Strong" };
const STANCE_Q: Record<Stance, number> = { conservative: 0.25, typical: 0.5, strong: 0.75 };

export interface MetricStats {
  median: number;
  mean: number;
  /** 5th and 95th percentile: 9 out of 10 past event days landed between these. */
  low: number;
  high: number;
  q25: number;
  q75: number;
}

export interface CategoryStats {
  type: string;
  /** Number of event days measured. */
  n: number;
  /** Number of separate events (a 5-day sale counts as one). */
  events: number;
  spend: MetricStats;
  newRevenue: MetricStats;
  returning: MetricStats;
  amer: MetricStats;
  lowConfidence: boolean;
}

const stats = (xs: number[]): MetricStats => ({ median: median(xs), mean: xs.reduce((a, b) => a + b, 0) / xs.length, low: quantile(xs, 0.05), high: quantile(xs, 0.95), q25: quantile(xs, 0.25), q75: quantile(xs, 0.75) });

export function categoryStats(results: EventDayResult[], type: string | "all"): CategoryStats | null {
  const rows = type === "all" ? results : results.filter((r) => r.type === type);
  if (!rows.length) return null;
  return {
    type,
    n: rows.length,
    events: new Set(rows.map((r) => r.eventId)).size,
    spend: stats(rows.map((r) => r.lifts.spend)),
    newRevenue: stats(rows.map((r) => r.lifts.newRevenue)),
    returning: stats(rows.map((r) => r.lifts.returning)),
    amer: stats(rows.map((r) => r.lifts.amer)),
    lowConfidence: new Set(rows.map((r) => r.eventId)).size < 3,
  };
}

export function allCategoryStats(results: EventDayResult[]): { all: CategoryStats | null; byType: CategoryStats[] } {
  const types = [...new Set(results.map((r) => r.type))];
  return {
    all: categoryStats(results, "all"),
    byType: types.map((t) => categoryStats(results, t)!).sort((a, b) => b.n - a.n),
  };
}

const K_POOL = 5;

/** Lifts for a future event of `type` at a stance: the type's own quartile, pulled toward the all-events figure when it has few days. */
export function liftsFor(type: string, stance: Stance, results: EventDayResult[]): (Lifts & { known: boolean }) {
  const own = categoryStats(results, type);
  const all = categoryStats(results, "all");
  const none = { spend: 1, newRevenue: 1, returning: 1, amer: 1, known: false };
  if (typeGroup(type) === "initiative") return none;
  if (!own && !all) return none;
  const q = (s: CategoryStats | null, m: keyof Lifts): number => {
    if (!s) return 1;
    const x = s[m];
    return STANCE_Q[stance] === 0.5 ? x.median : STANCE_Q[stance] < 0.5 ? x.q25 : x.q75;
  };
  const blend = (m: keyof Lifts) => {
    const n = own?.n ?? 0;
    const mine = q(own, m);
    const pool = q(all, m);
    // a type with no history of its own gets the all-events figure, shrunk halfway to "no effect"
    if (!own) return 1 + (pool - 1) * 0.5;
    return (n * mine + K_POOL * pool) / (n + K_POOL);
  };
  return { spend: blend("spend"), newRevenue: blend("newRevenue"), returning: blend("returning"), amer: blend("amer"), known: !!own };
}

/* ------------------------------------------------------------------ */
/* Applying events to a plan                                           */
/* ------------------------------------------------------------------ */

export interface EventPlanItem {
  stance: Stance;
  /** Typed lifts (as multipliers, 1.2 = +20%) that beat the model for this event. */
  override?: Partial<Lifts>;
  /** Left out of the plan altogether. */
  off?: boolean;
}

export interface EventSettings {
  /** Master switch: events reshape the plan's days. */
  apply: boolean;
  /** Default stance for events without their own. */
  stance: Stance;
  perEvent: Record<string, EventPlanItem>;
}

export const DEFAULT_EVENT_SETTINGS: EventSettings = { apply: true, stance: "typical", perEvent: {} };

export interface DayMultipliers {
  spend: number;
  amer: number;
  returning: number;
  /** The event(s) behind it, for display. */
  label: string;
}

const MAIN_GROUPS: EventGroup[] = ["offer", "launch", "holiday", "bfcm"];

/**
 * Multipliers per date for the given events. When several events overlap on a day the strongest main event (offer, launch,
 * holiday, BFCM) sets the lift; comms-only events (email, SMS...) only count when no main event runs that day.
 */
export function dayMultipliers(events: MarketingEvent[], settings: EventSettings, results: EventDayResult[]): Record<string, DayMultipliers> {
  const byDate = new Map<string, { e: MarketingEvent; l: Lifts; main: boolean }[]>();
  for (const e of events) {
    const item = settings.perEvent[e.id];
    if (item?.off || typeGroup(e.type) === "initiative") continue;
    const base = liftsFor(e.type, item?.stance ?? settings.stance, results);
    const l: Lifts = { spend: item?.override?.spend ?? base.spend, newRevenue: item?.override?.newRevenue ?? base.newRevenue, returning: item?.override?.returning ?? base.returning, amer: item?.override?.amer ?? base.amer };
    for (const d of eventDays(e)) byDate.set(d, [...(byDate.get(d) ?? []), { e, l, main: MAIN_GROUPS.includes(typeGroup(e.type)) }]);
  }
  const out: Record<string, DayMultipliers> = {};
  byDate.forEach((list, date) => {
    const mains = list.filter((x) => x.main);
    const pool = mains.length ? mains : list;
    const top = pool.reduce((a, b) => (b.l.newRevenue > a.l.newRevenue ? b : a));
    out[date] = { spend: top.l.spend, amer: top.l.amer, returning: top.l.returning, label: list.map((x) => x.e.name || TYPE_LABEL[x.e.type]).join(", ") };
  });
  return out;
}

/* ------------------------------------------------------------------ */
/* CSV import                                                          */
/* ------------------------------------------------------------------ */

export const CSV_TEMPLATE = "date,end_date,type,name,promo,product,audience,segment_size\n2026-11-24,2026-11-30,Black Friday,BFCM 2026,25% off sitewide,,All subscribers,\n2026-12-12,,Email,Gifting guide,,,VIP,12000\n";

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === "," || c === "\t" || c === ";") {
      out.push(cur.trim());
      cur = "";
    } else cur += c;
  }
  out.push(cur.trim());
  return out;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Finds the event type id for free text ("Mothers Day", "black friday"); unknown text becomes "other". */
export function matchType(text: string): string {
  const t = norm(text);
  if (!t) return "other";
  const hit = EVENT_TYPES.find((x) => norm(x.label) === t || norm(x.id) === t) ?? EVENT_TYPES.find((x) => t.includes(norm(x.label).slice(0, 8)) && norm(x.label).length > 4);
  return hit?.id ?? "other";
}

const toIso = (s: string): string | null => {
  const t = s.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/); // dd/mm/yyyy (the UK/EU way, as in the calendar)
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return null;
};

export interface CsvResult {
  events: Omit<MarketingEvent, "id" | "clientId">[];
  errors: string[];
}

/** Parses a pasted or uploaded marketing calendar. Columns are found by header name (date, end_date, type, name, promo, product, audience, segment_size). */
export function parseEventCsv(text: string): CsvResult {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const errors: string[] = [];
  if (lines.length < 2) return { events: [], errors: ["Add a header row and at least one event."] };
  const head = splitCsvLine(lines[0]).map(norm);
  const col = (...names: string[]) => head.findIndex((h) => names.includes(h));
  const ci = { date: col("date", "startdate", "start"), end: col("enddate", "end", "todate"), type: col("type", "category", "eventtype"), name: col("name", "title", "eventname", "event"), promo: col("promo", "promotion", "offer"), product: col("product"), audience: col("audience", "audiencedescription"), seg: col("segmentsize", "segment", "size") };
  if (ci.date < 0) return { events: [], errors: ["The header row needs a 'date' column."] };
  const events: CsvResult["events"] = [];
  lines.slice(1).forEach((line, i) => {
    const c = splitCsvLine(line);
    const date = toIso(c[ci.date] ?? "");
    if (!date) {
      errors.push(`Row ${i + 2}: date '${c[ci.date] ?? ""}' not understood (use YYYY-MM-DD or DD/MM/YYYY).`);
      return;
    }
    const end = ci.end >= 0 ? toIso(c[ci.end] ?? "") : null;
    const type = ci.type >= 0 ? matchType(c[ci.type] ?? "") : "other";
    const name = (ci.name >= 0 ? c[ci.name] : "") || TYPE_LABEL[type];
    const seg = ci.seg >= 0 ? Number((c[ci.seg] ?? "").replace(/[, ]/g, "")) : NaN;
    events.push({ date, endDate: end && end >= date ? end : date, type, name, promo: (ci.promo >= 0 && c[ci.promo]) || undefined, product: (ci.product >= 0 && c[ci.product]) || undefined, audience: (ci.audience >= 0 && c[ci.audience]) || undefined, segmentSize: Number.isFinite(seg) ? seg : null, source: "import" });
  });
  return { events, errors };
}

/* ------------------------------------------------------------------ */
/* Suggestions: unlabelled spike days                                  */
/* ------------------------------------------------------------------ */

export interface Suggestion {
  date: string;
  endDate: string;
  /** Total order revenue over the days ÷ what ordinary days would have given. */
  lift: number;
}

/** Runs of days where order revenue is ≥ `minLift` times the ordinary weekday-adjusted level and no event is registered. */
export function suggestEvents(days: DayFact[], events: MarketingEvent[], dowOffsets: number[], from: string, lastData: string, minLift = 1.4): Suggestion[] {
  const registered = new Set<string>();
  for (const e of events) for (const d of eventDays(e)) registered.add(d);
  const byDate = new Map(days.map((d) => [d.date, d]));
  const adj = (date: string, v: number) => v / Math.max(0.2, 1 + (dowOffsets[dayOfWeek(date)] ?? 0) / 100);
  const spikes: { date: string; lift: number }[] = [];
  for (const d of days) {
    if (d.date < from || d.date > lastData || registered.has(d.date) || isBfcm(d.date)) continue;
    const near: number[] = [];
    for (let k = -28; k <= 28; k++) {
      const x = byDate.get(addDays(d.date, k));
      if (k !== 0 && x && !registered.has(x.date) && !isBfcm(x.date)) near.push(adj(x.date, x.newRevenue + x.returning));
    }
    if (near.length < 14) continue;
    const base = median(near);
    const lift = base > 0 ? adj(d.date, d.newRevenue + d.returning) / base : 0;
    if (lift >= minLift) spikes.push({ date: d.date, lift });
  }
  const out: Suggestion[] = [];
  for (const s of spikes) {
    const last = out[out.length - 1];
    if (last && addDays(last.endDate, 1) === s.date) {
      last.endDate = s.date;
      last.lift = Math.max(last.lift, s.lift);
    } else out.push({ date: s.date, endDate: s.date, lift: s.lift });
  }
  return out.sort((a, b) => (a.date < b.date ? 1 : -1));
}
