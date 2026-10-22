import { addDays, endOfMonth, startOfMonth, todayLocal, type Range } from "../dates";
import { normalizeQuery, type CreativePage, type CreativeQuery } from "../creative/aggregate";
import type { FormatTotals, WowWindows } from "../creative/best-creatives";
import { isMissingFunction, mapAdRow, mapFormatRow } from "../creative/map-rows";
import { mapMetaLaunches, type MetaAdRow, type MetaLaunch } from "./meta-launches";
import { mapCreativeDay, mapLaunchedAd, mapMonthAgg, mapScoreAd } from "../creative/rows";
import type { CreativeDay, CreativeHistory, LaunchedAd } from "../creative/types";
import { defaultSettings } from "../defaults";
import type { OrderChannel } from "../order-channels";
import { getBrowserClient } from "../supabase/client";
import { mapAovRows, type AovData, type AovMode } from "../reports/aov";
import type { FirstProductRow } from "../reports/first-product";
import type { CampaignDay, ChannelKey, Client, ClientSettings, DailyFact, PlanScenario, PlanTargetDay, PlanVersion, StretchGoal } from "../types";
import { CHANNEL_KEYS } from "../types";
import type { MarketingEvent } from "../planning/events";
import { readScenarioFields } from "../planning/scenarios";
import type { CohortStat, ModelKind, SavedModel } from "../planning/models";
import type { CohortRow } from "../planning/returning";
import type { PlanChange, PlanMonth, PlanMonthInputs } from "../planning/types";
import { settingsFromRow } from "./settings-row";
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
    return settingsFromRow(clientId, data);
  }

  async saveSettings(s: ClientSettings): Promise<void> {
    const { error } = await this.db.from("client_settings").upsert({
      client_id: s.clientId,
      multipliers: s.multipliers,
      other_variable_pct: s.otherVariablePct,
      cogs_fallback_pct: s.cogsFallbackPct,
      cogs_flat_rate: s.cogsFlatRate,
      excluded_order_tags: s.excludedOrderTags,
      extra: s.extra,
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
        grossSales: n(r.gross_sales),
        discounts: n(r.discounts),
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
        // Present once the SMS sync adds these columns; until then they read as 0.
        smsRevenue: n(r.sms_revenue),
        smsCampaignRevenue: n(r.sms_campaign_revenue),
        smsFlowRevenue: n(r.sms_flow_revenue),
        smsOrders: n(r.sms_orders),
        smsSent: n(r.sms_sent),
        channels,
      };
    });
  }

  async getOrderChannels(clientId: string): Promise<OrderChannel[]> {
    const { data, error } = await this.db.rpc("order_channels", { p_client: clientId });
    if (error) {
      if (/order_channels|PGRST202|42883/.test(`${error.code} ${error.message}`)) return []; // migration 0015 not applied yet
      throw new Error(error.message);
    }
    return ((data ?? []) as Row[]).map((r) => ({ channel: r.channel as string, orders: n(r.orders) }));
  }

  async getFirstProducts(clientId: string, from: string, to: string): Promise<FirstProductRow[] | null> {
    const { data, error } = await this.db.rpc("first_product_report", { p_client: clientId, p_from: from, p_to: to });
    if (error) {
      if (/first_product_report|order_lines|PGRST202|PGRST205|42883|42P01/.test(`${error.code} ${error.message}`)) return null;
      throw new Error(error.message);
    }
    return ((data ?? []) as Row[]).map((r) => ({
      product: r.product as string,
      orders: [n(r.o1), n(r.o2), n(r.o3), n(r.o4)],
      sales: [n(r.s1), n(r.s2), n(r.s3), n(r.s4)],
      refundOrders: n(r.refund_orders),
      refundAmount: n(r.refund_amount),
    }));
  }

  async getAovHistogram(clientId: string, from: string, to: string, mode: AovMode, step: number): Promise<AovData | null> {
    const missing = /aov_stats|aov_histogram|PGRST202|PGRST205|42883/;
    const stats = await this.db.rpc("aov_stats", { p_client: clientId, p_from: from, p_to: to });
    if (stats.error) {
      if (missing.test(`${stats.error.code} ${stats.error.message}`)) return null;
      throw new Error(stats.error.message);
    }
    const buckets = await this.db.rpc("aov_histogram", { p_client: clientId, p_from: from, p_to: to, p_mode: mode, p_step: step });
    if (buckets.error) {
      if (missing.test(`${buckets.error.code} ${buckets.error.message}`)) return null;
      throw new Error(buckets.error.message);
    }
    return mapAovRows(((stats.data ?? []) as Row[])[0], (buckets.data ?? []) as Row[]);
  }

  /** One creative read function, all pages (1,000 rows each, ordered so pages never overlap); null when the function is not there yet (migration 0013). */
  private async creativeRpc(fn: string, args: Record<string, unknown>, orderBy: string): Promise<Row[] | null> {
    const missing = /creative_|PGRST202|PGRST205|42883/;
    const rows: Row[] = [];
    for (let i = 0; ; i += 1000) {
      const { data, error } = await this.db.rpc(fn, args).order(orderBy).range(i, i + 999);
      if (error) {
        if (missing.test(`${error.code} ${error.message}`)) return null;
        throw new Error(error.message);
      }
      rows.push(...((data ?? []) as Row[]));
      if (!data || data.length < 1000) break;
    }
    return rows;
  }

  async getCreativeHistory(clientId: string, asOf: string, fromMonth: string): Promise<CreativeHistory | null> {
    const [months, ads, days, score] = await Promise.all([
      this.creativeRpc("creative_months", { p_client: clientId, p_from: fromMonth, p_to: asOf }, "month"),
      this.creativeRpc("creative_ads", { p_client: clientId, p_from: addDays(asOf, -364), p_to: asOf }, "ad_id"),
      this.creativeRpc("creative_days", { p_client: clientId, p_from: addDays(asOf, -96), p_to: asOf }, "date"),
      this.creativeRpc("creative_score_ads", { p_client: clientId, p_to: asOf }, "ad_id"),
    ]);
    if (!months || !ads || !days || !score) return null;
    return { asOf, months: months.map(mapMonthAgg), ads: ads.map(mapLaunchedAd), days: days.map(mapCreativeDay), scoreAds: score.map(mapScoreAd) };
  }

  async getCreativeMonth(clientId: string, month: string, asOf: string): Promise<{ ads: LaunchedAd[]; days: CreativeDay[] } | null> {
    const from = startOfMonth(month);
    const to = endOfMonth(month);
    const [ads, days] = await Promise.all([
      this.creativeRpc("creative_ads", { p_client: clientId, p_from: from, p_to: to }, "ad_id"),
      this.creativeRpc("creative_days", { p_client: clientId, p_from: from, p_to: to < asOf ? to : asOf }, "date"),
    ]);
    if (!ads || !days) return null;
    return { ads: ads.map(mapLaunchedAd), days: days.map(mapCreativeDay) };
  }

  async getMetaLaunches(clientId: string, range: Range): Promise<MetaLaunch[] | undefined> {
    const { data, error } = await this.db
      .from("meta_ads")
      .select("campaign_name,created_at,is_catalog")
      .eq("client_id", clientId)
      .gte("created_at", `${range.from}T00:00:00Z`)
      .lte("created_at", `${range.to}T23:59:59Z`)
      .limit(5000);
    if (error) {
      if (isMissingFunction(error) || /meta_ads|relation|schema cache/i.test(error.message)) return undefined;
      throw new Error(error.message);
    }
    return mapMetaLaunches((data ?? []) as MetaAdRow[]);
  }

  async getLastAdDate(clientId: string): Promise<string | null | undefined> {
    const { data, error } = await this.db.from("meta_ad_daily").select("date").eq("client_id", clientId).order("date", { ascending: false }).limit(1);
    if (error) {
      if (isMissingFunction(error)) return undefined;
      throw new Error(error.message);
    }
    const last = (data as Row[] | null)?.[0]?.date;
    return last ? String(last).slice(0, 10) : null;
  }

  async getCreativeAds(clientId: string, query: CreativeQuery): Promise<CreativePage | null> {
    const q = normalizeQuery(query);
    const { data, error } = await this.db.rpc("creative_ads_report", {
      p_client: clientId,
      p_from: q.from,
      p_to: q.to,
      p_cur_from: q.windows?.cur.from ?? null,
      p_cur_to: q.windows?.cur.to ?? null,
      p_prev_from: q.windows?.prev.from ?? null,
      p_prev_to: q.windows?.prev.to ?? null,
      p_format: q.format,
      p_campaign: q.campaign,
      p_catalog: q.catalog,
      p_live: q.live,
      p_sort: q.sort,
      p_margin: q.margin,
      p_limit: q.limit,
      p_offset: q.offset,
    });
    if (error) {
      if (isMissingFunction(error)) return null;
      throw new Error(error.message);
    }
    const rows = (data ?? []) as Row[];
    return { rows: rows.map(mapAdRow), total: rows.length ? Number(rows[0].total_count) : 0 };
  }

  async getCreativeFormats(clientId: string, from: string, to: string, w: WowWindows | null): Promise<FormatTotals[] | null> {
    const { data, error } = await this.db.rpc("creative_format_totals", {
      p_client: clientId,
      p_from: from,
      p_to: to,
      p_cur_from: w?.cur.from ?? null,
      p_cur_to: w?.cur.to ?? null,
      p_prev_from: w?.prev.from ?? null,
      p_prev_to: w?.prev.to ?? null,
    });
    if (error) {
      if (isMissingFunction(error)) return null;
      throw new Error(error.message);
    }
    return ((data ?? []) as Row[]).map(mapFormatRow);
  }

  async getCampaignDays(clientId: string, from: string, to: string): Promise<CampaignDay[]> {
    const rows = await fetchAll<Row>((a, b) =>
      this.db
        .from("ad_spend_daily")
        .select("date,platform,campaign_id,campaign_name,category,audience_type,spend,platform_revenue,platform_purchases")
        .eq("client_id", clientId)
        .gte("date", from)
        .lte("date", to)
        .order("date")
        .range(a, b),
    );
    return rows.map((r) => ({
      date: r.date as string,
      platform: r.platform as string,
      campaignId: r.campaign_id as string,
      campaignName: (r.campaign_name as string) ?? (r.campaign_id as string),
      category: r.category as CampaignDay["category"],
      audience: r.audience_type as CampaignDay["audience"],
      spend: n(r.spend),
      platformRevenue: n(r.platform_revenue),
      platformPurchases: n(r.platform_purchases),
    }));
  }

  async getLastDataDate(clientId: string): Promise<string> {
    const { data } = await this.db.from("daily_facts").select("date").eq("client_id", clientId).order("date", { ascending: false }).limit(1);
    return (data?.[0]?.date as string) ?? addDays(todayLocal(), -1);
  }

  private async userLabel(): Promise<string> {
    const { data } = await this.db.auth.getUser();
    return data.user?.email ?? "unknown";
  }

  private toPlan(p: Row): PlanVersion {
    return {
      id: p.id as string,
      clientId: p.client_id as string,
      name: p.name as string,
      isDefault: Boolean(p.is_default),
      year: n(p.year),
      description: (p.description as string) ?? "",
      seasonality: (p.seasonality as PlanVersion["seasonality"]) ?? null,
      updatedAt: (p.updated_at as string) ?? null,
      updatedBy: (p.updated_by as string) ?? null,
      ...readScenarioFields(p),
    };
  }

  async listPlans(clientId: string): Promise<PlanVersion[]> {
    const { data } = await this.db.from("plan_versions").select("*").eq("client_id", clientId).order("year", { ascending: false }).order("created_at");
    return ((data ?? []) as Row[]).map((p) => this.toPlan(p));
  }

  private async log(plan: PlanVersion, summary: string) {
    await this.db.from("plan_changes").insert({ plan_id: plan.id, client_id: plan.clientId, by: await this.userLabel(), summary });
  }

  async createPlan(clientId: string, input: { name: string; year: number; description?: string; scenario?: PlanScenario; baseId?: string; goal?: StretchGoal }): Promise<PlanVersion> {
    const existing = await this.listPlans(clientId);
    const isTarget = input.scenario === "target";
    const { data, error } = await this.db
      .from("plan_versions")
      .insert({
        client_id: clientId,
        name: input.name,
        year: input.year,
        description: input.description ?? "",
        is_default: !isTarget && !existing.some((p) => p.year === input.year && p.isDefault),
        updated_by: await this.userLabel(),
        // Scenario columns are written only for a stretch, so baselines keep working before migration 0011 is applied.
        ...(isTarget ? { scenario: "target", base_plan_id: input.baseId ?? null, goal: input.goal ?? null } : {}),
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    const plan = this.toPlan(data as Row);
    await this.log(plan, "Created plan");
    return plan;
  }

  async updatePlan(plan: PlanVersion, changeNote?: string): Promise<void> {
    const { error } = await this.db
      .from("plan_versions")
      .update({
        name: plan.name,
        description: plan.description,
        seasonality: plan.seasonality,
        updated_at: new Date().toISOString(),
        updated_by: await this.userLabel(),
        ...(plan.scenario === "target" ? { goal: plan.goal } : {}),
      })
      .eq("id", plan.id);
    if (error) throw new Error(error.message);
    if (changeNote) await this.log(plan, changeNote);
  }

  async deletePlan(plan: PlanVersion): Promise<void> {
    const { error } = await this.db.from("plan_versions").delete().eq("id", plan.id);
    if (error) throw new Error(error.message);
  }

  async setDefaultPlan(plan: PlanVersion): Promise<void> {
    const off = await this.db.from("plan_versions").update({ is_default: false }).eq("client_id", plan.clientId).eq("year", plan.year);
    if (off.error) throw new Error(off.error.message);
    const on = await this.db.from("plan_versions").update({ is_default: true }).eq("id", plan.id);
    if (on.error) throw new Error(on.error.message);
    await this.log(plan, "Set as default plan");
  }

  async getPlanMonths(planId: string): Promise<PlanMonth[]> {
    const { data, error } = await this.db.from("plan_months").select("*").eq("plan_id", planId).order("month");
    if (error) throw new Error(error.message);
    return ((data ?? []) as Row[]).map((r) => ({
      month: r.month as string,
      inputs: (r.inputs as PlanMonthInputs | null) ?? null,
      status: (r.status as PlanMonth["status"]) ?? "in_progress",
      locked: Boolean(r.locked),
    }));
  }

  async savePlanMonths(plan: PlanVersion, items: { month: PlanMonth; rows: PlanTargetDay[] }[], changeNote: string): Promise<void> {
    for (const { month, rows } of items) {
      const up = await this.db
        .from("plan_months")
        .upsert({ plan_id: plan.id, client_id: plan.clientId, month: month.month, inputs: month.inputs, status: month.status, locked: month.locked, updated_at: new Date().toISOString() });
      if (up.error) throw new Error(up.error.message);
      const first = month.month.slice(0, 8) + "01";
      const last = new Date(Date.UTC(Number(first.slice(0, 4)), Number(first.slice(5, 7)), 0)).toISOString().slice(0, 10);
      const del = await this.db.from("plan_targets").delete().eq("plan_id", plan.id).gte("date", first).lte("date", last);
      if (del.error) throw new Error(del.error.message);
      if (rows.length) {
        const ins = await this.db.from("plan_targets").insert(
          rows.map((r) => ({
            plan_id: plan.id,
            client_id: plan.clientId,
            date: r.date,
            order_revenue: r.orderRevenue,
            new_revenue: r.newRevenue,
            returning_revenue: r.returningRevenue,
            orders: r.orders,
            new_orders: r.newOrders,
            spend: r.spend,
            cm: r.cm,
            spend_by_channel: r.spendByChannel,
            gross_sales: r.grossSales ?? null,
            discounts: r.discounts ?? null,
            shipping: r.shipping ?? null,
            refunds: r.refunds ?? null,
            tax: r.tax ?? null,
            cogs: r.cogs ?? null,
            cost_of_delivery: r.costOfDelivery ?? null,
          })),
        );
        if (ins.error) throw new Error(ins.error.message);
      }
    }
    await this.db.from("plan_versions").update({ updated_at: new Date().toISOString(), updated_by: await this.userLabel() }).eq("id", plan.id);
    await this.log(plan, changeNote);
  }

  async getPlanChanges(planId: string): Promise<PlanChange[]> {
    const { data } = await this.db.from("plan_changes").select("at,by,summary").eq("plan_id", planId).order("at", { ascending: false }).limit(30);
    return ((data ?? []) as Row[]).map((r) => ({ at: r.at as string, by: (r.by as string) ?? "", summary: r.summary as string }));
  }

  async getCohortData(clientId: string): Promise<{ available: boolean; stats: CohortStat[]; cohorts: CohortRow[] }> {
    try {
      const stats = await fetchAll<Row>((a, b) => this.db.from("cohort_stats").select("*").eq("client_id", clientId).order("cohort_month").range(a, b));
      const periods = await fetchAll<Row>((a, b) => this.db.from("cohort_periods").select("*").eq("client_id", clientId).order("cohort_month").range(a, b));
      const byMonth = new Map<string, number[]>();
      for (const r of periods) {
        const m = r.cohort_month as string;
        const arr = byMonth.get(m) ?? [];
        arr[Number(r.period) - 1] = n(r.revenue);
        byMonth.set(m, arr);
      }
      const st = stats.map((r) => ({ month: r.cohort_month as string, customers: n(r.customers), firstRevenue: n(r.first_revenue), rev60d: n(r.rev_60d), rev90d: (byMonth.get(r.cohort_month as string) ?? []).slice(0, 3).reduce((a, b) => a + (b ?? 0), 0), rev365d: n(r.rev_365d) }));
      const cohorts = st.map((c) => ({ month: c.month, customers: c.customers, firstRevenue: c.firstRevenue, periods: Array.from({ length: 36 }, (_, i) => byMonth.get(c.month)?.[i] ?? 0) }));
      return { available: st.length > 0, stats: st, cohorts };
    } catch {
      return { available: false, stats: [], cohorts: [] };
    }
  }

  async rebuildCohorts(clientId: string): Promise<void> {
    const { error } = await this.db.rpc("rebuild_cohorts", { p_client: clientId });
    if (error) throw new Error(error.message);
  }

  async getPlanModel(planId: string, kind: ModelKind): Promise<SavedModel<unknown, unknown> | null> {
    const { data, error } = await this.db.from("plan_models").select("*").eq("plan_id", planId).eq("kind", kind).maybeSingle();
    if (error || !data) return null;
    const r = data as Row;
    return { settings: r.settings, results: r.results ?? null, updatedAt: (r.updated_at as string) ?? null, updatedBy: (r.updated_by as string) ?? null };
  }

  async savePlanModel(plan: PlanVersion, kind: ModelKind, settings: unknown, results: unknown, changeNote: string): Promise<void> {
    const up = await this.db
      .from("plan_models")
      .upsert({ plan_id: plan.id, client_id: plan.clientId, kind, settings, results, updated_at: new Date().toISOString(), updated_by: await this.userLabel() });
    if (up.error) throw new Error(up.error.message);
    await this.log(plan, changeNote);
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
      ...(r.gross_sales != null ? { grossSales: n(r.gross_sales) } : {}),
      ...(r.discounts != null ? { discounts: n(r.discounts) } : {}),
      ...(r.shipping != null ? { shipping: n(r.shipping) } : {}),
      ...(r.refunds != null ? { refunds: n(r.refunds) } : {}),
      ...(r.tax != null ? { tax: n(r.tax) } : {}),
      ...(r.cogs != null ? { cogs: n(r.cogs) } : {}),
      ...(r.cost_of_delivery != null ? { costOfDelivery: n(r.cost_of_delivery) } : {}),
    }));
  }

  private eventOf(r: Row): MarketingEvent {
    return {
      id: r.id as string,
      clientId: r.client_id as string,
      date: r.date as string,
      endDate: ((r.end_date as string | null) ?? (r.date as string)) as string,
      type: r.category as string,
      name: (r.title as string) ?? "",
      ...(r.promo ? { promo: r.promo as string } : {}),
      ...(r.product ? { product: r.product as string } : {}),
      ...(r.audience ? { audience: r.audience as string } : {}),
      segmentSize: r.segment_size == null ? null : n(r.segment_size),
      ...(r.notes ? { notes: r.notes as string } : {}),
      source: ((r.source as string) ?? "manual") as MarketingEvent["source"],
    };
  }

  async listEvents(clientId: string): Promise<MarketingEvent[]> {
    const rows = await fetchAll<Row>((a, b) => this.db.from("marketing_events").select("*").eq("client_id", clientId).order("date").range(a, b));
    return rows.map((r) => this.eventOf(r));
  }

  async saveEvents(clientId: string, events: (Omit<MarketingEvent, "id" | "clientId"> & { id?: string })[]): Promise<MarketingEvent[]> {
    const rec = (e: (typeof events)[number]) => ({
      ...(e.id ? { id: e.id } : {}),
      client_id: clientId,
      date: e.date,
      end_date: e.endDate || e.date,
      category: e.type,
      title: e.name || e.type,
      source: e.source === "klaviyo" || e.source === "sms" || e.source === "import" ? e.source : "manual",
      promo: e.promo ?? null,
      product: e.product ?? null,
      audience: e.audience ?? null,
      segment_size: e.segmentSize ?? null,
      notes: e.notes ?? null,
    });
    const out: MarketingEvent[] = [];
    for (let i = 0; i < events.length; i += 200) {
      const { data, error } = await this.db.from("marketing_events").upsert(events.slice(i, i + 200).map(rec)).select("*");
      if (error) throw new Error(/column|policy|permission|row-level/i.test(error.message) ? `Could not save events: database migration 0008 has not been applied yet (supabase/migrations/0008_marketing_calendar.sql). ${error.message}` : error.message);
      out.push(...((data ?? []) as Row[]).map((r) => this.eventOf(r)));
    }
    return out;
  }

  async deleteEvent(id: string): Promise<void> {
    const { error } = await this.db.from("marketing_events").delete().eq("id", id);
    if (error) throw new Error(error.message);
  }
}
