"use client";

import { useEffect, useMemo, useState } from "react";
import { addDays, addYears } from "../dates";
import type { DashData } from "../dashboard-data";
import { amerSpend, cmParts, orderRevenue, totalSpend } from "../metrics";
import { actualAcquisitionShares, blendedAmer, haloMix, haloSettingsOf } from "../planning/halo";
import { DEFAULT_NEW_CUSTOMER, type NewCustomerSettings } from "../planning/models";
import type { Curve } from "../planning/new-customer";
import { fitPlanModel } from "../planning/plan-fit";
import { pickPlan } from "../planning/scenarios";
import type { PlanMonth } from "../planning/types";
import { getRepository } from "../repository";
import { rolledUp } from "./channel-metrics";
import { dailyForecast, dailyTotals, monthLines, needsCurve, weekdayShares, type MonthLine } from "./forecast";
import type { ChannelSale } from "./types";
import { businessView, channelView, type BusinessView, type ChannelView, type SiteNumbers } from "./views";

interface Raw {
  key: string;
  /** Null = the table for other channels' sales is not in the database yet. */
  sales: ChannelSale[] | null;
  months: PlanMonth[];
  curve: Curve | null;
  /** The sales could not be loaded (network, timeout): different from the table not existing. */
  failed: boolean;
}

export interface OmniData {
  /** False while the other channels are still loading for this client and range. */
  ready: boolean;
  /** The sales table is not in the database yet (migration 0021), so only forecasts can be shown. */
  tableMissing: boolean;
  /** The other channels' sales could not be loaded this time; forecasts are still shown. */
  loadError: boolean;
  views: ChannelView[];
  site: SiteNumbers | null;
  business: BusinessView | null;
  /** The other channels' rows that were loaded (the range, a year of history, and the same days last year), for the channel pages. */
  sales: ChannelSale[];
}

const EMPTY: OmniData = { ready: false, tableMissing: false, loadError: false, views: [], site: null, business: null, sales: [] };

/**
 * The other sales channels and the whole business for the range Home shows, built on the own-site numbers Home already has.
 * Loads nothing until a view other than the own site is open (`enabled`).
 */
export function useOmni(d: DashData | null, enabled: boolean): OmniData {
  const [raw, setRaw] = useState<Raw | null>(null);
  const key = d && enabled ? `${d.client.id}|${d.range.from}|${d.range.to}|${d.planScenario}|${d.lastData}` : null;

  useEffect(() => {
    if (!d || !key) return;
    let cancel = false;
    (async () => {
      const repo = getRepository();
      // A year of sales before the last day with data gives each channel its weekday pattern.
      const yearAgo = addDays(addYears(d.lastData, -1), 1);
      // ...and the same days last year, which a channel page compares with when the plan has no forecast.
      const from = [yearAgo, d.range.from, addYears(d.range.from, -1)].sort()[0];
      let failed = false;
      const [sales, plans] = await Promise.all([
        repo.getChannelSales(d.client.id, from, d.range.to).catch(() => {
          failed = true;
          return [] as ChannelSale[];
        }),
        repo.listPlans(d.client.id),
      ]);
      const plan = pickPlan(plans, Number(d.range.to.slice(0, 4)), d.planScenario);
      const months = plan ? await repo.getPlanMonths(plan.id).catch(() => [] as PlanMonth[]) : [];
      let curve: Curve | null = null;
      if (plan && needsCurve(months)) {
        // Only a forecast that assumed another ad spend needs the spend curve, fitted exactly as the plan editor does.
        try {
          const [facts, model] = await Promise.all([repo.getFacts(d.client.id, "2010-01-01", d.lastData), repo.getPlanModel(plan.id, "new_customer")]);
          curve = fitPlanModel(facts, d.settings, plan.seasonality?.dow ?? [0, 0, 0, 0, 0, 0, 0], { ...DEFAULT_NEW_CUSTOMER, ...((model?.settings as Partial<NewCustomerSettings> | undefined) ?? {}) })?.curve ?? null;
        } catch {
          curve = null;
        }
      }
      // Ad spend and ad sales that were loaded by ad type are added up once, here, for every reader of these rows.
      const rows = sales ? rolledUp(sales, haloSettingsOf(d.settings).channels) : sales;
      if (!cancel) setRaw({ key, sales: rows, months, curve, failed });
    })();
    return () => {
      cancel = true;
    };
    // `key` carries everything the load depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return useMemo<OmniData>(() => {
    if (!d || !raw || raw.key !== key) return EMPTY;
    const lines = monthLines(raw.months, d.settings, raw.curve);
    const views = haloSettingsOf(d.settings).channels.map((channel) => {
      const days = dailyTotals(raw.sales ?? [], channel.key);
      const last = [...days.keys()].sort().pop() ?? d.lastData;
      const own: Record<string, MonthLine> = {};
      for (const [month, row] of Object.entries(lines)) if (row[channel.key]) own[month] = row[channel.key];
      return channelView({ channel, days, forecast: dailyForecast(lines, channel.key, d.range.from, d.range.to, weekdayShares(days, last)), lines: own, from: d.range.from, to: d.range.to });
    });
    const spend = amerSpend(d.cur, d.settings);
    const amer = spend > 0 ? d.cur.newOrderRevenue / spend : null;
    const mix = haloMix(actualAcquisitionShares([...d.facts.values()].filter((f) => f.date >= d.range.from), d.settings), d.settings);
    const site: SiteNumbers = {
      revenue: orderRevenue(d.cur),
      spend: totalSpend(d.cur),
      cm: cmParts(d.cur, d.settings).cm,
      plan: d.hasPlan && d.planTotals.days > 0 ? { revenue: d.planTotals.orderRevenue, spend: d.planTotals.spend, cm: d.planTotals.cm } : null,
      amer,
      blendedAmer: amer !== null && mix.modelled ? blendedAmer(amer, mix) : null,
    };
    return { ready: true, tableMissing: raw.sales === null, loadError: raw.failed, views, site, business: businessView(site, views), sales: raw.sales ?? [] };
  }, [d, raw, key]);
}
