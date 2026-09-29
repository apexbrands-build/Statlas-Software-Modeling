import { addDays, dayOfWeek, diffDays, eachDay, todayLocal } from "../dates";
import type {
  ChannelKey,
  Client,
  ClientSettings,
  DailyFact,
  PlanTargetDay,
  PlanVersion,
} from "../types";
import { CHANNEL_KEYS } from "../types";
import type { Repository } from "./types";

/* ------------------------------------------------------------------ */
/* Deterministic pseudo-random helpers (same date -> same numbers)     */
/* ------------------------------------------------------------------ */

function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Uniform [0,1) derived from a key. */
function rnd(key: string): number {
  let a = hash(key) + 0x6d2b79f5;
  a = Math.imul(a ^ (a >>> 15), a | 1);
  a ^= a + Math.imul(a ^ (a >>> 7), a | 61);
  return ((a ^ (a >>> 14)) >>> 0) / 4294967296;
}

/** Multiplicative noise around 1 with spread `s`. */
const noise = (key: string, s: number) => 1 + (rnd(key) - 0.5) * 2 * s;

/* ------------------------------------------------------------------ */
/* Fictional clients                                                   */
/* ------------------------------------------------------------------ */

interface Profile {
  client: Client;
  dailyOrders: number;
  aov: number;
  newShare: number;
  cac: number;
  yearlyGrowth: number;
  refundRate: number;
  cogsRate: number;
  shippingRate: number;
  taxRate: number;
  emailShare: number;
  emailListSize: number;
  mix: Record<ChannelKey, number>;
  platformRoas: Record<ChannelKey, number>;
  settings: Omit<ClientSettings, "clientId">;
}

const DEFAULT_MULTIPLIERS: Record<ChannelKey, number> = {
  google_nonbrand: 0.75,
  google_brand: 0.3,
  meta_acquisition: 1.2,
  meta_returning: 0.6,
  pinterest: 0.3,
};

const DTC = ["Online Store", "Shop"];

const baseSettings = (over: Partial<Omit<ClientSettings, "clientId">> = {}): Omit<ClientSettings, "clientId"> => ({
  multipliers: { ...DEFAULT_MULTIPLIERS },
  otherVariablePct: 6,
  shippingCostPerOrder: 3.2,
  monthlyFixedCosts: 0,
  attributionWindow: "7d_click",
  revenueDefinition: "order_revenue",
  brandCampaignKeyword: "branded",
  excludeBrandFromAmer: false,
  excludeMetaReturningFromAmer: false,
  dtcChannels: [...DTC],
  ...over,
});

const PROFILES: Profile[] = [
  {
    client: { id: "northwind", name: "Northwind Jewellery", currency: "GBP", timezone: "Europe/London", podId: "pod-1" },
    dailyOrders: 95,
    aov: 82,
    newShare: 0.62,
    cac: 44,
    yearlyGrowth: 0.14,
    refundRate: 0.075,
    cogsRate: 0.17,
    shippingRate: 0.055,
    taxRate: 0.1,
    emailShare: 0.22,
    emailListSize: 120_000,
    mix: { google_nonbrand: 0.17, google_brand: 0.05, meta_acquisition: 0.65, meta_returning: 0.11, pinterest: 0.02 },
    platformRoas: { google_nonbrand: 2.6, google_brand: 9, meta_acquisition: 1.6, meta_returning: 3, pinterest: 4 },
    settings: baseSettings({ monthlyFixedCosts: 9000 }),
  },
  {
    client: { id: "kettle", name: "Kettle & Co Coffee", currency: "USD", timezone: "America/New_York", podId: "pod-1" },
    dailyOrders: 210,
    aov: 46,
    newShare: 0.48,
    cac: 26,
    yearlyGrowth: 0.09,
    refundRate: 0.03,
    cogsRate: 0.34,
    shippingRate: 0.07,
    taxRate: 0.06,
    emailShare: 0.31,
    emailListSize: 260_000,
    mix: { google_nonbrand: 0.22, google_brand: 0.08, meta_acquisition: 0.6, meta_returning: 0.1, pinterest: 0 },
    platformRoas: { google_nonbrand: 2.9, google_brand: 8, meta_acquisition: 1.7, meta_returning: 3.4, pinterest: 3 },
    settings: baseSettings({ otherVariablePct: 8, shippingCostPerOrder: 5.4, multipliers: { ...DEFAULT_MULTIPLIERS, meta_acquisition: 1.1 } }),
  },
  {
    client: { id: "meridian", name: "Meridian Outdoors", currency: "USD", timezone: "America/Denver", podId: "pod-2" },
    dailyOrders: 60,
    aov: 168,
    newShare: 0.71,
    cac: 92,
    yearlyGrowth: 0.22,
    refundRate: 0.09,
    cogsRate: 0.41,
    shippingRate: 0.04,
    taxRate: 0.07,
    emailShare: 0.14,
    emailListSize: 70_000,
    mix: { google_nonbrand: 0.28, google_brand: 0.06, meta_acquisition: 0.55, meta_returning: 0.09, pinterest: 0.02 },
    platformRoas: { google_nonbrand: 2.8, google_brand: 7, meta_acquisition: 1.5, meta_returning: 3, pinterest: 3.5 },
    settings: baseSettings({ otherVariablePct: 4, shippingCostPerOrder: 9, monthlyFixedCosts: 22000, dtcChannels: ["Online Store"] }),
  },
];

