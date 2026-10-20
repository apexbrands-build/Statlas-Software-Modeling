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
import { Legend } from "@/components/planning/models/charts";
import { MONTHS } from "@/components/planning/ui";

const FORMAT_COLOR: Record<AdFormat, string> = { video: "#5eead4", image: "#facc15", carousel: "#fb923c", other: "#94a3b8" };
const FORMAT_LABEL: Record<AdFormat, string> = { video: "Video", image: "Image", carousel: "Carousel", other: "Other" };

/** Daily Meta spend and AOV (each on its own scale) with a marker on every day ads launched. */
function SpendAovChart({ days, spend, aov, launches, money, aovFmt }: { days: string[]; spend: (number | null)[]; aov: (number | null)[]; launches: Map<string, number>; money: (v: number) => string; aovFmt: (v: number) => string }) {
  const w = 760;
  const h = 200;
  const pad = { l: 56, r: 56, t: 16, b: 24 };
  const max = (xs: (number | null)[]) => Math.max(1e-9, ...xs.map((v) => v ?? 0)) * 1.1;
  const sMax = max(spend);
  const aMax = max(aov);
  const n = Math.max(1, days.length - 1);
  const X = (i: number) => pad.l + (i / n) * (w - pad.l - pad.r);
  const Y = (v: number, m: number) => h - pad.b - (v / m) * (h - pad.t - pad.b);
  const path = (xs: (number | null)[], m: number) => {
    let d = "";
    xs.forEach((v, i) => {
      if (v == null) return;
      d += `${d && xs[i - 1] != null ? "L" : "M"}${X(i).toFixed(1)},${Y(v, m).toFixed(1)} `;
    });
    return d;
  };
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" role="img" aria-label="Daily Meta spend and AOV with the days ads launched">
      {[0, 0.5, 1].map((t) => (
        <g key={t}>
          <line x1={pad.l} x2={w - pad.r} y1={Y(sMax * t, sMax)} y2={Y(sMax * t, sMax)} stroke="currentColor" opacity={0.1} />
          <text x={pad.l - 6} y={Y(sMax * t, sMax) + 3} textAnchor="end" fontSize={10} fill="#5eead4">
            {money(sMax * t)}
          </text>
          <text x={w - pad.r + 6} y={Y(aMax * t, aMax) + 3} fontSize={10} fill="#facc15">
            {aovFmt(aMax * t)}
          </text>
        </g>
      ))}
      {days.map((d, i) => (Number(d.slice(8, 10)) % 5 === 1 ? (
        <text key={d} x={X(i)} y={h - 8} textAnchor="middle" fontSize={10} fill="currentColor" opacity={0.6}>
          {Number(d.slice(8, 10))}
        </text>
      ) : null))}
      {days.map((d, i) => {
        const count = launches.get(d);
        if (!count) return null;
        return (
          <g key={`l-${d}`}>
            <title>{`${d}: ${count} ad${count === 1 ? "" : "s"} launched`}</title>
            <line x1={X(i)} x2={X(i)} y1={pad.t} y2={h - pad.b} stroke="#fb923c" strokeWidth={1.5} strokeDasharray="3 3" />
            <text x={X(i)} y={pad.t - 4} textAnchor="middle" fontSize={10} fontWeight={700} fill="#fb923c">
              {count}
            </text>
          </g>
        );
      })}
      <path d={path(spend, sMax)} fill="none" stroke="#5eead4" strokeWidth={2} />
      <path d={path(aov, aMax)} fill="none" stroke="#facc15" strokeWidth={2} />
    </svg>
  );
}

/** One month in detail: how many ads launched, and daily Meta spend next to AOV with the launch days marked. No ad names or per-ad results: the Ad plan plans, Best Creatives analyses. */
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
    const metaSpend = days.map((d) => {
    const f = factByDate.get(d);
    return f ? (f.channels.meta_acquisition?.spend ?? 0) + (f.channels.meta_returning?.spend ?? 0) : null;
  });
  const aov = days.map((d) => {
    const f = factByDate.get(d);
    return f ? METRICS.aov.value(aggregate([f]), settings) : null;
  });

  const real = (data?.ads ?? []).filter((a) => !a.isCatalog);
  const launches = new Map<string, number>();
  for (const a of real) launches.set(a.launchDate, (launches.get(a.launchDate) ?? 0) + 1);
  const byFormat = AD_FORMATS.map((f) => ({ f, n: real.filter((a) => a.format === f).length })).filter((x) => x.n > 0);
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
          <div className="space-y-2">
            <p className="text-sm">
              <span className="tabular text-2xl font-semibold">{real.length}</span> <span className="text-text-muted">ad{real.length === 1 ? "" : "s"} launched in {name}</span>
              {byFormat.length > 0 && <span className="text-xs text-text-muted"> · {byFormat.map((x) => `${x.n} ${FORMAT_LABEL[x.f].toLowerCase()}`).join(", ")}</span>}
            </p>
            {real.length > 0 && (
              <p className="text-xs text-text-muted">
                Together they spent {money(spend7)} in their first 7 days and {money(spend30)} in their first 30.
              </p>
            )}
            {real.length === 0 && <p className="text-sm text-text-muted">{future ? "This month has not started." : "No ads launched this month."}</p>}
          </div>
          <div className="space-y-2">
            <h4 className="text-xs font-medium text-text-muted">Daily Meta spend and AOV, with the days ads launched</h4>
            {facts.length === 0 ? (
              <p className="text-sm text-text-muted">{future ? "No actuals yet: the month is still to come." : "No actuals for this month."}</p>
            ) : (
              <>
                <SpendAovChart days={days} spend={metaSpend} aov={aov} launches={launches} money={(v) => formatValue(v, "currency0", client.currency)} aovFmt={(v) => formatValue(v, "currency0", client.currency)} />
                <Legend items={[{ label: "Meta spend (left)", color: "#5eead4" }, { label: "AOV (right)", color: "#facc15" }, { label: "Ads launched that day", color: "#fb923c" }]} />
              </>
            )}
          </div>
        </>
      )}
    </section>
  );
}
