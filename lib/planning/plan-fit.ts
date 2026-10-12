import { aggregate, amerSpend } from "../metrics";
import type { ClientSettings, DailyFact } from "../types";
import { BEYOND_GAMMA, type NewCustomerSettings } from "./models";
import { curveAmer, fitNewCustomerModel, monthlyAmerIndex, type Curve, type DayPoint, type FitResult } from "./new-customer";

type FitSettings = Pick<NewCustomerSettings, "fitKind" | "beyondHistory" | "actualizeFrom" | "recentWeight">;

/** One point per day: the spend that counts toward aMER (per the client's settings) and the day's new-customer order revenue. */
export function dayPoints(facts: DailyFact[], settings: ClientSettings): DayPoint[] {
  return facts.map((f) => ({ date: f.date, spend: amerSpend(aggregate([f]), settings), newRevenue: f.newOrderRevenue }));
}

/** The fit the New Customer model screen shows: its saved curve kind, guardrail and actualization. `recent` overrides the saved actualization. */
export function fitFromPoints(points: DayPoint[], dow: number[], s: FitSettings, recent: { from: string; weight: number } | null): FitResult | null {
  return fitNewCustomerModel(points, dow, { kind: s.fitKind, recent, guard: BEYOND_GAMMA[s.beyondHistory ?? "standard"] });
}

/** The New Customer model's fit for a client, exactly as saved in the plan's model settings. Null with under about 60 usable days. */
export function fitPlanModel(facts: DailyFact[], settings: ClientSettings, dow: number[], s: FitSettings): FitResult | null {
  const recent = s.actualizeFrom ? { from: s.actualizeFrom, weight: s.recentWeight } : null;
  return fitFromPoints(dayPoints(facts, settings), dow, s, recent);
}

/** How much better or worse than the curve the month's calendar month usually performs (1 = no seasonal data). */
export function seasonIndex(fit: Pick<FitResult, "curve" | "used">, month: string): number {
  return monthlyAmerIndex(fit.used, fit.curve).index[Number(month.slice(5, 7)) - 1] ?? 1;
}

/**
 * Plan aMER against the aMER the model gives at the month's acquisition spend and seasonality (no "% over model" added), as a percentage.
 * Null without spend or without a plan aMER.
 */
export function aboveModelPct(planAmer: number | null, monthlyAcqSpend: number, days: number, curve: Curve, seasonIdx: number): number | null {
  if (!planAmer || monthlyAcqSpend <= 0 || days <= 0) return null;
  const model = curveAmer(curve, monthlyAcqSpend / days) * seasonIdx;
  return model > 0 ? (planAmer / model - 1) * 100 : null;
}

/** A month is a stretch when it sits further above the model than the over-model % the strategist chose for it. */
export function isStretchMonth(aboveModel: number | null, overModelPct: number): boolean {
  return aboveModel !== null && aboveModel > overModelPct;
}
