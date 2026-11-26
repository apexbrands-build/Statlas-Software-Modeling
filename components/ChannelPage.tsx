"use client";

import { useMemo, useState } from "react";
import { DailyChart, type ChartSeries } from "./DailyChart";
import type { DashData } from "@/lib/dashboard-data";
import { addYears } from "@/lib/dates";
import { compactCurrency, formatDiff, formatValue, type Format } from "@/lib/format";
import { compare, type Tone } from "@/lib/metrics";
import { seriesOf, totalsOf, type Grain } from "@/lib/omni/channel-metrics";
import { channelPage, DEFAULT_COLUMNS, toCsv, type Headline } from "@/lib/omni/channel-page";
import { metricInfo, metricValue, platformOf, type Better, type Unit } from "@/lib/omni/metrics";
import type { ChannelSale } from "@/lib/omni/types";
import type { ChannelView } from "@/lib/omni/views";
import type { OtherChannel } from "@/lib/types";
import { theme } from "@/theme/theme";

const TONE: Record<Tone, string> = { good: "text-good", bad: "text-bad", neutral: "text-text-muted" };
const FORMAT: Record<Unit, Format> = { currency: "currency0", price: "currency2", number: "number", percent: "percent1", ratio: "ratio2" };
const GRAINS: { id: Grain; label: string }[] = [
  { id: "day", label: "By day" },
  { id: "week", label: "By week" },
  { id: "month", label: "By month" },
];

/**
 * The page of an Amazon or TikTok Shop channel. Read top to bottom the way the business is run: contribution, then sales, ad spend
 * and the channel's efficiency, then the platform's own numbers. Reported numbers only; the one modelled figure says so.
 */
