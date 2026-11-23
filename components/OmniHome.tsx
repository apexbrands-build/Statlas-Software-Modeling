"use client";

import { DailyChart, type ChartSeries } from "./DailyChart";
import type { DashData } from "@/lib/dashboard-data";
import { compactCurrency, formatDiff, formatValue } from "@/lib/format";
import { compare, type Direction, type Tone } from "@/lib/metrics";
import type { OmniData } from "@/lib/omni/use-omni";
import { BUSINESS_VIEW } from "@/lib/omni/view-choice";
import type { ChannelView } from "@/lib/omni/views";
import { theme } from "@/theme/theme";

const TONE: Record<Tone, string> = { good: "text-good", bad: "text-bad", neutral: "text-text-muted" };

function Tile({ label, value, sub, tone = "neutral", extra, title }: { label: string; value: string; sub?: string | null; tone?: Tone; extra?: string | null; title?: string }) {
  return (
    <div className="rounded-[12px] border border-border bg-surface p-4" title={title}>
      <div className="text-xs text-text-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular">{value}</div>
      {sub && <div className={`mt-1 text-xs ${TONE[tone]}`}>{sub}</div>}
      {extra && <div className="mt-1 text-[11px] text-text-faint">{extra}</div>}
    </div>
  );
}

/** Days for ranges up to about two months, months beyond that (as the own-site chart does). */
function chartRows(dates: string[], actual: (number | null)[], plan: (number | null)[]) {
  if (dates.length <= 62) return { keys: dates, labels: undefined as string[] | undefined, actual, plan };
  const keys: string[] = [];
  const a: (number | null)[] = [];
  const p: (number | null)[] = [];
  dates.forEach((d, i) => {
    const k = d.slice(0, 7);
    if (keys[keys.length - 1] !== k) {
      keys.push(k);
      a.push(null);
      p.push(null);
    }
    const j = keys.length - 1;
    if (actual[i] !== null) a[j] = (a[j] ?? 0) + (actual[i] as number);
    if (plan[i] !== null) p[j] = (p[j] ?? 0) + (plan[i] as number);
  });
  return { keys, labels: keys, actual: a, plan: p };
}

/**
 * Home for a view other than the own site: one other sales channel against its forecast, or the whole business (the own site plus every
 * other channel). Reported numbers; the only modelled figures are "created by ads" and the blended aMER, and they say so.
 */
