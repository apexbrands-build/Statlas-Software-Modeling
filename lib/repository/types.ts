import type { PlanChange, PlanMonth } from "../planning/types";
import type { CampaignDay, Client, ClientSettings, DailyFact, PlanTargetDay, PlanVersion } from "../types";

/**
 * Data access boundary. The dashboard only talks to this interface.
 * Seed implementation today; a Supabase implementation replaces it later without UI changes.
 */
export interface Repository {
  listClients(): Promise<Client[]>;
  getSettings(clientId: string): Promise<ClientSettings>;
  saveSettings(settings: ClientSettings): Promise<void>;
  resetSettings(clientId: string): Promise<ClientSettings>;
  getFacts(clientId: string, from: string, to: string): Promise<DailyFact[]>;
  /** Campaign-level ad rows (Paid Media reports). */
  getCampaignDays(clientId: string, from: string, to: string): Promise<CampaignDay[]>;
  /** Last day with actual data (inclusive). */
  getLastDataDate(clientId: string): Promise<string>;
  listPlans(clientId: string): Promise<PlanVersion[]>;
  getPlanTargets(clientId: string, planId: string, from: string, to: string): Promise<PlanTargetDay[]>;
  /** The first plan of a client and year becomes the default. */
  createPlan(clientId: string, input: { name: string; year: number; description?: string }): Promise<PlanVersion>;
  /** Saves name, description and seasonality. */
  updatePlan(plan: PlanVersion, changeNote?: string): Promise<void>;
  deletePlan(plan: PlanVersion): Promise<void>;
  /** Makes this the plan Home and the reports compare against (one per client and year). */
  setDefaultPlan(plan: PlanVersion): Promise<void>;
  getPlanMonths(planId: string): Promise<PlanMonth[]>;
  /** Saves month inputs/status/lock and replaces the month's daily rows with `rows` (empty = no targets that month). */
  savePlanMonths(plan: PlanVersion, items: { month: PlanMonth; rows: PlanTargetDay[] }[], changeNote: string): Promise<void>;
  getPlanChanges(planId: string): Promise<PlanChange[]>;
}
