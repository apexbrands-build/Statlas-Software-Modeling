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
}
