"use client";

import Link from "next/link";
import { useMemo, useState, useSyncExternalStore } from "react";
import { DailyChart, type ChartSeries } from "./DailyChart";
import { DateRangePicker } from "./DateRangePicker";
import { MetricModal } from "./MetricModal";
import { MetricTile } from "./MetricTile";
import { theme } from "@/theme/theme";
import { useApp } from "@/lib/app-context";
import { compareSource, COMPARE_LABEL, defaultCompareMode, tileNumbers, useDashboardData, type DashData } from "@/lib/dashboard-data";
import { readScenarioChoice, writeScenarioChoice } from "@/lib/planning/scenarios";
import type { PlanScenario } from "@/lib/types";
import {
  comparisonRange,
  defaultHomeRange,
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
import { chartGranularity, dayRows, monthRows } from "@/lib/monthly";
import { homeReportHref } from "@/lib/reports/home-links";

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

  const [range, setRange] = useState<Range | null>(null);
  // null until the strategist picks one: then Home opens on Plan when there is a plan (see defaultCompareMode).
  const [chosenMode, setMode] = useState<CompareModeName | null>(null);
  const [customCmp, setCustomCmp] = useState<Range | null>(null);
  const [breakout, setBreakout] = useState(true);
  const [roasMode, setRoasMode] = useState<"iroas" | "roas" | "iroas_acq" | "roas_acq" | null>(null);
  const [chartType, setChartType] = useState<"sales" | "cm" | "mer">("sales");
  const [open, setOpen] = useState<Open | null>(null);

  // Default: the month so far (set once the page is running in the browser).
  const activeRange = useMemo(() => range ?? (today ? defaultHomeRange(today) : null), [range, today]);
  // Custom comparison period defaults to the period right before the selected range.
  const cmpRange = useMemo(
    () => (chosenMode === "custom" && activeRange ? (customCmp ?? comparisonRange("prev", activeRange)) : null),
    [chosenMode, activeRange, customCmp],
  );
  // Which plan the Plan comparison uses once the year has a stretch scenario; remembered per client in this browser.
  const [picked, setPicked] = useState<Record<string, PlanScenario>>({});
  const scenario: PlanScenario = client ? (picked[client.id] ?? readScenarioChoice(client.id)) : "baseline";
  const chooseScenario = (s: PlanScenario) => {
    if (!client) return;
    setPicked((p) => ({ ...p, [client.id]: s }));
    writeScenarioChoice(client.id, s);
    if (s === "target") setMode("plan");
  };
  const fresh = useDashboardData(client, settings, activeRange, cmpRange, scenario);
  // While only the plan scenario is being switched, keep showing the last numbers (dimmed) instead of the skeleton and a vanishing selector.
  const [last, setLast] = useState<DashData | null>(null);
  if (fresh && fresh !== last) setLast(fresh);
  const sameView = Boolean(last && client && activeRange && last.client.id === client.id && last.range.from === activeRange.from && last.range.to === activeRange.to);
  const data = fresh ?? (sameView ? last : null);
  const refreshing = !fresh && data !== null;
  const mode = defaultCompareMode(chosenMode, data?.hasPlan ?? false);

  if (!mounted || !client || !settings || !activeRange) return <Skeleton />;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <Controls
        range={activeRange}
        setRange={setRange}
        mode={mode}
        setMode={setMode}
        hasPlan={data?.hasPlan ?? false}
        hasStretch={data?.hasStretch ?? false}
        scenario={data?.hasStretch ? scenario : "baseline"}
        setScenario={chooseScenario}
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
        <div className={refreshing ? "opacity-60 transition-opacity" : undefined} aria-busy={refreshing}>
          <Body data={data} mode={mode} breakout={breakout} setBreakout={setBreakout} roasMode={roasMode ?? (settings.extra.showIncrementalByDefault ? "iroas" : "roas")} setRoasMode={setRoasMode} chartType={chartType} setChartType={setChartType} setOpen={setOpen} />
        </div>
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
  range: Range;
  setRange: (r: Range) => void;
  mode: CompareModeName;
  setMode: (m: CompareModeName) => void;
  hasPlan: boolean;
  hasStretch: boolean;
  scenario: PlanScenario;
  setScenario: (s: PlanScenario) => void;
  cmpRange: Range | null;
  setCmpRange: (r: Range) => void;
}) {
  const { range, setRange, mode, setMode, hasPlan, hasStretch, scenario, setScenario, cmpRange, setCmpRange } = props;
  const sel = "rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-text outline-none focus:border-accent";
  return (
    <div className="flex flex-wrap items-center gap-3">
      <h1 className="mr-auto text-xl font-semibold" style={{ fontFamily: "var(--apex-font-heading)" }}>
        Home
      </h1>
      <DateRangePicker value={range} onChange={setRange} />
      <label className="flex items-center gap-2 text-sm text-text-muted">
        Compare
        <select aria-label="Compare" className={sel} value={mode} onChange={(e) => setMode(e.target.value as CompareModeName)}>
          {hasPlan && <option value="plan">Plan</option>}
          <option value="yoy">Last year (YoY)</option>
          <option value="prev">Previous period</option>
          <option value="custom">Custom period</option>
        </select>
      </label>
      {hasStretch && (
        <label className="flex items-center gap-2 text-sm text-text-muted">
          Plan
          <select aria-label="Plan scenario" className={sel} value={scenario} onChange={(e) => setScenario(e.target.value as PlanScenario)}>
            <option value="baseline">Baseline</option>
            <option value="target">Stretch</option>
          </select>
        </label>
      )}
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
        reportHref={homeReportHref(def.key, data.range)}
      />
    );
  };
  const row = (keys: string[]) => keys.map((k) => tile(METRICS[k]));

  const cm = cmParts(data.cur, data.settings);
  const cmNums = tileNumbers(METRICS.cm, data, mode);
  const cmReportHref = homeReportHref("cm", data.range);
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
            {cmReportHref && (
              <Link
                href={cmReportHref}
                aria-label="Open the Contribution Margin report"
                title="Open report"
                className="flex h-7 w-7 items-center justify-center rounded-full border border-border text-text-faint hover:border-accent hover:text-accent"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.5 1.5" />
                  <path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.5-1.5" />
                </svg>
              </Link>
            )}
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
          <h3 className="text-sm font-medium text-text-muted">{chartGranularity(data.range) === "day" ? "Daily trend" : "Monthly trend"}</h3>
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

