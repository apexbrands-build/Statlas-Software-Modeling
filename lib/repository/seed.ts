import { addDays, dayOfWeek, diffDays, eachDay, todayLocal } from "../dates";
import { aggregateAds, aggregateFormats, type CreativePage, type CreativeQuery } from "../creative/aggregate";
import type { FormatTotals, WowWindows } from "../creative/best-creatives";
import { demoAdRows, demoCreativeHistory, demoCreativeMonth } from "../creative/demo";
import type { CreativeDay, CreativeHistory, LaunchedAd } from "../creative/types";
import type { OrderChannel } from "../order-channels";
import type { AovData } from "../reports/aov";
import type { FirstProductRow } from "../reports/first-product";
import type {
  CampaignDay,
  ChannelKey,
  Client,
  ClientSettings,
  DailyFact,
  PlanScenario,
  PlanTargetDay,
  PlanVersion,
  StretchGoal,
} from "../types";
import { CHANNEL_KEYS } from "../types";
import { defaultExtra } from "../defaults";
import type { MarketingEvent } from "../planning/events";
import type { CohortStat, ModelKind, SavedModel } from "../planning/models";
import type { CohortRow } from "../planning/returning";
import type { PlanChange, PlanMonth } from "../planning/types";
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
  smsShare: number;
  smsListSize: number;
  mix: Partial<Record<ChannelKey, number>>;
  platformRoas: Partial<Record<ChannelKey, number>>;
  settings: Omit<ClientSettings, "clientId">;
}

const DEFAULT_MULTIPLIERS: Partial<Record<ChannelKey, number>> = {
  google_nonbrand: 0.65,
  google_brand: 0.15,
  meta_acquisition: 1.2,
  meta_returning: 0.6,
  pinterest: 0.3,
};

const DTC = ["Online Store", "Shop"];