const profileOf = (id: string) => {
  const p = PROFILES.find((x) => x.client.id === id);
  if (!p) throw new Error(`Unknown client ${id}`);
  return p;
};

/* ------------------------------------------------------------------ */
/* Expected (noise-free) day, used for both actuals and plan targets   */
/* ------------------------------------------------------------------ */

const MONTH_SEASON = [1.05, 1.15, 1.0, 0.95, 1.0, 0.95, 0.9, 0.95, 1.0, 1.05, 1.75, 1.45];
const DOW_EFFECT = [1.12, 1.02, 0.94, 0.92, 0.96, 1.0, 1.08]; // Sun..Sat
const ORIGIN = "2024-01-01";

function blackFridayBoost(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  if (m !== 11) return 1;
  // Last Friday of November.
  let lastFri = 30;
  while (dayOfWeek(`${y}-11-${String(lastFri).padStart(2, "0")}`) !== 5) lastFri--;
  const off = d - lastFri;
  if (off === 0) return 2.4;
  if (off > 0 && off <= 3) return 1.8;
  if (off < 0 && off >= -3) return 1.2;
  return 1;
}

interface Expected {
  orders: number;
  newOrders: number;
  newAov: number;
  retAov: number;
  spend: number;
  season: number;
}

function expectedDay(p: Profile, date: string): Expected {
  const month = Number(date.slice(5, 7)) - 1;
  const season = MONTH_SEASON[month] * blackFridayBoost(date);
  const years = diffDays(ORIGIN, date) / 365;
  const trend = Math.pow(1 + p.yearlyGrowth, years);
  const orders = p.dailyOrders * season * DOW_EFFECT[dayOfWeek(date)] * trend;
  const newShare = Math.min(0.85, p.newShare * (1 + (season - 1) * 0.15));
  const newOrders = orders * newShare;
  const newAov = p.aov * 0.95;
  const retAov = p.aov * 1.08;
  const cac = p.cac * (1 + (season - 1) * 0.12) * (1 + years * 0.04);
  return { orders, newOrders, newAov, retAov, spend: newOrders * cac, season };
}

/* ------------------------------------------------------------------ */
/* Actual facts                                                        */
/* ------------------------------------------------------------------ */

function buildFact(p: Profile, date: string): DailyFact {
  const id = p.client.id;
  const e = expectedDay(p, date);
  const k = (s: string) => `${id}|${date}|${s}`;

  const newOrders = Math.max(1, Math.round(e.newOrders * noise(k("newo"), 0.14)));
  const retOrders = Math.max(0, Math.round((e.orders - e.newOrders) * noise(k("reto"), 0.16)));
  const newRev = newOrders * e.newAov * noise(k("newa"), 0.04);
  const retRev = retOrders * e.retAov * noise(k("reta"), 0.05);
  const orderRev = newRev + retRev;

  const shipping = orderRev * p.shippingRate * noise(k("ship"), 0.05);
  const tax = orderRev * p.taxRate;
  const netSales = orderRev - shipping - tax;
  const refunds = orderRev * p.refundRate * noise(k("ref"), 0.55);
  const cogs = netSales * p.cogsRate * noise(k("cogs"), 0.03);

  const totalSpend = e.spend * noise(k("spend"), 0.1);
  const channels = {} as DailyFact["channels"];
  for (const ch of CHANNEL_KEYS) {
    const spend = totalSpend * p.mix[ch] * noise(k(`sp-${ch}`), 0.12);
    const platformRevenue = spend * p.platformRoas[ch] * noise(k(`pr-${ch}`), 0.14);
    const platAov = p.aov * noise(k(`pa-${ch}`), 0.08);
    channels[ch] = { spend, platformRevenue, platformPurchases: platformRevenue / platAov };
  }

  const dow = dayOfWeek(date);
  const campaignDay = dow === 2 || dow === 4; // Tue / Thu sends
  const emailSent = campaignDay ? p.emailListSize * noise(k("sent"), 0.15) : p.emailListSize * 0.03;
  const emailRevenue = orderRev * p.emailShare * noise(k("email"), 0.18);
  const campaignShare = campaignDay ? 0.6 : 0.3;

  return {
    clientId: id,
    date,
    netSales,
    shippingCollected: shipping,
    tax,
    newOrderRevenue: newRev,
    returningOrderRevenue: retRev,
    newOrders,
    returningOrders: retOrders,
    refunds,
    cogs,
    emailRevenue,
    emailCampaignRevenue: emailRevenue * campaignShare,
    emailFlowRevenue: emailRevenue * (1 - campaignShare),
    emailOrders: Math.round(emailRevenue / (p.aov * 1.05)),
    emailSent,
    channels,
  };
}