export function ChannelPage({ data, channel, view, sales }: { data: DashData; channel: OtherChannel; view: ChannelView; sales: ChannelSale[] }) {
  const cur = data.client.currency;
  const platform = platformOf(channel);
  const { from, to } = data.range;
  const days = data.dates.length;
  const [grain, setGrain] = useState<Grain>(days <= 31 ? "day" : days <= 120 ? "week" : "month");
  const [chartKey, setChartKey] = useState("revenue");
  const fmt = (v: number | null, unit: Unit) => formatValue(v, FORMAT[unit], cur);

  const { page, hasPrev } = useMemo(() => {
    // Last year is read over the same days the channel has data for, so a part-month is compared with the same part.
    const until = view.lastData !== null && view.lastData < to ? view.lastData : to;
    const now = totalsOf(platform, sales, channel.key, from, until);
    const before = totalsOf(platform, sales, channel.key, addYears(from, -1), addYears(until, -1));
    const prev = before.days > 0 ? before : null;
    return { page: channelPage({ platform, channel, view, now, prev }), hasPrev: prev !== null };
  }, [platform, sales, channel, view, from, to]);

  const columns = DEFAULT_COLUMNS[platform];
  const table = useMemo(() => seriesOf(platform, sales, channel.key, from, to, grain), [platform, sales, channel.key, from, to, grain]);
  const chart = useMemo(() => {
    const g: Grain = days <= 62 ? "day" : "month";
    const s = seriesOf(platform, sales, channel.key, from, to, g);
    const plan = new Map(view.dates.map((d, i) => [d, view.plan[i]] as const));
    const planOf = (key: string) => {
      const parts = [...plan.entries()].filter(([d, v]) => v !== null && (g === "day" ? d === key : d.startsWith(key))).map(([, v]) => v as number);
      return parts.length ? parts.reduce((a, x) => a + x, 0) : null;
    };
    return {
      grain: g,
      keys: s.keys,
      values: s.rows.map((r) => (r.days > 0 ? metricValue(platform, chartKey, r) : null)),
      plan: chartKey === "revenue" ? s.keys.map(planOf) : null,
    };
  }, [platform, sales, channel.key, from, to, days, chartKey, view.dates, view.plan]);

  const chartInfo = metricInfo(platform, chartKey);
  const chartUnit: Unit = chartInfo?.unit ?? "number";
  const series: ChartSeries[] = [
    { id: "a", label: chartInfo?.label ?? chartKey, kind: "bar", color: theme.colors.chartPrimary, values: chart.values },
    ...(chart.plan ? [{ id: "p", label: "Forecast", kind: "line" as const, color: theme.colors.chartTarget, values: chart.plan, dashed: true }] : []),
  ].filter((s) => s.values.some((v) => v !== null)) as ChartSeries[];

  const download = () => {
    const blob = new Blob([toCsv(platform, columns, table)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${channel.key}-${from}-to-${to}-by-${grain}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const versus = (h: Pick<Headline, "cmp" | "ref" | "refWord" | "better" | "unit">) => {
    if (h.ref === null || h.refWord === null) return { sub: null as string | null, tone: "neutral" as Tone };
    const c = compare(h.cmp, h.ref, h.better === "down" ? "down" : "up");
    return { sub: `${formatDiff(c.diff)} vs ${h.refWord} ${fmt(h.ref, h.unit)}`.trim(), tone: h.better === null ? ("neutral" as Tone) : c.tone };
  };
  const change = (value: number | null, prev: number | null, better: Better) => {
    if (value === null || prev === null) return { text: "–", tone: "neutral" as Tone };
    const c = compare(value, prev, better === "down" ? "down" : "up");
    return { text: formatDiff(c.diff), tone: better === null ? ("neutral" as Tone) : c.tone };
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {page.headlines.map((h) => {
          const v = versus(h);
          return (
            <div key={h.key} className="rounded-[12px] border border-border bg-surface p-4" title={h.hint}>
              <div className="text-xs text-text-muted">{h.label}</div>
              <div className="mt-1 text-2xl font-semibold tabular">{fmt(h.value, h.unit)}</div>
              {v.sub && <div className={`mt-1 text-xs ${TONE[v.tone]}`}>{v.sub}</div>}
              {h.also && <div className="mt-1 text-[11px] text-text-faint">{h.also}</div>}
              {h.key === "halo" && <div className="mt-1 text-[11px] text-text-faint">Modelled; inside the sales, not on top of them</div>}
            </div>
          );
        })}
      </div>

      {page.blocks.length > 0 && (
        <div className="grid gap-4 xl:grid-cols-3">
          {page.blocks.map((b) => (
            <section key={b.title} className="rounded-2xl border border-border bg-surface p-5">
              <h3 className="text-sm font-medium uppercase tracking-wide text-text-muted">{b.title}</h3>
              {b.note && <p className="mt-1 text-xs text-text-faint">{b.note}</p>}
              <table className="mt-3 w-full border-collapse text-sm">
                <thead>
                  <tr className="text-xs text-text-faint">
                    <th className="py-1 text-left font-normal" />
                    <th className="py-1 pl-3 text-right font-normal">This period</th>
                    {hasPrev && <th className="py-1 pl-3 text-right font-normal">Last year</th>}
                    {hasPrev && <th className="py-1 pl-3 text-right font-normal">Change</th>}
                  </tr>
                </thead>
                <tbody>
                  {b.rows.map((r) => {
                    const c = change(r.value, r.prev, r.better);
                    return (
                      <tr key={r.key} className="border-t border-border/50" title={r.hint}>
                        <td className="py-1.5 pr-2">{r.label}</td>
                        <td className="py-1.5 pl-3 text-right tabular">{fmt(r.value, r.unit)}</td>
                        {hasPrev && <td className="py-1.5 pl-3 text-right tabular text-text-muted">{fmt(r.prev, r.unit)}</td>}
                        {hasPrev && <td className={`py-1.5 pl-3 text-right tabular ${TONE[c.tone]}`}>{c.text}</td>}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>
          ))}
        </div>
      )}

      {page.tables.map((t) => (
        <section key={t.title} className="overflow-x-auto rounded-2xl border border-border bg-surface p-5">
          <h3 className="text-sm font-medium uppercase tracking-wide text-text-muted">{t.title}</h3>
          {t.note && <p className="mt-1 text-xs text-text-faint">{t.note}</p>}
          <table className="mt-3 w-full min-w-[560px] border-collapse text-sm">
            <thead>
              <tr className="text-xs text-text-faint">
                <th className="px-2 py-1 text-left font-normal" />
                {t.columns.map((c) => (
                  <th key={c.label} className="px-2 py-1 text-right font-normal">
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {t.rows.map((r) => (
                <tr key={r.label} className={`border-t border-border/50 ${r.label === "All ads" ? "font-medium" : ""}`}>
                  <td className="px-2 py-1.5">{r.label}</td>
                  {r.cells.map((v, i) => (
                    <td key={t.columns[i].label} className="px-2 py-1.5 text-right tabular">
                      {fmt(v, t.columns[i].unit)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}

      <section className="rounded-2xl border border-border bg-surface p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-medium text-text-muted">{chart.grain === "day" ? "Daily trend" : "Monthly trend"}</h3>
          <select aria-label="Number shown in the chart" className="rounded-lg border border-border bg-surface px-2 py-1 text-xs text-text" value={chartKey} onChange={(e) => setChartKey(e.target.value)}>
            {columns.map((k) => (
              <option key={k} value={k}>
                {metricInfo(platform, k)?.label ?? k}
              </option>
            ))}
          </select>
        </div>
        {series.length > 0 ? (
          <DailyChart
            dates={chart.keys}
            labels={chart.grain === "day" ? undefined : chart.keys}
            series={series}
            height={300}
            maxBarWidth={chart.grain === "day" ? 28 : 44}
            formatValue={(v) => fmt(v, chartUnit)}
            formatAxis={(v) => (chartUnit === "currency" ? compactCurrency(v, cur) : fmt(v, chartUnit))}
          />
        ) : (
          <p className="py-10 text-center text-sm text-text-faint">Nothing loaded for this number in the period.</p>
        )}
      </section>

      <section className="rounded-2xl border border-border bg-surface p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-medium uppercase tracking-wide text-text-muted">Every number, by period</h3>
          <div className="flex items-center gap-2">
            {GRAINS.map((g) => (
              <button key={g.id} type="button" onClick={() => setGrain(g.id)} className={`rounded-lg border px-2.5 py-1 text-xs ${grain === g.id ? "border-accent text-text" : "border-border text-text-muted"}`}>
                {g.label}
              </button>
            ))}
            <button type="button" onClick={download} className="rounded-lg border border-border px-2.5 py-1 text-xs text-text-muted">
              Download CSV
            </button>
          </div>
        </div>
        <div className="max-h-[420px] overflow-auto">
          <table className="w-full min-w-[900px] border-collapse text-xs">
            <thead className="sticky top-0 bg-surface">
              <tr className="text-text-faint">
                <th className="px-2 py-1 text-left font-normal">{grain === "day" ? "Day" : grain === "week" ? "Week of" : "Month"}</th>
                {columns.map((k) => (
                  <th key={k} className="px-2 py-1 text-right font-normal" title={metricInfo(platform, k)?.hint}>
                    {metricInfo(platform, k)?.label ?? k}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.keys.map((key, i) => (
                <tr key={key} className="border-t border-border/40">
                  <td className="whitespace-nowrap px-2 py-1 text-text-muted">{key}</td>
                  {columns.map((k) => (
                    <td key={k} className="px-2 py-1 text-right tabular">
                      {table.rows[i].days > 0 ? fmt(metricValue(platform, k, table.rows[i]), metricInfo(platform, k)?.unit ?? "number") : "–"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
