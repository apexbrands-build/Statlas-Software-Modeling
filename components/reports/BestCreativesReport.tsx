"use client";

import { useEffect, useMemo, useState } from "react";
import { Empty, Loading, ReportFrame, selectClass, useReportRange } from "./ReportFrame";
import { ReportTable, type Cell, type Column, type Row } from "./ReportTable";
import { useApp } from "@/lib/app-context";
import type { CreativeSort } from "@/lib/creative/aggregate";
import { adMetrics, attributionCaption, benchmark, CREATIVE_METRICS, metricTone, storeMargin, sumFormats, trendLabel, wowWindows, daysLive, type AdAgg, type CreativeMetric, type CreativeTotals, type FormatTotals, type WowWindows } from "@/lib/creative/best-creatives";
import { AD_FORMATS, type AdFormat } from "@/lib/creative/types";
import { usDate } from "@/lib/dates";
import { formatValue } from "@/lib/format";
import { aggregate } from "@/lib/metrics";
import { getRepository } from "@/lib/repository";

const PAGE = 50;
const METRIC_ORDER: CreativeMetric[] = ["spend", "estCm", "revenue", "roas", "purchases", "cpa", "ctr", "cpm", "share"];
const SORTS: { id: CreativeSort; label: string }[] = [
  { id: "spend", label: "Spend" },
  { id: "revenue", label: "Revenue" },
  { id: "roas", label: "ROAS" },
  { id: "purchases", label: "Purchases" },
  { id: "estCm", label: "Est. CM" },
  { id: "gain", label: "Spend gain (last 7 days)" },
];
const FORMAT_LABEL: Record<AdFormat, string> = { video: "Video", image: "Image", carousel: "Carousel", other: "Other" };

type Status = "ok" | "not_set" | "none" | "missing" | "no_spend" | "error";
interface Loaded {
  key: string;
  status: Status;
  message?: string;
  windows: WowWindows | null;
  formats: FormatTotals[];
  totals: CreativeTotals;
  margin: number | null;
  rows: AdAgg[];
  total: number;
}
const NO_TOTALS: CreativeTotals = { ads: 0, spend: 0, revenue: 0, purchases: 0, impressions: 0, clicks: 0, cur: { spend: 0, revenue: 0 }, prev: { spend: 0, revenue: 0 } };
const failed = (key: string, status: Status, message?: string): Loaded => ({ key, status, message, windows: null, formats: [], totals: NO_TOTALS, margin: null, rows: [], total: 0 });

const chip = (on: boolean) => `rounded-full border px-3 py-1 text-xs ${on ? "border-accent bg-accent/15 text-text" : "border-border text-text-muted hover:text-text"}`;

