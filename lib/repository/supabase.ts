import { addDays, todayLocal } from "../dates";
import { defaultSettings, DEFAULT_MULTIPLIERS } from "../defaults";
import { getBrowserClient } from "../supabase/client";
import type { ChannelKey, Client, ClientSettings, DailyFact, PlanTargetDay, PlanVersion } from "../types";
import { CHANNEL_KEYS } from "../types";
import type { Repository } from "./types";

const n = (v: unknown) => Number(v ?? 0);

async function fetchAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; ; i += 1000) {
    const { data, error } = await build(i, i + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

type Row = Record<string, unknown>;

/** Reads real data through the signed-in user's session; row-level security limits it to their clients. */
export class SupabaseRepository implements Repository {
  private get db() {
    return getBrowserClient();
  }

  async listClients(): Promise<Client[]> {
    const { data, error } = await this.db.from("clients").select("id,name,currency,timezone,pod_id").order("name");
    if (error) throw new Error(error.message);
    return ((data ?? []) as Row[]).map((c) => ({
      id: c.id as string,
      name: c.name as string,
      currency: c.currency as Client["currency"],
      timezone: c.timezone as string,
      podId: (c.pod_id as string) ?? "",
    }));
  }

  async getSettings(clientId: string): Promise<ClientSettings> {
    const { data } = await this.db.from("client_settings").select("*").eq("client_id", clientId).maybeSingle();
    const base = defaultSettings(clientId);
    if (!data) return base;
    return {
      ...base,
      multipliers: { ...DEFAULT_MULTIPLIERS, ...(data.multipliers as Record<ChannelKey, number>) },
      otherVariablePct: n(data.other_variable_pct),
      cogsFallbackPct: n(data.cogs_fallback_pct),
      deliveryCostPerOrder: n(data.delivery_cost_per_order),
      monthlyFixedCosts: n(data.monthly_fixed_costs),
      brandCampaignKeyword: (data.brand_campaign_keyword as string) ?? base.brandCampaignKeyword,
      dtcChannels: (data.dtc_channels as string[]) ?? base.dtcChannels,
      excludeBrandFromAmer: Boolean(data.exclude_brand_from_amer),
      excludeMetaReturningFromAmer: Boolean(data.exclude_meta_returning_from_amer),
    };
  }

  async saveSettings(s: ClientSettings): Promise<void> {
    const { error } = await this.db.from("client_settings").upsert({
      client_id: s.clientId,
      multipliers: s.multipliers,
      other_variable_pct: s.otherVariablePct,
      cogs_fallback_pct: s.cogsFallbackPct,
      delivery_cost_per_order: s.deliveryCostPerOrder,
      monthly_fixed_costs: s.monthlyFixedCosts,
      brand_campaign_keyword: s.brandCampaignKeyword,
      dtc_channels: s.dtcChannels,
      exclude_brand_from_amer: s.excludeBrandFromAmer,
      exclude_meta_returning_from_amer: s.excludeMetaReturningFromAmer,
      updated_at: new Date().toISOString(),
    });
    if (error) throw new Error(error.message);
  }

  async resetSettings(clientId: string): Promise<ClientSettings> {
    const s = defaultSettings(clientId);
    await this.saveSettings(s);
    return s;
  }

  async getFacts(clientId: string, from: string, to: string): Promise<DailyFact[]> {
    const facts = await fetchAll<Row>((a, b) =>
      this.db.from("daily_facts").select("*").eq("client_id", clientId).gte("date", from).lte("date", to).order("date").range(a, b),
    );
    const ch = await fetchAll<Row>((a, b) =>
      this.db.from("daily_channel_facts").select("*").eq("client_id", clientId).gte("date", from).lte("date", to).order("date").range(a, b),
    );
    const byDate = new Map<string, Row[]>();
    for (const r of ch) {
      const d = r.date as string;
      byDate.set(d, [...(byDate.get(d) ?? []), r]);
    }
    const empty = (date: string): Row => ({ date });
    const have = new Set(facts.map((r) => r.date as string));
    const extra = [...byDate.keys()].filter((d) => !have.has(d)).map(empty);
    return [...facts, ...extra].sort((a, b) => ((a.date as string) < (b.date as string) ? -1 : 1)).map((r) => {
      const channels = Object.fromEntries(
        CHANNEL_KEYS.map((k) => [k, { spend: 0, platformRevenue: 0, platformPurchases: 0 }]),
      ) as DailyFact["channels"];
      for (const c of byDate.get(r.date as string) ?? []) {
        channels[c.channel as ChannelKey] = { spend: n(c.spend), platformRevenue: n(c.platform_revenue), platformPurchases: n(c.platform_purchases) };
      }
      return {
        clientId,
        date: r.date as string,
        netSales: n(r.net_sales),
        shippingCollected: n(r.shipping_collected),
        tax: n(r.tax),
        newOrderRevenue: n(r.new_order_revenue),
        returningOrderRevenue: n(r.returning_order_revenue),
        newOrders: n(r.new_orders),
        returningOrders: n(r.returning_orders),
        refunds: n(r.refunds),
        cogs: n(r.cogs),
        cogsUnmappedSales: n(r.cogs_unmapped_sales),
        emailRevenue: n(r.email_revenue),
        emailCampaignRevenue: n(r.email_campaign_revenue),
        emailFlowRevenue: n(r.email_flow_revenue),
        emailOrders: n(r.email_orders),
        emailSent: n(r.email_sent),
        channels,
      };
    });
  }

  async getLastDataDate(clientId: string): Promise<string> {
    const { data } = await this.db.from("daily_facts").select("date").eq("client_id", clientId).order("date", { ascending: false }).limit(1);
    return (data?.[0]?.date as string) ?? addDays(todayLocal(), -1);
  }

  async listPlans(clientId: string): Promise<PlanVersion[]> {
    const { data } = await this.db.from("plan_versions").select("id,client_id,name,is_default").eq("client_id", clientId);
    return ((data ?? []) as Row[]).map((p) => ({ id: p.id as string, clientId, name: p.name as string, isDefault: Boolean(p.is_default) }));
  }

  async getPlanTargets(clientId: string, planId: string, from: string, to: string): Promise<PlanTargetDay[]> {
    const rows = await fetchAll<Row>((a, b) =>
      this.db.from("plan_targets").select("*").eq("plan_id", planId).gte("date", from).lte("date", to).order("date").range(a, b),
    );
    return rows.map((r) => ({
      planId,
      clientId,
      date: r.date as string,
      orderRevenue: n(r.order_revenue),
      newRevenue: n(r.new_revenue),
      returningRevenue: n(r.returning_revenue),
      orders: n(r.orders),
      newOrders: n(r.new_orders),
      spend: n(r.spend),
      cm: n(r.cm),
      spendByChannel: (r.spend_by_channel as PlanTargetDay["spendByChannel"]) ?? {},
    }));
  }
}