const factCache = new Map<string, DailyFact>();

function factFor(clientId: string, date: string): DailyFact {
  const key = `${clientId}|${date}`;
  let f = factCache.get(key);
  if (!f) {
    f = buildFact(profileOf(clientId), date);
    factCache.set(key, f);
  }
  return f;
}

/* ------------------------------------------------------------------ */
/* Plan targets                                                        */
/* ------------------------------------------------------------------ */

const PLAN_REVENUE_UPLIFT = 1.07;
const PLAN_SPEND_UPLIFT = 1.05;

function buildPlanDay(p: Profile, planId: string, date: string): PlanTargetDay {
  const e = expectedDay(p, date);
  const orders = e.orders * PLAN_REVENUE_UPLIFT;
  const newOrders = e.newOrders * PLAN_REVENUE_UPLIFT;
  const newRevenue = newOrders * e.newAov;
  const returningRevenue = (orders - newOrders) * e.retAov;
  const orderRevenue = newRevenue + returningRevenue;
  const spend = e.spend * PLAN_SPEND_UPLIFT;
  const netSales = orderRevenue * (1 - p.shippingRate - p.taxRate);
  const s = p.settings;
  const cm =
    netSales -
    orderRevenue * p.refundRate -
    s.shippingCostPerOrder * orders -
    netSales * p.cogsRate -
    (s.otherVariablePct / 100) * netSales -
    spend;
  const spendByChannel: Partial<Record<ChannelKey, number>> = {};
  for (const ch of CHANNEL_KEYS) spendByChannel[ch] = spend * p.mix[ch];
  return {
    planId,
    clientId: p.client.id,
    date,
    orderRevenue,
    newRevenue,
    returningRevenue,
    orders,
    newOrders,
    spend,
    cm,
    spendByChannel,
  };
}

/* ------------------------------------------------------------------ */
/* Repository                                                          */
/* ------------------------------------------------------------------ */

const SETTINGS_KEY = (id: string) => `apex.settings.${id}`;

function readOverrides(id: string): Partial<ClientSettings> | null {
  try {
    if (typeof window === "undefined") return null;
    const raw = window.localStorage.getItem(SETTINGS_KEY(id));
    return raw ? (JSON.parse(raw) as Partial<ClientSettings>) : null;
  } catch {
    return null;
  }
}

function defaultSettings(clientId: string): ClientSettings {
  return { clientId, ...profileOf(clientId).settings, multipliers: { ...profileOf(clientId).settings.multipliers } };
}

export class SeedRepository implements Repository {
  async listClients(): Promise<Client[]> {
    return PROFILES.map((p) => p.client);
  }

  async getSettings(clientId: string): Promise<ClientSettings> {
    const base = defaultSettings(clientId);
    const o = readOverrides(clientId);
    if (!o) return base;
    return { ...base, ...o, clientId, multipliers: { ...base.multipliers, ...(o.multipliers ?? {}) } };
  }

  async saveSettings(settings: ClientSettings): Promise<void> {
    try {
      window.localStorage.setItem(SETTINGS_KEY(settings.clientId), JSON.stringify(settings));
    } catch {
      /* storage unavailable: settings apply for this session only */
    }
  }

  async resetSettings(clientId: string): Promise<ClientSettings> {
    try {
      window.localStorage.removeItem(SETTINGS_KEY(clientId));
    } catch {
      /* ignore */
    }
    return defaultSettings(clientId);
  }

  async getFacts(clientId: string, from: string, to: string): Promise<DailyFact[]> {
    const last = await this.getLastDataDate(clientId);
    const end = to < last ? to : last;
    if (from > end) return [];
    return eachDay(from, end).map((d) => factFor(clientId, d));
  }

  async getLastDataDate(_clientId?: string): Promise<string> {
    void _clientId;
    return addDays(todayLocal(), -1);
  }

  async listPlans(clientId: string): Promise<PlanVersion[]> {
    return [{ id: `${clientId}-2026-official`, clientId, name: "2026 Official Plan", isDefault: true }];
  }

  async getPlanTargets(clientId: string, planId: string, from: string, to: string): Promise<PlanTargetDay[]> {
    const p = profileOf(clientId);
    return eachDay(from, to).map((d) => buildPlanDay(p, planId, d));
  }
}