export function OmniHome({ data, omni, view }: { data: DashData; omni: OmniData; view: string }) {
  const cur = data.client.currency;
  const money = (v: number | null) => formatValue(v, "currency0", cur);
  const c = theme.colors;
  const vs = (actual: number | null, ref: number | null, fmt: (v: number | null) => string, word: string, direction: Direction = "up") => {
    if (ref === null) return { sub: null as string | null, tone: "neutral" as Tone };
    const cmp = compare(actual, ref, direction);
    return { sub: `${formatDiff(cmp.diff)} vs ${word} ${fmt(ref)}`.trim(), tone: cmp.tone };
  };

  if (!omni.ready) return <div className="h-64 animate-pulse rounded-xl bg-surface" />;

  const chart = (dates: string[], actual: (number | null)[], plan: (number | null)[], actualLabel: string, planLabel: string) => {
    const r = chartRows(dates, actual, plan);
    const series: ChartSeries[] = [
      { id: "a", label: actualLabel, kind: "bar", color: c.chartPrimary, values: r.actual },
      { id: "p", label: planLabel, kind: "line", color: c.chartTarget, values: r.plan, dashed: true },
    ].filter((s) => s.values.some((v) => v !== null)) as ChartSeries[];
    if (!series.length) return null;
    return (
      <section className="rounded-2xl border border-border bg-surface p-5">
        <h3 className="mb-3 text-sm font-medium text-text-muted">{r.labels ? "Monthly trend" : "Daily trend"}</h3>
        <DailyChart dates={r.keys} labels={r.labels} series={series} height={320} maxBarWidth={r.labels ? 44 : 28} formatValue={(v) => formatValue(v, "currency0", cur)} formatAxis={(v) => compactCurrency(v, cur)} />
      </section>
    );
  };

  const missing = omni.tableMissing && (
    <p className="rounded-lg border border-border bg-surface p-3 text-xs text-text-muted">The sales of other channels cannot be loaded yet: their table is not in the database (migration 0021). Forecasts from the plan are shown; actual sales appear once the table is in place and sales are imported.</p>
  );

  /* ---------------- whole business ---------------- */
  if (view === BUSINESS_VIEW) {
    const b = omni.business;
    const site = omni.site;
    if (!b || !site) return null;
    const rev = vs(b.revenue, b.plan?.revenue ?? null, money, "plan");
    const sp = vs(b.spend, b.plan?.spend ?? null, money, "plan");
    const ratio = (v: number | null) => (v === null ? "–" : v.toFixed(2));
    const mer = vs(b.mer, b.plan?.mer ?? null, ratio, "plan");
    const cm = vs(b.contribution, b.plan?.contribution ?? null, money, "plan");
    // The chart adds the own site's day to every channel's day, for what happened and for the plan.
    const actual = data.dates.map((d, i) => {
      const f = data.facts.get(d);
      const parts = [f && d <= data.effTo ? f.newOrderRevenue + f.returningOrderRevenue : null, ...omni.views.map((v) => v.actual[i] ?? null)].filter((x): x is number => x !== null);
      return parts.length ? parts.reduce((a, x) => a + x, 0) : null;
    });
    const plan = data.dates.map((d, i) => {
      const parts = [data.plan.get(d)?.orderRevenue ?? null, ...omni.views.map((v) => v.plan[i] ?? null)].filter((x): x is number => x !== null);
      return parts.length ? parts.reduce((a, x) => a + x, 0) : null;
    });
    const anyCreated = b.rows.some((r) => r.createdByAds !== null);
    return (
      <div className="space-y-6">
        <p className="text-xs text-text-faint">
          {data.range.from} → {data.range.to} · {data.client.name} · Whole business: the own site plus every other sales channel. Each channel is compared with its forecast over the days that have sales loaded.
        </p>
        {missing}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Tile label="Revenue, all channels" value={money(b.revenue)} sub={rev.sub} tone={rev.tone} />
          <Tile label="Ad spend, all channels" value={money(b.spend)} sub={sp.sub} tone={sp.tone} />
          <Tile label="MER, whole business" value={ratio(b.mer)} sub={mer.sub} tone={mer.tone} title="Revenue on every channel ÷ ad spend on every channel" />
          <Tile label="Contribution, all channels" value={money(b.contribution)} sub={cm.sub} tone={cm.tone} title="Own-site contribution margin, plus each other channel's revenue at its margin minus its own ad spend" />
        </div>
        <section className="overflow-x-auto rounded-2xl border border-border bg-surface p-5">
          <h3 className="mb-3 text-sm font-medium uppercase tracking-wide text-text-muted">By sales channel</h3>
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-text-muted">
                <th className="px-2 py-2 text-left font-medium">Channel</th>
                <th className="px-2 py-2 text-right font-medium">Actual</th>
                <th className="px-2 py-2 text-right font-medium">Forecast</th>
                <th className="px-2 py-2 text-right font-medium">To forecast</th>
                <th className="px-2 py-2 text-right font-medium">Share of revenue</th>
                {anyCreated && <th className="px-2 py-2 text-right font-medium">Created by ads*</th>}
              </tr>
            </thead>
            <tbody>
              {b.rows.map((r) => {
                const tone = compare(r.actual, r.forecast, "up").tone;
                return (
                  <tr key={r.key} className="border-b border-border/40">
                    <td className="px-2 py-1.5">{r.label}</td>
                    <td className="px-2 py-1.5 text-right tabular">{money(r.actual)}</td>
                    <td className="px-2 py-1.5 text-right tabular text-text-muted">{r.forecast === null ? "–" : money(r.forecast)}</td>
                    <td className={`px-2 py-1.5 text-right tabular ${TONE[tone]}`}>{r.pct === null ? "–" : formatValue(r.pct, "percent1", cur)}</td>
                    <td className="px-2 py-1.5 text-right tabular text-text-muted">{r.share === null ? "–" : formatValue(r.share, "percent1", cur)}</td>
                    {anyCreated && <td className="px-2 py-1.5 text-right tabular text-text-muted">{r.createdByAds === null ? "–" : money(r.createdByAds)}</td>}
                  </tr>
                );
              })}
              <tr className="font-medium">
                <td className="px-2 py-1.5">Whole business</td>
                <td className="px-2 py-1.5 text-right tabular">{money(b.revenue)}</td>
                <td className="px-2 py-1.5 text-right tabular text-text-muted">{b.plan ? money(b.plan.revenue) : "–"}</td>
                <td className={`px-2 py-1.5 text-right tabular ${TONE[rev.tone]}`}>{b.plan && b.plan.revenue > 0 ? formatValue(b.revenue / b.plan.revenue, "percent1", cur) : "–"}</td>
                <td className="px-2 py-1.5 text-right tabular text-text-muted">{formatValue(1, "percent1", cur)}</td>
                {anyCreated && <td />}
              </tr>
            </tbody>
          </table>
          {anyCreated && <p className="mt-2 text-xs text-text-faint">* Modelled: the part of the channel&apos;s sales that the halo factors (Store Settings) credit to the own-site ads. It is inside the channel&apos;s sales, not on top of them.</p>}
          <p className="mt-2 text-xs text-text-muted">
            aMER on the own site: <span className="tabular text-text">{ratio(site.amer)}</span>
            {site.blendedAmer !== null && (
              <>
                {" "}
                · Blended aMER, with what the same ads create on the other channels (modelled): <span className="tabular text-text">{ratio(site.blendedAmer)}</span>
              </>
            )}
          </p>
        </section>
        {chart(data.dates, actual, plan, "Revenue, all channels", "Plan, all channels")}
      </div>
    );
  }

  /* ---------------- one other channel ---------------- */
  const v: ChannelView | undefined = omni.views.find((x) => x.key === view);
  if (!v) return <p className="rounded-xl border border-border bg-surface p-8 text-center text-text-muted">This sales channel is no longer in Store Settings.</p>;
  const rev = vs(v.revenue, v.forecastToDate, money, "forecast");
  const spendVs = vs(v.adSpend, v.planAdSpendToDate !== null && v.planAdSpendToDate > 0 ? v.planAdSpendToDate : null, money, "planned");
  const cm = vs(v.contribution, v.planContributionToDate, money, "forecast");
  const pace = v.forecastFull !== null && v.projected !== null && v.forecastToDate !== null && v.forecastFull - v.forecastToDate > 1 ? `Period forecast ${money(v.forecastFull)} · heading to ${money(v.projected)}` : v.forecastFull !== null && !v.hasData ? `Period forecast ${money(v.forecastFull)}` : null;
  return (
    <div className="space-y-6">
      <p className="text-xs text-text-faint">
        {data.range.from} → {data.range.to} · {data.client.name} · {v.label}
        {v.lastData ? ` · sales through ${v.lastData}, compared with the forecast for the same days` : ""}
      </p>
      {missing}
      {!v.hasData && !omni.tableMissing && (
        <p className="rounded-lg border border-border bg-surface p-3 text-xs text-text-muted">
          No {v.label} sales are loaded for this period. Import them in Store Settings, Edit, &quot;Other sales channels and halo&quot;.{v.forecastFull !== null ? " The forecast from the plan is shown below." : ""}
        </p>
      )}
      {v.forecastFull === null && (
        <p className="rounded-lg border border-border bg-surface p-3 text-xs text-text-muted">The plan has no {v.label} forecast for this period. Type one in Planning, Details, &quot;Other sales channels&quot;, or fill it from the channel&apos;s model.</p>
      )}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <Tile label={`${v.label} revenue`} value={money(v.revenue)} sub={rev.sub} tone={rev.tone} extra={pace} />
        <Tile label="Ad spend on the channel" value={money(v.adSpend)} sub={spendVs.sub} tone={spendVs.tone} />
        <Tile label="ROAS on the channel" value={v.roas === null ? "–" : v.roas.toFixed(2)} title="The channel's revenue ÷ its own ad spend" />
        <Tile label="Contribution" value={money(v.contribution)} sub={cm.sub} tone={cm.tone} title="Revenue at the channel's margin (Store Settings) minus its own ad spend" />
        <Tile label={v.orders > 0 || v.units === 0 ? "Orders" : "Units"} value={(v.orders > 0 || v.units === 0 ? v.orders : v.units).toLocaleString()} extra={v.orders > 0 && v.units > 0 ? `${v.units.toLocaleString()} units` : null} />
        <Tile
          label="Created by the own-site ads"
          value={v.createdByAds === null ? "–" : money(v.createdByAds)}
          extra={v.createdByAds === null ? "No halo factor is typed for this channel" : "Modelled from the halo factors; inside the revenue, not on top of it"}
        />
      </div>
      {chart(v.dates, v.actual, v.plan, `${v.label} revenue`, "Forecast")}
    </div>
  );
}
