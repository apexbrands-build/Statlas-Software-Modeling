"use client";

import { useEffect, useState } from "react";
import type { CreativeMonth } from "@/lib/creative/plan";
import type { AdFormat, CreativeDay, CreativeHistory, LaunchedAd } from "@/lib/creative/types";
import { AD_FORMATS } from "@/lib/creative/types";
import { endOfMonth, startOfMonth } from "@/lib/dates";
import { formatValue } from "@/lib/format";
import { aggregate, METRICS } from "@/lib/metrics";
import type { Client, ClientSettings, DailyFact } from "@/lib/types";
import { getRepository } from "@/lib/repository";
import { Legend, LineChart } from "@/components/planning/models/charts";
import { MONTHS } from "@/components/planning/ui";

const FORMAT_COLOR: Record<AdFormat, string> = { video: "#5eead4", image: "#facc15", carousel: "#fb923c", other: "#94a3b8" };
const FORMAT_LABEL: Record<AdFormat, string> = { video: "Video", image: "Image", carousel: "Carousel", other: "Other" };

/** Ads launched per day, stacked by format. */
function LaunchBars({ days }: { days: CreativeDay[] }) {
  const total = (d: CreativeDay) => AD_FORMATS.reduce((s, f) => s + d.launched[f], 0);
  const max = Math.max(1, ...days.map(total));
  return (
    <div>
      <div className="flex h-24 items-end gap-0.5" role="img" aria-label="Ads launched per day">
        {days.map((d) => (
          <div key={d.date} className="flex flex-1 flex-col-reverse" title={`${d.date}: ${total(d)} launched`} style={{ height: `${(total(d) / max) * 100}%` }}>
            {AD_FORMATS.map((f) => (d.launched[f] > 0 ? <div key={f} style={{ flex: d.launched[f], background: FORMAT_COLOR[f] }} /> : null))}
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-0.5 text-[9px] text-text-faint">
        {days.map((d) => (
          <span key={d.date} className="flex-1 text-center">
            {Number(d.date.slice(8, 10)) % 5 === 1 ? Number(d.date.slice(8, 10)) : ""}
          </span>
        ))}
      </div>
    </div>
  );
}

/** One month in detail: launches by day, daily Meta spend and aMER, the batch's first-week and first-month spend, and the launches themselves. */
export function CreativeMonthView({ client, settings, facts: allFacts, lastData, month, history, block, asOf }: { client: Client; settings: ClientSettings; facts: DailyFact[]; lastData: string; month: string; history: CreativeHistory | null; block: CreativeMonth | null; asOf: string }) {
  const [loaded, setLoaded] = useState<{ key: string; data: { ads: LaunchedAd[]; days: CreativeDay[] } | null } | null>(null);
  const key = `${client.id}|${month}|${asOf}`;

  useEffect(() => {
    let cancel = false;
    getRepository()
      .getCreativeMonth(client.id, month, asOf)
      .then(
        (data) => !cancel && setLoaded({ key, data }),
        () => !cancel && setLoaded({ key, data: null }),
      );
    return () => {
      cancel = true;
    };
  }, [client.id, month, asOf, key]);

  const money = (v: number | null) => formatValue(v, "currency0", client.currency);
  const name = MONTHS[Number(month.slice(5, 7)) - 1];
  const ready = loaded && loaded.key === key ? loaded : null;
  const data = ready?.data ?? null;

  const from = startOfMonth(month);
  const to = endOfMonth(month);
  const facts = allFacts.filter((f) => f.date >= from && f.date <= to);
  const factByDate = new Map(facts.map((f) => [f.date, f]));
  const days = Array.from({ length: Number(to.slice(8, 10)) }, (_, i) => `${month.slice(0, 8)}${String(i + 1).padStart(2, "0")}`);
  const labels = days.map((d) => (Number(d.slice(8, 10)) % 5 === 1 ? String(Number(d.slice(8, 10))) : ""));
  const metaSpend = days.map((d) => {
    const f = factByDate.get(d);
    return f ? (f.channels.meta_acquisition?.spend ?? 0) + (f.channels.meta_returning?.spend ?? 0) : null;
  });
  const amer = days.map((d) => {
    const f = factByDate.get(d);
    return f ? METRICS.amer.value(aggregate([f]), settings) : null;
  });

  const launched = (data?.ads ?? []).slice().sort((a, b) => (a.launchDate < b.launchDate ? -1 : a.launchDate > b.launchDate ? 1 : a.name.localeCompare(b.name)));
  const real = launched.filter((a) => !a.isCatalog);
  const spend7 = real.reduce((s, a) => s + a.spend7, 0);
  const spend30 = real.reduce((s, a) => s + a.spend30, 0);
  const future = from > lastData;

  return (
    <section className="space-y-4 rounded-xl border border-border bg-surface p-4" aria-label={`${name} in detail`}>
      <div className="flex flex-wrap items-baseline gap-3">
        <h3 className="mr-auto text-sm font-semibold">
          {name} {month.slice(0, 4)} in detail
        </h3>
        {block && block.basis.reason !== "no_meta_spend" && <span className="text-xs text-text-muted">{block.needed} new ads needed</span>}
      </div>

      {history === null && !data ? (
        <p className="text-sm text-text-muted">No ad-level data yet for this client: run a Meta history sync in Store Settings.</p>
      ) : !ready ? (
        <div className="h-32 animate-pulse rounded-lg bg-bg" />
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-2">
              <h4 className="text-xs font-medium text-text-muted">Ads launched per day</h4>
              {data && data.days.some((d) => AD_FORMATS.some((f) => d.launched[f] > 0)) ? (
                <>
                  <LaunchBars days={data.days} />
                  <Legend items={AD_FORMATS.map((f) => ({ label: FORMAT_LABEL[f], color: FORMAT_COLOR[f] }))} />
                </>
              ) : (
                <p className="text-sm text-text-muted">{future ? "This month has not started." : "No ads launched this month."}</p>
              )}
              {real.length > 0 && (
                <p className="text-xs text-text-muted">
                  The {real.length} ad{real.length === 1 ? "" : "s"} launched spent {money(spend7)} in their first 7 days and {money(spend30)} in their first 30.
                </p>
              )}
            </div>
            <div className="space-y-2">
              <h4 className="text-xs font-medium text-text-muted">Daily Meta spend and aMER</h4>
              {facts.length === 0 ? (
                <p className="text-sm text-text-muted">{future ? "No actuals yet: the month is still to come." : "No actuals for this month."}</p>
              ) : (
                <>
                  <LineChart series={[{ label: "Meta spend", color: "#5eead4", values: metaSpend }]} labels={labels} yFmt={(v) => formatValue(v, "currency0", client.currency)} height={110} />
                  <LineChart series={[{ label: "aMER", color: "#facc15", values: amer }]} labels={labels} yFmt={(v) => v.toFixed(1)} height={110} />
                  <Legend items={[{ label: "Meta spend", color: "#5eead4" }, { label: "aMER", color: "#facc15" }]} />
                </>
              )}
            </div>
          </div>

          {launched.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border text-xs text-text-muted">
                    <th className="px-2 py-2 text-left">Ad</th>
                    <th className="px-2 py-2 text-left">Format</th>
                    <th className="px-2 py-2 text-left">Launched</th>
                    <th className="px-2 py-2 text-right">First 30 days spend</th>
                    <th className="px-2 py-2 text-right">First 30 days ROAS</th>
                  </tr>
                </thead>
                <tbody>
                  {launched.map((a) => (
                    <tr key={a.adId} className={`border-b border-border/40 ${a.isCatalog ? "text-text-faint" : ""}`}>
                      <td className="px-2 py-1">
                        {a.name} {a.isCatalog && <span className="rounded-full border border-border px-1.5 text-[10px]">catalog</span>}
                      </td>
                      <td className="px-2 py-1">{FORMAT_LABEL[a.format]}</td>
                      <td className="px-2 py-1 tabular">{a.launchDate}</td>
                      <td className="px-2 py-1 text-right tabular">{money(a.spend30)}</td>
                      <td className="px-2 py-1 text-right tabular">{a.spend30 > 0 ? formatValue(a.revenue30 / a.spend30, "ratio2", client.currency) : "–"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