/** Trend chart: per day for ranges up to ~2 months, per month for longer ranges. */
function MainChart({ data, type, mode }: { data: DashData; type: "sales" | "cm" | "mer"; mode: CompareModeName }) {
  const cur = data.client.currency;
  const cmp = compareSource(data, mode);
  const c = theme.colors;
  const compareName = mode === "prev" ? "Previous period" : mode === "custom" ? "Comparison period" : "Last year";
  const gran = chartGranularity(data.range);
  const rowsFor = (def: MetricDef) => (gran === "day" ? dayRows(def, data, cmp) : monthRows(def, data, cmp));

  const view = useMemo(() => {
    if (type === "sales") {
      const rev = rowsFor(METRICS.orderRevenue);
      const sp = rowsFor(METRICS.adSpend);
      const out: ChartSeries[] = [
        { id: "rev", label: "Order revenue", kind: "bar", color: c.chartPrimary, values: rev.map((r) => r.actual) },
        { id: "spend", label: "Ad spend", kind: "bar", color: c.chartSecondary, values: sp.map((r) => r.actual) },
        { id: "trev", label: "Target revenue", kind: "line", color: c.chartTarget, values: rev.map((r) => r.target), dashed: true },
        { id: "tsp", label: "Target spend", kind: "line", color: c.bad, values: sp.map((r) => r.target), dashed: true },
      ];
      if (mode !== "plan" || !data.hasPlan) out.push({ id: "ly", label: `Revenue ${compareName.toLowerCase()}`, kind: "line", color: c.chartCompare, values: rev.map((r) => r.compare), dashed: true });
      return { keys: rev.map((r) => r.key), series: out.filter((x) => x.values.some((v) => v !== null)) };
    }
    const def = type === "cm" ? METRICS.cm : METRICS.mer;
    const rows = rowsFor(def);
    const out: ChartSeries[] = [
      { id: "a", label: def.label, kind: "line", color: c.chartPrimary, values: rows.map((r) => r.actual) },
      { id: "t", label: "Plan target", kind: "line", color: c.chartTarget, values: rows.map((r) => r.target), dashed: true },
      { id: "ly", label: compareName, kind: "line", color: c.chartCompare, values: rows.map((r) => r.compare), dashed: true },
    ];
    return { keys: rows.map((r) => r.key), series: out.filter((x) => x.values.some((v) => v !== null)) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, type, mode, gran]);

  const isRatio = type === "mer";
  return (
    <>
      <DailyChart
        dates={view.keys}
        labels={gran === "month" ? view.keys : undefined}
        series={view.series}
        height={340}
        smooth={type !== "sales" && gran === "month"}
        maxBarWidth={gran === "month" ? 44 : 28}
        formatValue={(v) => (isRatio ? v.toFixed(2) : formatValue(v, "currency0", cur))}
        formatAxis={(v) => (isRatio ? v.toFixed(1) : compactCurrency(v, cur))}
      />
      <p className="mt-2 text-xs text-text-faint">{gran === "day" ? "Daily view (ranges up to about 2 months). Choose a longer range to group by month." : "Monthly view (ranges longer than about 2 months). Choose a shorter range to see days."}</p>
    </>
  );
}
