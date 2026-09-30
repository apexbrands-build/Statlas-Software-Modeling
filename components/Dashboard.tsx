"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { DailyChart, type ChartSeries } from "./DailyChart";
import { MetricModal } from "./MetricModal";
import { MetricTile } from "./MetricTile";
import { theme } from "@/theme/theme";
import { useApp } from "@/lib/app-context";
import { compareSource, COMPARE_LABEL, tileNumbers, useDashboardData, type DashData } from "@/lib/dashboard-data";
import {
  addDays,
  addMonths,
  comparisonRange,
  endOfMonth,
  startOfMonth,
  todayLocal,
  type CompareModeName,
  type Range,
} from "@/lib/dates";
import { compactCurrency, formatDiff, formatValue } from "@/lib/format";
import {
  channelGroups,
  channelMetricDefs,
  visibleGroups,
  cmParts,
  METRICS,
  multiplierLabel,
  type MetricDef,
} from "@/lib/metrics";
import { metricSeries } from "@/lib/series";

type Preset = "this_month" | "last_7" | "last_30" | "last_month" | "last_90" | "ytd" | "custom";

const PRESETS: { id: Preset; label: string }[] = [
  { id: "this_month", label: "This month" },
  { id: "last_7", label: "Last 7 days" },
  { id: "last_30", label: "Last 30 days" },
  { id: "last_month", label: "Last month" },
  { id: "last_90", label: "Last 90 days" },
  { id: "ytd", label: "Year to date" },
  { id: "custom", label: "Custom" },
];

function presetRange(p: Preset, today: string, custom: Range): Range {
  switch (p) {
    case "this_month":
      return { from: startOfMonth(today), to: endOfMonth(today) };
    case "last_7":
      return { from: addDays(today, -7), to: addDays(today, -1) };
    case "last_30":
      return { from: addDays(today, -30), to: addDays(today, -1) };
    case "last_month": {
      const m = addMonths(today, -1);
      return { from: startOfMonth(m), to: endOfMonth(m) };
    }
    case "last_90":
      return { from: addDays(today, -90), to: addDays(today, -1) };
    case "ytd":
      return { from: `${today.slice(0, 4)}-01-01`, to: addDays(today, -1) };
    default:
      return custom;
  }
}

interface Open {
  def: MetricDef;
  title?: string;
}

export function Dashboard() {
  const { client, settings } = useApp();
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const today = useMemo(() => (mounted ? todayLocal() : null), [mounted]);

  const [preset, setPreset] = useState<Preset>("this_month");
  const [custom, setCustom] = useState<Range>({ from: "2026-01-01", to: "2026-01-31" });
  const [mode, setMode] = useState<CompareModeName>("yoy");
  const [customCmp, setCustomCmp] = useState<Range | null>(null);
  const [breakout, setBreakout] = useState(true);
  const [roasMode, setRoasMode] = useState<"iroas" | "roas" | "iroas_acq" | "roas_acq" | null>(null);
  const [chartType, setChartType] = useState<"sales" | "cm" | "mer">("sales");
  const [open, setOpen] = useState<Open | null>(null);

  const range = useMemo(() => (today ? presetRange(preset, today, custom) : null), [preset, today, custom]);
  // Custom comparison period defaults to the period right before the selected range.
  const cmpRange = useMemo(
    () => (mode === "custom" && range ? (customCmp ?? comparisonRange("prev", range)) : null),
    [mode, range, customCmp],
  );
  const data = useDashboardData(client, settings, range, cmpRange);

  if (!mounted || !client || !settings || !range) return <Skeleton />;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <Controls
        preset={preset}
        setPreset={setPreset}
        range={range}
        setCustom={(r) => {
          setCustom(r);
          setPreset("custom");
        }}
        mode={mode}
        setMode={setMode}
        hasPlan={data?.hasPlan ?? false}
        cmpRange={cmpRange}
        setCmpRange={setCustomCmp}
      />
      {!data ? (
        <Skeleton />
      ) : data.cur.days === 0 ? (
        <div className="rounded-xl border border-border bg-surface p-8 text-center text-text-muted">
          No actual data in this range yet (data runs through {data.lastData}). Pick an earlier period.
        </div>
      ) : (
        <Body data={data} mode={mode} breakout={breakout} setBreakout={setBreakout} roasMode={roasMode ?? (settings.extra.showIncrementalByDefault ? "iroas" : "roas")} setRoasMode={setRoasMode} chartType={chartType} setChartType={setChartType} setOpen={setOpen} />
      )}
      {open && data && <MetricModal def={open.def} title={open.title} data={data} mode={mode} onClose={() => setOpen(null)} />}
    </div>
  );
}