const baseSettings = (over: Partial<Omit<ClientSettings, "clientId">> = {}): Omit<ClientSettings, "clientId"> => ({
  multipliers: { ...DEFAULT_MULTIPLIERS },
  otherVariablePct: 6,
  cogsFallbackPct: 0,
  cogsFlatRate: false,
  excludedOrderTags: [],
  extra: defaultExtra(),
  deliveryCostPerOrder: 1.2,
  monthlyFixedCosts: 0,
  attributionWindow: "7d_click",
  revenueDefinition: "order_revenue",
  brandCampaignKeyword: "brand",
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
    smsShare: 0.06,
    smsListSize: 40_000,
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
    smsShare: 0.09,
    smsListSize: 90_000,
    mix: { google_nonbrand: 0.22, google_brand: 0.08, meta_acquisition: 0.6, meta_returning: 0.1, pinterest: 0 },
    platformRoas: { google_nonbrand: 2.9, google_brand: 8, meta_acquisition: 1.7, meta_returning: 3.4, pinterest: 3 },
    settings: baseSettings({ otherVariablePct: 8, deliveryCostPerOrder: 2, multipliers: { ...DEFAULT_MULTIPLIERS, meta_acquisition: 1.1 } }),
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
    smsShare: 0.04,
    smsListSize: 18_000,
    mix: { google_nonbrand: 0.28, google_brand: 0.06, meta_acquisition: 0.55, meta_returning: 0.09, pinterest: 0.02 },
    platformRoas: { google_nonbrand: 2.8, google_brand: 7, meta_acquisition: 1.5, meta_returning: 3, pinterest: 3.5 },
    settings: baseSettings({ otherVariablePct: 4, deliveryCostPerOrder: 3, monthlyFixedCosts: 22000, dtcChannels: ["Online Store"] }),
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
  const refunds = orderRev * p.refundRate * noise(k("ref"), 0.55);
  const netSales = orderRev - shipping - tax - refunds;
  // Discounts are about a fifth of gross sales; gross - discounts - refunds = net sales.
  const discounts = ((orderRev - shipping - tax) / 0.8) * 0.2 * noise(k("disc"), 0.08);
  const grossSales = orderRev - shipping - tax + discounts;
  const cogs = netSales * p.cogsRate * noise(k("cogs"), 0.03);

  const totalSpend = e.spend * noise(k("spend"), 0.1);
  const channels = {} as DailyFact["channels"];
  for (const ch of CHANNEL_KEYS) {
    const spend = totalSpend * (p.mix[ch] ?? 0) * noise(k(`sp-${ch}`), 0.12);
    const platformRevenue = spend * (p.platformRoas[ch] ?? 0) * noise(k(`pr-${ch}`), 0.14);
    const platAov = p.aov * noise(k(`pa-${ch}`), 0.08);
    channels[ch] = { spend, platformRevenue, platformPurchases: platformRevenue / platAov };
  }

  const dow = dayOfWeek(date);
  const campaignDay = dow === 2 || dow === 4; // Tue / Thu sends
  const emailSent = campaignDay ? p.emailListSize * noise(k("sent"), 0.15) : p.emailListSize * 0.03;
  const emailRevenue = orderRev * p.emailShare * noise(k("email"), 0.18);
  const campaignShare = campaignDay ? 0.6 : 0.3;
  const smsSent = campaignDay ? p.smsListSize * noise(k("ssent"), 0.15) : 0;
  const smsRevenue = orderRev * p.smsShare * noise(k("sms"), 0.2);
  const smsCampaignShare = campaignDay ? 0.65 : 0.25;

  return {
    clientId: id,
    date,
    grossSales,
    discounts,
    netSales,
    shippingCollected: shipping,
    tax,
    newOrderRevenue: newRev,
    returningOrderRevenue: retRev,
    newOrders,
    returningOrders: retOrders,
    refunds,
    cogs,
    cogsUnmappedSales: 0,
    emailRevenue,
    emailCampaignRevenue: emailRevenue * campaignShare,
    emailFlowRevenue: emailRevenue * (1 - campaignShare),
    emailOrders: Math.round(emailRevenue / (p.aov * 1.05)),
    emailSent,
    smsRevenue,
    smsCampaignRevenue: smsRevenue * smsCampaignShare,
    smsFlowRevenue: smsRevenue * (1 - smsCampaignShare),
    smsOrders: Math.round(smsRevenue / (p.aov * 0.95)),
    smsSent,
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
  const netSales = orderRevenue * (1 - p.shippingRate - p.taxRate - p.refundRate);
  const shipping = orderRevenue * p.shippingRate;
  const s = p.settings;
  const cm =
    netSales +
    shipping -
    netSales * p.cogsRate -
    ((s.otherVariablePct / 100) * (netSales + shipping) + s.deliveryCostPerOrder * orders) -
    spend;
  const spendByChannel: Partial<Record<ChannelKey, number>> = {};
  for (const ch of CHANNEL_KEYS) spendByChannel[ch] = spend * (p.mix[ch] ?? 0);
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

/**
 * Plans/forecasting are not part of the first functional version. With no plan, the dashboard shows
 * store data only (no targets, no plan comparison). Flip this on to demo plan-vs-actual (Phase 2).
 */
const ENABLE_SEED_PLANS = false;

/** Fictional campaigns: each channel's daily spend is split across these by fixed weights. */
const SEED_CAMPAIGNS: { id: string; name: string; platform: string; channel: ChannelKey; category: CampaignDay["category"]; audience: CampaignDay["audience"]; weight: number }[] = [
  { id: "m1", name: "ACQ | Prospecting | Broad", platform: "meta", channel: "meta_acquisition", category: "acquisition", audience: "new", weight: 0.42 },
  { id: "m2", name: "ACQ | Lookalike 1% | Best sellers", platform: "meta", channel: "meta_acquisition", category: "acquisition", audience: "new", weight: 0.3 },
  { id: "m3", name: "ACQ | Video | Hero collection", platform: "meta", channel: "meta_acquisition", category: "acquisition", audience: "new", weight: 0.22 },
  { id: "m4", name: "TEST | us11 | New creative", platform: "meta", channel: "meta_acquisition", category: "test", audience: "new", weight: 0.06 },
  { id: "m5", name: "RET | Existing customers", platform: "meta", channel: "meta_returning", category: "retention", audience: "returning", weight: 1 },
  { id: "g1", name: "Search | NB | Rings", platform: "google_ads", channel: "google_nonbrand", category: "acquisition", audience: "unknown", weight: 0.4 },
  { id: "g2", name: "PMax | NB | All products", platform: "google_ads", channel: "google_nonbrand", category: "acquisition", audience: "unknown", weight: 0.45 },
  { id: "g3", name: "Shopping | Non-Brand", platform: "google_ads", channel: "google_nonbrand", category: "acquisition", audience: "unknown", weight: 0.15 },
  { id: "g4", name: "Search | Brand", platform: "google_ads", channel: "google_brand", category: "brand", audience: "unknown", weight: 1 },
  { id: "p1", name: "Pinterest | Catalog", platform: "pinterest", channel: "pinterest", category: "acquisition", audience: "unknown", weight: 1 },
];

export class SeedRepository implements Repository {
  async listClients(): Promise<Client[]> {
    return PROFILES.map((p) => p.client);
  }

  async getSettings(clientId: string): Promise<ClientSettings> {
    const base = defaultSettings(clientId);
    const o = readOverrides(clientId);
    if (!o) return base;
    return { ...base, ...o, clientId, multipliers: { ...base.multipliers, ...(o.multipliers ?? {}) }, extra: { ...base.extra, ...(o.extra ?? {}) } };
  }

  /** The demo data has no real orders, so the dialog lists only the channels switched on in the settings. */
  async getOrderChannels(): Promise<OrderChannel[]> {
    return [];
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

  /** Demo data has no individual orders. */
  async getAovHistogram(): Promise<AovData | null> {
    return null;
  }

  /** Deterministic demo ads (see lib/creative/demo.ts). */
  async getCreativeHistory(clientId: string, asOf: string): Promise<CreativeHistory | null> {
    return demoCreativeHistory(clientId, asOf);
  }

  async getCreativeMonth(clientId: string, month: string, asOf: string): Promise<{ ads: LaunchedAd[]; days: CreativeDay[] } | null> {
    return demoCreativeMonth(clientId, month, asOf);
  }

  /** Demo ads end on the last data day, like the rest of the demo data. */
  async getLastAdDate(clientId: string): Promise<string | null | undefined> {
    return this.getLastDataDate(clientId);
  }

  async getCreativeAds(clientId: string, q: CreativeQuery): Promise<CreativePage | null> {
    const { days, ads } = demoAdRows(clientId, await this.getLastDataDate(clientId));
    return aggregateAds(days, ads, q);
  }

  async getCreativeFormats(clientId: string, from: string, to: string, w: WowWindows | null): Promise<FormatTotals[] | null> {
    const { days, ads } = demoAdRows(clientId, await this.getLastDataDate(clientId));
    return aggregateFormats(days, ads, from, to, w);
  }

  async getFirstProducts(): Promise<FirstProductRow[] | null> {
    return [
      { product: "Starter Set", orders: [120, 48, 22, 18], sales: [9600, 3900, 1800, 1500], refundOrders: 6, refundAmount: 480 },
      { product: "Refill Pack", orders: [80, 40, 25, 30], sales: [3200, 1700, 1100, 1300], refundOrders: 2, refundAmount: 90 },
    ];
  }

  async getCampaignDays(clientId: string, from: string, to: string): Promise<CampaignDay[]> {
    const out: CampaignDay[] = [];
    for (const f of await this.getFacts(clientId, from, to)) {
      for (const def of SEED_CAMPAIGNS) {
        const ch = f.channels[def.channel];
        if (!ch || ch.spend <= 0) continue;
        const w = def.weight * noise(`${clientId}|${f.date}|c-${def.id}`, 0.25);
        out.push({
          date: f.date,
          platform: def.platform,
          campaignId: def.id,
          campaignName: def.name,
          category: def.category,
          audience: def.audience,
          spend: ch.spend * w,
          platformRevenue: ch.platformRevenue * w * noise(`${clientId}|${f.date}|r-${def.id}`, 0.3),
          platformPurchases: ch.platformPurchases * w,
        });
      }
    }
    return out;
  }

  async getLastDataDate(_clientId?: string): Promise<string> {
    void _clientId;
    return addDays(todayLocal(), -1);
  }

  /* Plans live in memory only (seed mode is for trying the screens; a reload starts empty). */
  private plans: PlanVersion[] = [];
  private months = new Map<string, PlanMonth[]>();
  private targets = new Map<string, PlanTargetDay[]>();
  private changes = new Map<string, PlanChange[]>();

  private log(planId: string, summary: string) {
    this.changes.set(planId, [{ at: new Date().toISOString(), by: "demo user", summary }, ...(this.changes.get(planId) ?? [])]);
  }

  async listPlans(clientId: string): Promise<PlanVersion[]> {
    const own = this.plans.filter((p) => p.clientId === clientId);
    if (own.length || !ENABLE_SEED_PLANS) return own;
    return [{ id: `${clientId}-2026-official`, clientId, name: "2026 Official Plan", isDefault: true, year: 2026, description: "", seasonality: null, updatedAt: null, updatedBy: null, scenario: "baseline", baseId: null, goal: null }];
  }

  async getPlanTargets(clientId: string, planId: string, from: string, to: string): Promise<PlanTargetDay[]> {
    // Plans created in the UI only have the rows saved for them; the built-in demo plan is generated.
    if (this.plans.some((p) => p.id === planId)) return (this.targets.get(planId) ?? []).filter((r) => r.date >= from && r.date <= to);
    const p = profileOf(clientId);
    return eachDay(from, to).map((d) => buildPlanDay(p, planId, d));
  }

  async createPlan(clientId: string, input: { name: string; year: number; description?: string; scenario?: PlanScenario; baseId?: string; goal?: StretchGoal }): Promise<PlanVersion> {
    const isTarget = input.scenario === "target";
    const plan: PlanVersion = {
      id: `plan-${Date.now()}-${this.plans.length}`,
      clientId,
      name: input.name,
      year: input.year,
      description: input.description ?? "",
      isDefault: !isTarget && !this.plans.some((p) => p.clientId === clientId && p.year === input.year && p.isDefault),
      seasonality: null,
      updatedAt: new Date().toISOString(),
      updatedBy: "demo user",
      scenario: isTarget ? "target" : "baseline",
      baseId: isTarget ? input.baseId ?? null : null,
      goal: isTarget ? input.goal ?? null : null,
    };
    this.plans.push(plan);
    this.log(plan.id, "Created plan");
    return plan;
  }

  async updatePlan(plan: PlanVersion, changeNote?: string): Promise<void> {
    this.plans = this.plans.map((p) => (p.id === plan.id ? { ...plan, updatedAt: new Date().toISOString(), updatedBy: "demo user" } : p));
    if (changeNote) this.log(plan.id, changeNote);
  }

  async deletePlan(plan: PlanVersion): Promise<void> {
    this.plans = this.plans.filter((p) => p.id !== plan.id);
    this.months.delete(plan.id);
    this.targets.delete(plan.id);
  }

  async setDefaultPlan(plan: PlanVersion): Promise<void> {
    this.plans = this.plans.map((p) => (p.clientId === plan.clientId && p.year === plan.year ? { ...p, isDefault: p.id === plan.id } : p));
    this.log(plan.id, "Set as default plan");
  }

  async getPlanMonths(planId: string): Promise<PlanMonth[]> {
    return this.months.get(planId) ?? [];
  }

  async savePlanMonths(plan: PlanVersion, items: { month: PlanMonth; rows: PlanTargetDay[] }[], changeNote: string): Promise<void> {
    const months = new Map((this.months.get(plan.id) ?? []).map((m) => [m.month, m]));
    let rows = this.targets.get(plan.id) ?? [];
    for (const { month, rows: r } of items) {
      months.set(month.month, month);
      rows = rows.filter((x) => x.date.slice(0, 7) !== month.month.slice(0, 7)).concat(r);
    }
    this.months.set(plan.id, [...months.values()].sort((a, b) => (a.month < b.month ? -1 : 1)));
    this.targets.set(plan.id, rows.sort((a, b) => (a.date < b.date ? -1 : 1)));
    this.plans = this.plans.map((p) => (p.id === plan.id ? { ...p, updatedAt: new Date().toISOString(), updatedBy: "demo user" } : p));
    this.log(plan.id, changeNote);
  }

  async getPlanChanges(planId: string): Promise<PlanChange[]> {
    return this.changes.get(planId) ?? [];
  }

  /** Demo cohorts: first-order revenue per month from the demo facts, repeat revenue decaying by age. */
  async getCohortData(clientId: string): Promise<{ available: boolean; stats: CohortStat[]; cohorts: CohortRow[] }> {
    const last = await this.getLastDataDate(clientId);
    const first = addDays(last, -365 * 3);
    const facts = await this.getFacts(clientId, first, last);
    const byMonth = new Map<string, number>();
    const cust = new Map<string, number>();
    for (const f of facts) {
      const m = `${f.date.slice(0, 7)}-01`;
      byMonth.set(m, (byMonth.get(m) ?? 0) + f.newOrderRevenue);
      cust.set(m, (cust.get(m) ?? 0) + f.newOrders);
    }
    const lift = (p: number) => 0.09 * 0.78 ** (p - 1) + 0.012;
    const stats: CohortStat[] = [];
    const cohorts: CohortRow[] = [];
    for (const [month, firstRevenue] of [...byMonth.entries()].sort()) {
      const periods = Array.from({ length: 36 }, (_, i) => firstRevenue * lift(i + 1) * noise(`${clientId}|${month}|${i}`, 0.15));
      cohorts.push({ month, customers: cust.get(month) ?? 0, firstRevenue, periods });
      stats.push({ month, customers: cust.get(month) ?? 0, firstRevenue, rev60d: periods[0] + periods[1], rev90d: periods[0] + periods[1] + periods[2], rev365d: periods.slice(0, 12).reduce((a, b) => a + b, 0) });
    }
    return { available: stats.length > 0, stats, cohorts };
  }

  async rebuildCohorts(): Promise<void> {
    /* demo cohorts are generated on read */
  }

  private modelStore = new Map<string, SavedModel<unknown, unknown>>();

  async getPlanModel(planId: string, kind: ModelKind): Promise<SavedModel<unknown, unknown> | null> {
    return this.modelStore.get(`${planId}|${kind}`) ?? null;
  }

  async savePlanModel(plan: PlanVersion, kind: ModelKind, settings: unknown, results: unknown, changeNote: string): Promise<void> {
    this.modelStore.set(`${plan.id}|${kind}`, { settings, results, updatedAt: new Date().toISOString(), updatedBy: "demo user" });
    this.log(plan.id, changeNote);
  }

  private eventStore: MarketingEvent[] = [];

  async listEvents(clientId: string): Promise<MarketingEvent[]> {
    return this.eventStore.filter((e) => e.clientId === clientId).sort((a, b) => (a.date < b.date ? -1 : 1));
  }

  async saveEvents(clientId: string, events: (Omit<MarketingEvent, "id" | "clientId"> & { id?: string })[]): Promise<MarketingEvent[]> {
    const out = events.map((e) => ({ ...e, id: e.id ?? `ev-${Math.random().toString(36).slice(2, 10)}`, clientId }) as MarketingEvent);
    for (const e of out) this.eventStore = [...this.eventStore.filter((x) => x.id !== e.id), e];
    return out;
  }

  async deleteEvent(id: string): Promise<void> {
    this.eventStore = this.eventStore.filter((e) => e.id !== id);
  }
}
