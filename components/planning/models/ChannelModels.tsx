"use client";

import { useEffect, useMemo, useState } from "react";
import { addDays, endOfMonth } from "@/lib/dates";
import { formatValue } from "@/lib/format";
import { aggregate, amerSpend } from "@/lib/metrics";
import { dailyTotals } from "@/lib/omni/forecast";
import { fitChannelModel, modelRevenue, type ChannelModel } from "@/lib/omni/model";
import type { ChannelDay, ChannelSale } from "@/lib/omni/types";
import { haloSettingsOf } from "@/lib/planning/halo";
import { curveAmer } from "@/lib/planning/new-customer";
import { getRepository } from "@/lib/repository";
import type { DailyFact, OtherChannel } from "@/lib/types";
import type { PlanCtx } from "../ctx";
import { btnPrimary, MONTHS } from "../ui";
import { ScatterCurve, type ScatterPoint } from "./charts";

const daysIn = (month: string) => Number(endOfMonth(month).slice(8, 10));

/**
 * Models step, "Other Channels Model": the forecast model of each sales channel that has its own ad spend (Amazon, TikTok Shop).
 * It is the New Customer model's regression on the channel's daily ad spend and revenue, and it can fill the channel's forecast line.
 */
export function ChannelModels({ ctx, facts, lastData }: { ctx: PlanCtx; facts: DailyFact[]; lastData: string }) {
  const { client, settings, months, editInputs } = ctx;
  const channels = haloSettingsOf(settings).channels;
  const [sales, setSales] = useState<ChannelSale[] | null | undefined>(undefined);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (!lastData) return;
    let cancel = false;
    getRepository()
      .getChannelSales(client.id, "2010-01-01", lastData)
      .then((rows) => !cancel && setSales(rows))
      .catch(() => !cancel && setSales(null));
    return () => {
      cancel = true;
    };
  }, [client.id, lastData]);

  const money = (v: number | null) => formatValue(v, "currency0", client.currency);

  if (!channels.length) {
    return <p className="max-w-3xl text-sm text-text-muted">This client has no other sales channels yet. Add Amazon, TikTok Shop or retail in Store Settings, Edit, &quot;Other sales channels and halo&quot;.</p>;
  }
  if (sales === undefined) return <div className="h-64 animate-pulse rounded-xl bg-surface" />;
  if (sales === null) return <p className="max-w-3xl text-sm text-text-muted">The sales of other channels cannot be read yet: the database table for them is not in place (migration 0021).</p>;

  /** Fills the channel's forecast for every open month from the model, at the month's planned channel ad spend. */
  const fill = (c: OtherChannel, model: ChannelModel, days: Map<string, ChannelDay>) => {
    // What the own-site ads spent per day while these channel days happened: the forecast is built on that level, so the halo only moves it for the difference.
    const window = aggregate(facts.filter((f) => f.date >= model.from && f.date <= model.to));
    const siteDaily = window.days > 0 ? amerSpend(window, settings) / window.days : 0;
    // A month with no planned channel ad spend uses the channel's pace of the last 90 days.
    const recentFrom = addDays(lastData, -89);
    let recentSpend = 0;
    for (const [d, v] of days) if (d >= recentFrom && d <= lastData) recentSpend += v.adSpend;
    const recentDaily = recentSpend / 90;
    let filled = 0;
    let paced = 0;
    for (const m of months) {
      if (!m.inputs || m.locked || endOfMonth(m.month) <= lastData) continue;
      const typed = Number(m.inputs.other?.[c.key]?.adSpend);
      const hasTyped = Number.isFinite(typed) && typed > 0;
      const adSpend = hasTyped ? typed : Math.round(recentDaily * daysIn(m.month));
      if (!hasTyped) paced += 1;
      const revenue = Math.round(modelRevenue(model, adSpend, m.month));
      editInputs(m.month, (i) => ({ ...i, other: { ...(i.other ?? {}), [c.key]: { ...(i.other?.[c.key] ?? {}), revenue, adSpend, assumedSpend: Math.round(siteDaily * daysIn(m.month)) } } }));
      filled += 1;
    }
    setNote(
      filled
        ? `${c.label}: forecast filled for ${filled} open month${filled === 1 ? "" : "s"}${paced ? ` (${paced} with no planned ad spend use the pace of the last 90 days)` : ""}. See them in Details, Other sales channels, and press Save plan to keep them.`
        : `${c.label}: no open month to fill. Start the months in the plan first.`,
    );
  };

  return (
    <div className="space-y-4">
      <p className="max-w-3xl text-sm text-text-muted">
        One model per sales channel that runs its own ads. It is the same regression as the New Customer model, on the channel&apos;s own daily ad spend and revenue: each day is adjusted for the channel&apos;s weekday pattern, outliers are removed by spend bucket, Black Friday week is
        left out, and a straight line of revenue on ad spend is fitted. R² says how much of the day-to-day change the ad spend explains.
      </p>
      {note && <p className="rounded-lg bg-accent/10 p-2 text-xs">{note}</p>}
      {channels.map((c) => (
        <ChannelPanel key={c.key} channel={c} sales={sales} lastData={lastData} money={money} months={months.map((m) => m.month)} planned={(month) => Number(months.find((m) => m.month === month)?.inputs?.other?.[c.key]?.adSpend) || 0} onFill={fill} />
      ))}
    </div>
  );
}