/** Best Creatives: the client's Meta ads for a date range, ranked and set against the account's own average. */
export function BestCreativesReport() {
  const { client, settings } = useApp();
  const { range, setRange } = useReportRange();
  const [metrics, setMetrics] = useState<Set<CreativeMetric>>(new Set(["spend", "estCm", "revenue", "roas"]));
  const [sort, setSort] = useState<CreativeSort>("spend");
  const [format, setFormat] = useState<AdFormat | "all">("all");
  const [catalog, setCatalog] = useState<"all" | "exclude" | "only">("all");
  const [live, setLive] = useState<"all" | "live" | "not_live">("all");
  const [campaignText, setCampaignText] = useState("");
  const [campaign, setCampaign] = useState("");
  const [showCampaign, setShowCampaign] = useState(true);
  const [fullNames, setFullNames] = useState(false);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [busy, setBusy] = useState(false);

  const key = client && range ? `${client.id}|${range.from}|${range.to}|${sort}|${format}|${catalog}|${live}|${campaign}` : null;

  useEffect(() => {
    if (!client || !range || !key || !settings) return;
    let cancel = false;
    const done = (l: Loaded) => !cancel && setLoaded(l);
    (async () => {
      try {
        const repo = getRepository();
        const last = await repo.getLastAdDate(client.id);
        if (last === undefined) return done(failed(key, "not_set"));
        if (last === null) return done(failed(key, "none"));
        const windows = wowWindows(range.to, last);
        const [formats, facts] = await Promise.all([repo.getCreativeFormats(client.id, range.from, range.to, windows), repo.getFacts(client.id, range.from, range.to)]);
        if (!formats) return done(failed(key, "missing"));
        const totals = sumFormats(formats);
        if (totals.ads === 0) return done({ ...failed(key, "no_spend"), windows, formats, totals });
        const margin = storeMargin(aggregate(facts), settings);
        const page = await repo.getCreativeAds(client.id, { from: range.from, to: range.to, windows, format, campaign, catalog, live, sort, margin, limit: PAGE, offset: 0 });
        if (!page) return done(failed(key, "missing"));
        done({ key, status: "ok", windows, formats, totals, margin, rows: page.rows, total: page.total });
      } catch (e) {
        done(failed(key, "error", e instanceof Error ? e.message : "Could not load the ads"));
      }
    })();
    return () => {
      cancel = true;
    };
  }, [client, range, key, settings, sort, format, catalog, live, campaign]);

  const data = loaded && loaded.key === key ? loaded : null;

  const loadMore = async () => {
    if (!client || !range || !data || data.status !== "ok") return;
    setBusy(true);
    try {
      const page = await getRepository().getCreativeAds(client.id, { from: range.from, to: range.to, windows: data.windows, format, campaign, catalog, live, sort, margin: data.margin, limit: PAGE, offset: data.rows.length });
      if (page) {
        setLoaded((cur) => {
          if (!cur || cur.key !== data.key) return cur;
          const have = new Set(cur.rows.map((r) => r.adId));
          return { ...cur, rows: [...cur.rows, ...page.rows.filter((r) => !have.has(r.adId))], total: page.total || cur.total };
        });
      }
    } finally {
      setBusy(false);
    }
  };

  const currency = client?.currency ?? "GBP";
  const bench = useMemo(() => (data ? benchmark(data.totals, data.margin) : null), [data]);
  const fmt = (m: CreativeMetric, v: number | null) => formatValue(v, CREATIVE_METRICS[m].format, currency);
  const shown = METRIC_ORDER.filter((m) => metrics.has(m));

  const toggleMetric = (m: CreativeMetric) =>
    setMetrics((cur) => {
      const next = new Set(cur);
      if (next.has(m)) {
        if (next.size > 1) next.delete(m);
      } else next.add(m);
      return next;
    });

  const controls = (
    <div className="flex flex-wrap items-center gap-2">
      <select className={selectClass} value={sort} onChange={(e) => setSort(e.target.value as CreativeSort)} aria-label="Rank by">
        {SORTS.map((s) => (
          <option key={s.id} value={s.id}>
            Rank by {s.label}
          </option>
        ))}
      </select>
      <select className={selectClass} value={format} onChange={(e) => setFormat(e.target.value as AdFormat | "all")} aria-label="Format">
        <option value="all">All formats</option>
        {AD_FORMATS.map((f) => (
          <option key={f} value={f}>
            {FORMAT_LABEL[f]}
          </option>
        ))}
      </select>
      <select className={selectClass} value={catalog} onChange={(e) => setCatalog(e.target.value as typeof catalog)} aria-label="Catalog ads">
        <option value="all">All ads</option>
        <option value="exclude">Exclude catalog</option>
        <option value="only">Only catalog</option>
      </select>
      <select className={selectClass} value={live} onChange={(e) => setLive(e.target.value as typeof live)} aria-label="Status">
        <option value="all">Live and not live</option>
        <option value="live">Live</option>
        <option value="not_live">Not live</option>
      </select>
      <input
        aria-label="Campaign contains"
        placeholder="Campaign contains"
        className={`${selectClass} w-44`}
        value={campaignText}
        onChange={(e) => setCampaignText(e.target.value)}
        onBlur={() => setCampaign(campaignText.trim())}
        onKeyDown={(e) => e.key === "Enter" && setCampaign(campaignText.trim())}
      />
    </div>
  );

  let body;
  if (!client || !range || !data) body = <Loading />;
  else if (data.status === "not_set") body = <Empty>Ad-level reporting is not set up on this database yet.</Empty>;
  else if (data.status === "none") body = <Empty>No ad-level data yet: it arrives with the next Meta sync or a history load (Store Settings, Meta).</Empty>;
  else if (data.status === "missing") body = <Empty>Best Creatives needs the ad-level read functions, which this database does not have yet.</Empty>;
  else if (data.status === "error") body = <Empty>Could not load the ads: {data.message}</Empty>;
  else if (data.status === "no_spend") body = <Empty>No Meta ad spend in this range.</Empty>;
  else if (bench) {
    const w = data.windows;
    const columns: Column[] = [
      ...(showCampaign ? [{ label: "Campaign" }] : []),
      { label: "Format" },
      { label: "Launched" },
      { label: "Days live" },
      { label: "Last spend" },
      ...shown.map((m) => ({ label: CREATIVE_METRICS[m].label })),
      { label: "Trend (7 days)" },
    ];
    const clip = (s: string) => (fullNames || s.length <= 42 ? s : `${s.slice(0, 41)}…`);
    const rows: Row[] = data.rows.map((a) => {
      const m = adMetrics(a, data.totals, data.margin);
      const faint = a.isCatalog;
      const cell = (text: string, tone?: Cell["tone"]): Cell => ({ text, tone, faint });
      return {
        key: a.adId,
        label: `${clip(a.name)}${a.isCatalog ? " (catalog)" : ""}`,
        cells: [
          ...(showCampaign ? [cell(a.campaignName ?? "–")] : []),
          cell(FORMAT_LABEL[a.format]),
          cell(a.launched ? usDate(a.launched) : "–"),
          cell(String(daysLive(a))),
          cell(a.lastSpend ? usDate(a.lastSpend) : "–"),
          ...shown.map((k) => cell(fmt(k, m[k]), metricTone(k, m[k], bench))),
          cell(trendLabel(a, w)),
        ],
      };
    });
    const total: Row = {
      key: "benchmark",
      label: "Account average",
      cells: [...(showCampaign ? [{ text: "" }] : []), { text: "" }, { text: "" }, { text: "" }, { text: "" }, ...shown.map((k) => ({ text: fmt(k, bench[k]) })), { text: "" }],
    };
    const t = data.totals;
    const cards: [string, string][] = [
      ["Ads that spent", String(t.ads)],
      ["Spend", fmt("spend", t.spend)],
      ["Revenue", fmt("revenue", t.revenue)],
      ["ROAS", fmt("roas", bench.roas)],
      ["CPA", fmt("cpa", bench.cpa)],
      ["Est. CM", data.margin === null ? "–" : fmt("estCm", t.revenue * data.margin - t.spend)],
    ];
    body = (
      <>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {cards.map(([label, value]) => (
            <div key={label} className="rounded-xl border border-border bg-surface p-3 text-center">
              <div className="text-[11px] font-medium uppercase tracking-wide text-text-muted">{label}</div>
              <div className="tabular mt-1 text-lg font-semibold">{value}</div>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {data.formats.map((f) => {
            const roas = f.spend > 0 ? f.revenue / f.spend : null;
            const tone = metricTone("roas", roas, bench);
            return (
              <div key={f.format} className="rounded-xl border border-border bg-surface p-3">
                <div className="flex items-baseline justify-between text-xs text-text-muted">
                  <span className="font-medium text-text">{FORMAT_LABEL[f.format]}</span>
                  <span>{f.ads} ad{f.ads === 1 ? "" : "s"}</span>
                </div>
                <div className="tabular mt-1 text-sm">
                  {t.spend > 0 ? formatValue(f.spend / t.spend, "percent1", currency) : "–"} of spend ·{" "}
                  <span className={tone === "good" ? "text-good" : tone === "bad" ? "text-bad" : ""}>ROAS {roas === null ? "–" : formatValue(roas, "ratio2", currency)}</span>
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Metrics">
          <span className="text-xs text-text-muted">Metrics</span>
          {METRIC_ORDER.map((m) => (
            <button key={m} type="button" className={chip(metrics.has(m))} aria-pressed={metrics.has(m)} onClick={() => toggleMetric(m)}>
              {CREATIVE_METRICS[m].label}
            </button>
          ))}
          <label className="ml-auto flex items-center gap-1.5 text-xs text-text-muted">
            <input type="checkbox" checked={showCampaign} onChange={(e) => setShowCampaign(e.target.checked)} /> Campaign name
          </label>
          <label className="flex items-center gap-1.5 text-xs text-text-muted">
            <input type="checkbox" checked={fullNames} onChange={(e) => setFullNames(e.target.checked)} /> Full ad names
          </label>
        </div>

        {data.rows.length === 0 ? <Empty>No ads match these filters.</Empty> : <ReportTable columns={columns} rows={rows} total={total} firstLabel="Ad" filename="best-creatives" />}

        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs text-text-muted">
            Showing {data.rows.length.toLocaleString("en-US")} of {data.total.toLocaleString("en-US")} ad{data.total === 1 ? "" : "s"}
          </span>
          {data.rows.length < data.total && (
            <button type="button" className="rounded-lg border border-border px-3 py-1.5 text-xs hover:border-accent" onClick={loadMore} disabled={busy}>
              {busy ? "Loading…" : "Load more"}
            </button>
          )}
        </div>

        <div className="space-y-1 text-xs text-text-faint">
          <p>
            {attributionCaption(settings?.extra ?? ({} as never))}. Amounts are in the ad account&apos;s currency, shown as {currency}.
          </p>
          <p>
            {data.margin === null
              ? "Est. CM needs order revenue in this range, which this range does not have."
              : `Est. CM = ad revenue × the store's margin before ads (${formatValue(data.margin, "percent1", currency)} in this range) − spend; Meta cannot know an ad's real margin.`}
          </p>
          <p>The account average is every Meta ad in the period (spend, revenue, purchases and Est. CM per ad that spent); filters do not change it. Colours: within 10% of it is grey.</p>
          {w && (
            <p>
              Trend compares spend in the last 7 days ({usDate(w.cur.from)} – {usDate(w.cur.to)}) with the 7 before ({usDate(w.prev.from)} – {usDate(w.prev.to)}).
            </p>
          )}
        </div>
      </>
    );
  }

  return (
    <ReportFrame slug="best-creatives" range={range} setRange={setRange} controls={controls}>
      {body}
    </ReportFrame>
  );
}
