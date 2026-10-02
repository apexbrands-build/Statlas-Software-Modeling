import type { DayMultipliers, EventDayResult, EventSettings, MarketingEvent } from "@/lib/planning/events";
import type { FillSource } from "@/lib/planning/history";
import type { PlanMonth, PlanMonthInputs } from "@/lib/planning/types";
import type { Client, ClientSettings, DailyFact, PlanSeasonality, PlanTargetDay, PlanVersion } from "@/lib/types";

/** Everything the plan steps share. The editor owns the draft; steps only call the setters. */
export interface PlanCtx {
  plan: PlanVersion;
  client: Client;
  settings: ClientSettings;
  months: PlanMonth[];
  /** Daily rows generated live from the draft, per month key. */
  rows: Record<string, PlanTargetDay[]>;
  seasonality: PlanSeasonality;
  setSeasonality: (s: PlanSeasonality) => void;
  /** Changes one month's inputs (ignored when the month is locked). With `create`, a month with no plan yet is started from recent actuals first. */
  editInputs: (month: string, fn: (i: PlanMonthInputs) => PlanMonthInputs, create?: boolean) => void;
  setLocked: (month: string, locked: boolean) => void;
  fill: (month: string, source: FillSource | "clear" | "blank", growthPct?: number) => string | null;
  history: { facts: DailyFact[]; lastData: string; loading: boolean };
  /** Weekday pattern calculated from this client's Shopify data (null if not enough history). */
  historySeasonality: PlanSeasonality | null;
  /** Marketing calendar of the client (all years) and what the Event Effect Model measured on its past days. */
  events: MarketingEvent[];
  eventResults: EventDayResult[];
  eventSettings: EventSettings;
  setEventSettings: (s: EventSettings) => void;
  /** Multipliers per date applied to the plan (empty when events are switched off). */
  eventMults: Record<string, DayMultipliers>;
  /** Adds or updates events (saved straight away). Returns an error message or null. */
  saveEvents: (list: (Omit<MarketingEvent, "id" | "clientId"> & { id?: string })[]) => Promise<string | null>;
  removeEvent: (id: string) => Promise<string | null>;
}