function ChannelPanel({
  channel,
  sales,
  lastData,
  money,
  months,
  planned,
  onFill,
}: {
  channel: OtherChannel;
  sales: ChannelSale[];
  lastData: string;
  money: (v: number | null) => string;
  months: string[];
  planned: (month: string) => number;
  onFill: (c: OtherChannel, m: ChannelModel, days: Map<string, ChannelDay>) => void;
}) {
  const days = useMemo(() => dailyTotals(sales, channel.key), [sales, channel.key]);
  const model = useMemo(() => fitChannelModel(days, lastData), [days, lastData]);
  const withSpend = [...days.values()].filter((d) => d.adSpend > 0 && d.revenue > 0).length;

  const box = "rounded-xl border border-border bg-surface p-4";
  if (!model) {
    return (
      <div className={box}>
        <h3 className="mb-2 text-sm font-semibold">{channel.label}</h3>
        <p className="text-sm text-text-muted">
          {days.size === 0
            ? `No ${channel.label} sales are loaded yet. Import them in Store Settings, Edit, "Other sales channels and halo".`
            : withSpend === 0
              ? `${channel.label} has ${days.size} days of sales and no ad spend of its own, so there is no spend model. Its forecast is the number typed in Details (for retail, the retailer rows fill it).`
              : `Not enough to fit yet: the model needs 60 usable days with both ad spend and revenue, and revenue that rises with spend. ${channel.label} has ${withSpend} days with both.`}
        </p>
      </div>
    );
  }

  const c = model.fit.curve;
  const points: ScatterPoint[] = model.fit.used.map((p) => ({ x: p.spend * 30, y: p.adjAmer, tone: "history" as const }));
  const maxX = Math.max(...points.map((p) => p.x), 1);
  const curve = Array.from({ length: 60 }, (_, i) => {
    const x = (maxX * (i + 1)) / 60;
    return { x, y: curveAmer(c, x / 30) };
  });
  const open = months.filter((m) => endOfMonth(m) > lastData);

  return (
    <div className={box}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">{channel.label}</h3>
        <button className={btnPrimary} onClick={() => onFill(channel, model, days)}>
          Fill the plan from this model
        </button>
      </div>
      <div className="grid gap-4 text-sm md:grid-cols-2">
        <div className="space-y-1">
          <p>
            <span className="text-text-muted">R²:</span> {c.r2.toFixed(2)} ({model.trust} confidence)
          </p>
          <p className="tabular">
            <span className="text-text-muted">Line:</span> daily revenue = {money(c.a)} + {c.b.toFixed(2)} × daily ad spend
          </p>
          <p>
            <span className="text-text-muted">Sells with none of its own ads:</span> {money(Math.max(0, c.a))} a day · <span className="text-text-muted">each extra $1 of ad spend brings:</span> {c.b.toFixed(2)}
          </p>
          <p>
            <span className="text-text-muted">Days used:</span> {model.daysUsed} ({model.from} to {model.to}) · <span className="text-text-muted">removed:</span> {model.removed.bfcm} Black Friday week, {model.removed.outlier} outliers
          </p>
          <p className="text-xs text-text-muted">
            {model.seasonal.years >= 2 ? "Each month uses its own seasonality index, from the same month in past years." : "Seasonality by month needs two years of days, so every month uses ×1.00 for now."} The first number is what the channel sells without its own ads. It includes what the
            own-site ads send there, so the plan saves the own-site ad spend of these days with the forecast and the halo only moves it for the difference.
          </p>
        </div>
        <ScatterCurve points={points} curve={curve} xFmt={(v) => money(v)} height={220} />
      </div>
      {open.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-xs">
            <thead>
              <tr className="border-b border-border text-text-muted">
                <th className="px-2 py-1.5 text-left font-medium">Open month</th>
                {open.map((m) => (
                  <th key={m} className="px-2 py-1.5 text-right font-medium">
                    {MONTHS[Number(m.slice(5, 7)) - 1]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-border/40">
                <td className="px-2 py-1 text-text-muted">Planned ad spend on {channel.label}</td>
                {open.map((m) => (
                  <td key={m} className="px-2 py-1 text-right tabular">
                    {planned(m) > 0 ? money(planned(m)) : "–"}
                  </td>
                ))}
              </tr>
              <tr>
                <td className="px-2 py-1 text-text-muted">Revenue the model gives</td>
                {open.map((m) => (
                  <td key={m} className="px-2 py-1 text-right tabular font-medium">
                    {planned(m) > 0 ? money(modelRevenue(model, planned(m), m)) : "–"}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
          <p className="mt-1 text-xs text-text-faint">Type the planned ad spend on the channel in Details, Other sales channels. A month left empty is filled at the pace of the last 90 days.</p>
        </div>
      )}
    </div>
  );
}
