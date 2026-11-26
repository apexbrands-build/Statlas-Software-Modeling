"use client";

import { useEffect, useMemo, useState } from "react";
import { endOfMonth } from "@/lib/dates";
import { formatValue } from "@/lib/format";
import { aggregate, amerSpend } from "@/lib/metrics";
import { dailyTotals } from "@/lib/omni/forecast";
import { fitChannelModel, modelRevenue, planFill, recentAdSpendPace, type ChannelModel } from "@/lib/omni/model";
import type { ChannelDay, ChannelSale } from "@/lib/omni/types";
import { rolledUp } from "@/lib/omni/channel-metrics";
import { haloSettingsOf } from "@/lib/planning/halo";
import { curveAmer } from "@/lib/planning/new-customer";
import { getRepository } from "@/lib/repository";
import type { DailyFact, OtherChannel } from "@/lib/types";
import type { PlanCtx } from "../ctx";
import { btnPrimary, MONTHS } from "../ui";
import { ScatterCurve, type ScatterPoint } from "./charts";

const monthName = (month: string) => MONTHS[Number(month.slice(5, 7)) - 1];

/**
 * Models step, "Other Channels Model": the forecast model of each sales channel that has its own ad spend (Amazon, TikTok Shop).
 * It is the New Customer model's regression on the channel's daily ad spend and revenue, and it can fill the channel's forecast line.
 */
export function ChannelModels({ ctx, facts, lastData }: { ctx: PlanCtx; facts: DailyFact[]; lastData: string }) {
  const { client, settings, months, editInputs } = ctx;
  const channels = haloSettingsOf(settings).channels;
  const [sales, setSales] = useState<ChannelSale[] | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [replaceTyped, setReplaceTyped] = useState(false);

  useEffect(() => {
    if (!lastData) return;
    let cancel = false;
    getRepository()
      .getChannelSales(client.id, "2010-01-01", lastData)
      .then((rows) => !cancel && setSales(rows))
      .catch(() => {
        if (cancel) return;
        setFailed(true);
        setSales([]);
      });
    return () => {
      cancel = true;
    };
  }, [client.id, lastData]);

  const money = (v: number | null) => formatValue(v, "currency0", client.currency);

  if (!channels.length) {
    return <p className="max-w-3xl text-sm text-text-muted">This client has no other sales channels yet. Add Amazon, TikTok Shop or retail in Store Settings, Edit, &quot;Other sales channels and halo&quot;.</p>;
  }
  if (sales === undefined) return <div className="h-64 animate-pulse rounded-xl bg-surface" />;
  if (failed) return <p className="max-w-3xl text-sm text-bad">The sales of other channels could not be loaded just now. Reload the page to try again.</p>;
  if (sales === null) return <p className="max-w-3xl text-sm text-text-muted">The database is not ready for other channels&apos; sales yet, so there is nothing to fit a model on.</p>;

  /** Fills the channel's forecast for the open months from the model (`planFill`), and says exactly what it did and what it left alone. */
  const fill = (c: OtherChannel, model: ChannelModel, days: Map<string, ChannelDay>) => {
    // What the own-site ads spent per day on the very days the model was fitted on: the forecast is built on that level, so the halo
    // only moves it for the difference.
    const used = new Set(model.fit.used.map((p) => p.date));
    const window = aggregate(facts.filter((f) => used.has(f.date)));
    const siteDaily = window.days > 0 ? amerSpend(window, settings) / window.days : 0;
    const r = planFill({ months, channel: c.key, model, lastData, siteDaily, paceDaily: recentAdSpendPace(days), replaceTyped });
    for (const [month, line] of Object.entries(r.lines)) editInputs(month, (i) => ({ ...i, other: { ...(i.other ?? {}), [c.key]: line } }));
    const list = (ms: string[]) => ms.map(monthName).join(", ");
    const parts = [
      r.filled.length ? `forecast filled for ${list(r.filled)}` : "nothing was filled",
      r.paced.length ? `${list(r.paced)} had no planned ad spend and use${r.paced.length === 1 ? "s" : ""} the channel's pace of its last 90 days` : "",
      r.keptTyped.length ? `${list(r.keptTyped)} already had a forecast and ${r.keptTyped.length === 1 ? "was" : "were"} left as ${r.keptTyped.length === 1 ? "it was" : "they were"} (tick "Replace forecasts already in the plan" to refill)` : "",
      r.noSpend.length ? `${list(r.noSpend)} left empty: no planned ad spend, and under 28 recent days of the channel's ad spend to take a pace from` : "",
    ].filter(Boolean);
    setNote(`${c.label}: ${parts.join("; ")}.${r.filled.length ? " See the months in Details, Other sales channels, and press Save plan to keep them." : ""}`);
  };

  return (
    <div className="space-y-4">
      <p className="max-w-3xl text-sm text-text-muted">
        One model per sales channel that runs its own ads. It is the same regression as the New Customer model, on the channel&apos;s own daily ad spend and revenue: each day is adjusted for the channel&apos;s weekday pattern, outliers are removed by spend bucket, Black Friday week is
        left out, and a straight line of revenue on ad spend is fitted. R² says how much of the day-to-day change the ad spend explains.
      </p>
      <label className="flex items-center gap-2 text-xs text-text-muted">
        <input type="checkbox" checked={replaceTyped} onChange={(e) => setReplaceTyped(e.target.checked)} />
        Replace forecasts already in the plan when filling (off: only months with no forecast yet are filled)
      </label>
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
  const days = useMemo(() => dailyTotals(rolledUp(sales, [channel]), channel.key), [sales, channel]);
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
          <p className="mt-1 text-xs text-text-faint">Type the planned ad spend on the channel in Details, Other sales channels. A month with none is filled at the channel&apos;s pace over its last 90 days of sales.</p>
        </div>
      )}
    </div>
  );
}