function Skeleton() {
  return (
    <div className="mx-auto max-w-6xl animate-pulse space-y-4">
      <div className="h-10 w-2/3 rounded-lg bg-surface" />
      <div className="h-32 rounded-xl bg-surface" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-24 rounded-xl bg-surface" />
        ))}
      </div>
    </div>
  );
}

function Controls(props: {
  preset: Preset;
  setPreset: (p: Preset) => void;
  range: Range;
  setCustom: (r: Range) => void;
  mode: CompareModeName;
  setMode: (m: CompareModeName) => void;
  hasPlan: boolean;
  cmpRange: Range | null;
  setCmpRange: (r: Range) => void;
}) {
  const { preset, setPreset, range, setCustom, mode, setMode, hasPlan, cmpRange, setCmpRange } = props;
  const sel = "rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-text outline-none focus:border-accent";
  return (
    <div className="flex flex-wrap items-center gap-3">
      <h1 className="mr-auto text-xl font-semibold" style={{ fontFamily: "var(--apex-font-heading)" }}>
        Home
      </h1>
      <select aria-label="Period" className={sel} value={preset} onChange={(e) => setPreset(e.target.value as Preset)}>
        {PRESETS.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
      </select>
      <div className="flex items-center gap-1.5 text-sm text-text-muted">
        <input aria-label="From" type="date" className={sel} value={range.from} max={range.to} onChange={(e) => e.target.value && setCustom({ from: e.target.value, to: range.to })} />
        →
        <input aria-label="To" type="date" className={sel} value={range.to} min={range.from} onChange={(e) => e.target.value && setCustom({ from: range.from, to: e.target.value })} />
      </div>
      <label className="flex items-center gap-2 text-sm text-text-muted">
        Compare
        <select aria-label="Compare" className={sel} value={mode} onChange={(e) => setMode(e.target.value as CompareModeName)}>
          {hasPlan && <option value="plan">Plan</option>}
          <option value="yoy">Last year (YoY)</option>
          <option value="prev">Previous period</option>
          <option value="custom">Custom period</option>
        </select>
      </label>
      {mode === "custom" && cmpRange && (
        <div className="flex items-center gap-1.5 text-sm text-text-muted">
          <input aria-label="Comparison from" type="date" className={sel} value={cmpRange.from} max={cmpRange.to} onChange={(e) => e.target.value && setCmpRange({ from: e.target.value, to: cmpRange.to })} />
          →
          <input aria-label="Comparison to" type="date" className={sel} value={cmpRange.to} min={cmpRange.from} onChange={(e) => e.target.value && setCmpRange({ from: cmpRange.from, to: e.target.value })} />
        </div>
      )}
    </div>
  );
}

function Body(props: {
  data: DashData;
  mode: CompareModeName;
  breakout: boolean;
  setBreakout: (b: boolean) => void;
  roasMode: "iroas" | "roas" | "iroas_acq" | "roas_acq";
  setRoasMode: (m: "iroas" | "roas" | "iroas_acq" | "roas_acq") => void;
  chartType: "sales" | "cm" | "mer";
  setChartType: (c: "sales" | "cm" | "mer") => void;
  setOpen: (o: Open) => void;
}) {
  const { data, mode, breakout, setBreakout, roasMode, setRoasMode, chartType, setChartType, setOpen } = props;
  const cur = data.client.currency;
  const partial = data.effTo < data.range.to;

  const tile = (def: MetricDef, title?: string) => {
    const n = tileNumbers(def, data, mode);
    return (
      <MetricTile
        key={def.key}
        label={title ?? def.label}
        value={formatValue(n.actual, def.format, cur)}
        refValue={n.ref === null ? null : formatValue(n.ref, def.format, cur)}
        diff={formatDiff(n.diff)}
        tone={n.tone}
        source={def.source}
        formula={def.formula}
        onInfo={() => setOpen({ def, title })}
      />
    );
  };
  const row = (keys: string[]) => keys.map((k) => tile(METRICS[k]));

  const cm = cmParts(data.cur, data.settings);
  const cmNums = tileNumbers(METRICS.cm, data, mode);
  const incremental = roasMode === "iroas" || roasMode === "iroas_acq";
  const acquisitionOnly = roasMode === "iroas_acq" || roasMode === "roas_acq";
  const groups = visibleGroups(channelGroups(breakout, acquisitionOnly), data.cur);

  return (
    <>
      <p className="text-xs text-text-faint">
        {data.range.from} → {data.range.to}
        {partial ? ` · actuals through ${data.effTo}, ${COMPARE_LABEL[mode]} covers the same elapsed days` : ""} · {data.client.name} ·{" "}
        {mode === "plan" && data.planName
          ? data.planName
          : mode === "custom" && data.customRange
            ? `vs ${data.customRange.from} → ${data.customRange.to}`
            : COMPARE_LABEL[mode]}
      </p>

      {/* Hero: contribution margin */}
      <section className="rounded-2xl border border-border bg-surface p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold tracking-wide" style={{ fontFamily: "var(--apex-font-heading)" }}>
              CONTRIBUTION MARGIN
            </h2>
            <p className="mt-1 text-xs text-text-muted">Net Sales + Shipping − COGS − Ad Spend − Cost of delivery</p>
          </div>
          <div className="flex items-start gap-3">
            <div className="text-right">
              <div className="tabular text-4xl font-bold" style={{ fontFamily: "var(--apex-font-heading)" }}>
                {formatValue(cmNums.actual, "currency0", cur)}
              </div>
              <div className={`tabular text-sm ${cmNums.tone === "good" ? "text-good" : cmNums.tone === "bad" ? "text-bad" : "text-text-muted"}`}>
                {cmNums.ref !== null ? `${formatValue(cmNums.ref, "currency0", cur)} ${COMPARE_LABEL[mode].replace("vs ", "")} · ` : ""}
                {formatDiff(cmNums.diff)}
              </div>
            </div>
            <button
              type="button"
              aria-label="Trend for Contribution Margin"
              onClick={() => setOpen({ def: METRICS.cm })}
              className="flex h-7 w-7 items-center justify-center rounded-full border border-border text-xs font-semibold text-text-faint hover:border-accent hover:text-accent"
            >
              i
            </button>
          </div>
        </div>
        <div className="tabular mt-4 flex flex-wrap gap-x-5 gap-y-1 text-xs text-text-muted">
          <span>Net sales {formatValue(cm.netSales, "currency0", cur)}</span>
          <span>Shipping +{formatValue(cm.shipping, "currency0", cur)}</span>
          <span>COGS −{formatValue(cm.cogs, "currency0", cur)}</span>
          <span>Ad spend −{formatValue(cm.adSpend, "currency0", cur)}</span>
          <span>Cost of delivery −{formatValue(cm.costOfDelivery, "currency0", cur)}</span>
          <span>CM % of net sales + shipping {formatValue(cm.netSales + cm.shipping ? cm.cm / (cm.netSales + cm.shipping) : null, "percent1", cur)}</span>
        </div>
      </section>

      <Grid cols={5}>{row(["orderRevenue", "adSpend", "mer", "aov", "orders"])}</Grid>

      {/* Chart */}
      <section className="rounded-2xl border border-border bg-surface p-5">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-medium text-text-muted">Daily trend</h3>
          <select
            aria-label="Chart"
            value={chartType}
            onChange={(e) => setChartType(e.target.value as "sales" | "cm" | "mer")}
            className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm outline-none focus:border-accent"
          >
            <option value="sales">Sales &amp; Spend</option>
            <option value="cm">Contribution Margin</option>
            <option value="mer">MER</option>
          </select>
        </div>
        <MainChart data={data} type={chartType} mode={mode} />
      </section>

      <Section title="Returning customers">{<Grid cols={4}>{row(["returningRevenue", "returningOrders", "returningAov", "repeatRate"])}</Grid>}</Section>
      <Section title="New customers">
        <Grid cols={5}>{row(["newRevenue", "newOrders", "newAov", "weightedCac", "amer"])}</Grid>
      </Section>
      <Section title="Paid (incremental)">
        <Grid cols={5}>{row(["paidIRevenue", "paidIOrders", "paidAov", "paidICac", "ipaMer"])}</Grid>
      </Section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-4">
          <h3 className="text-sm font-medium uppercase tracking-wide text-text-muted">Channel performance</h3>
          <select aria-label="Channel metric" value={roasMode} onChange={(e) => setRoasMode(e.target.value as typeof roasMode)} className="rounded-lg border border-border bg-surface px-2 py-1 text-xs outline-none focus:border-accent">
            <option value="roas">ROAS</option>
            <option value="iroas">iROAS</option>
            <option value="roas_acq">ROAS - Acquisition Only</option>
            <option value="iroas_acq">iROAS - Acquisition Only</option>
          </select>
          <label className="flex items-center gap-2 text-xs text-text-muted">
            <input type="checkbox" checked={breakout && !acquisitionOnly} disabled={acquisitionOnly} onChange={(e) => setBreakout(e.target.checked)} className="accent-[var(--apex-accent)]" />
            Break out Non-Acquisition (Google Brand, Meta returning...)
          </label>
          <span className="text-xs text-text-faint">Incrementality factors are editable in Store Settings</span>
        </div>
        {groups.map((g) => {
          const defs = channelMetricDefs(g, incremental);
          return (
            <Grid key={g.id} cols={5}>
              {defs.map((d) => tile(d, incremental && d.key.endsWith(".irev") ? multiplierLabel(g, data.settings, data.cur) : undefined))}
            </Grid>
          );
        })}
      </section>

      <Section title="Email">
        <Grid cols={5}>{row(["emailRevenue", "emailOrders", "emailCampaignRevenue", "emailFlowRevenue", "emailRevPer1k"])}</Grid>
      </Section>
      <Section title="Organic">
        <Grid cols={4}>{row(["organicRevenue", "organicOrders", "organicAov", "organicPctOfPaid"])}</Grid>
      </Section>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-medium uppercase tracking-wide text-text-muted">{title}</h3>
      {children}
    </section>
  );
}

function Grid({ cols, children }: { cols: 4 | 5; children: React.ReactNode }) {
  return <div className={`grid grid-cols-2 gap-3 ${cols === 5 ? "md:grid-cols-5" : "md:grid-cols-4"}`}>{children}</div>;
}

function MainChart({ data, type, mode }: { data: DashData; type: "sales" | "cm" | "mer"; mode: CompareModeName }) {
  const cur = data.client.currency;
  const cmp = compareSource(data, mode);
  const ctx = { dates: data.dates, facts: data.facts, cmpFacts: cmp.facts, cmpDate: cmp.date, plan: data.plan, settings: data.settings };
  const c = theme.colors;

  const series: ChartSeries[] = useMemo(() => {
    if (type === "sales") {
      const rev = metricSeries(METRICS.orderRevenue, ctx);
      const sp = metricSeries(METRICS.adSpend, ctx);
      const out: ChartSeries[] = [
        { id: "rev", label: "Order revenue", kind: "bar", color: c.chartPrimary, values: rev.actual },
        { id: "spend", label: "Ad spend", kind: "bar", color: c.chartSecondary, values: sp.actual },
        { id: "trev", label: "Target revenue", kind: "line", color: c.chartTarget, values: rev.target, dashed: true },
        { id: "tsp", label: "Target spend", kind: "line", color: c.bad, values: sp.target, dashed: true },
      ];
      if (mode !== "plan" || !data.hasPlan) out.push({ id: "ly", label: `Revenue ${cmp.label.toLowerCase()}`, kind: "line", color: c.chartCompare, values: rev.compare, dashed: true });
      // No plan = no targets: drop any series with no values.
      return out.filter((s) => s.values.some((v) => v !== null));
    }
    const def = type === "cm" ? METRICS.cm : METRICS.mer;
    const s = metricSeries(def, ctx);
    const out: ChartSeries[] = [
      { id: "a", label: def.label, kind: "line", color: c.chartPrimary, values: s.actual },
      { id: "t", label: "Plan target", kind: "line", color: c.chartTarget, values: s.target, dashed: true },
      { id: "ly", label: cmp.label, kind: "line", color: c.chartCompare, values: s.compare, dashed: true },
    ];
    return out.filter((x) => x.values.some((v) => v !== null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, type, mode]);

  const isRatio = type === "mer";
  return (
    <DailyChart
      dates={data.dates}
      series={series}
      height={340}
      formatValue={(v) => (isRatio ? v.toFixed(2) : formatValue(v, "currency0", cur))}
      formatAxis={(v) => (isRatio ? v.toFixed(1) : compactCurrency(v, cur))}
    />
  );
}
