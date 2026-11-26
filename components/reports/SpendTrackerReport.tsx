"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { DailyChart, type ChartSeries } from "@/components/DailyChart";
import { Empty, Loading, ReportFrame, selectClass } from "./ReportFrame";
import { useApp } from "@/lib/app-context";
import { addMonths, dayOfWeek, endOfMonth, todayLocal } from "@/lib/dates";
import { compactCurrency, formatDiff, formatValue, type Format } from "@/lib/format";
import { compare, factor, type Tone } from "@/lib/metrics";
import type { MarketingEvent } from "@/lib/planning/events";
import { planRoasTargets, roasOf, type MonthRoasTargets } from "@/lib/planning/roas";
import { pickPlan, readScenarioChoice } from "@/lib/planning/scenarios";
import { getReport } from "@/lib/reports/registry";
import { getRepository } from "@/lib/repository";
import { buildTracker, SHARE_WINDOWS, TRACKER_PLATFORMS, trackerLoadFrom, trackerOfSlug, type ShareWindow } from "@/lib/trackers/spend-tracker";
import type { CampaignDay, PlanTargetDay } from "@/lib/types";
import { theme } from "@/theme/theme";

const TONE: Record<Tone, string> = { good: "text-good", bad: "text-bad", neutral: "text-text-muted" };
const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const monthName = (m: string) => new Date(`${m.slice(0, 7)}-15T12:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

interface Loaded {
  key: string;
  lastData: string;
  campaigns: CampaignDay[];
  plan: PlanTargetDay[];
  planName: string | null;
  targets: MonthRoasTargets | null;
  events: MarketingEvent[];
  launches: { date: string; campaign: string }[];
}

function download(name: string, head: string[], rows: (string | number | null)[][]) {
  const esc = (v: string | number | null) => (v === null ? "" : typeof v === "number" ? String(Math.round(v * 100) / 100) : `"${v.replace(/"/g, '""')}"`);
  const url = URL.createObjectURL(new Blob([[head.map(esc).join(","), ...rows.map((r) => r.map(esc).join(","))].join("\n")], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * The spend tracker of one ad platform: the month's daily targets from the plan, what was spent, where the month is heading at the pace
 * so far, the share of it each campaign carries and the return against target. Numbers come from `buildTracker`.
 */
export function SpendTrackerReport({ slug }: { slug: string }) {
  const { client, settings } = useApp();
  const platform = trackerOfSlug(slug);
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const [picked, setPicked] = useState<string | null>(null);
  const [shareDays, setShareDays] = useState<ShareWindow>(28);
  const [incremental, setIncremental] = useState(false);
  const [excludeTests, setExcludeTests] = useState<boolean | null>(null);
  const [campaignId, setCampaignId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  const thisMonth = mounted ? todayLocal().slice(0, 7) : null;
  const month = picked ?? thisMonth;
  const months = useMemo(() => (thisMonth ? Array.from({ length: 15 }, (_, i) => addMonths(`${thisMonth}-01`, 2 - i).slice(0, 7)) : []), [thisMonth]);
  const key = client && platform && month ? `${client.id}|${platform.id}|${month}` : null;

  useEffect(() => {
    if (!client || !settings || !platform || !month || !key) return;
    let cancel = false;
    (async () => {
      const repo = getRepository();
      const from = `${month}-01`;
      const to = endOfMonth(from);
      const lastData = await repo.getLastDataDate(client.id);
      const plan = pickPlan(await repo.listPlans(client.id), Number(month.slice(0, 4)), readScenarioChoice(client.id));
      const [campaigns, planRows, targets, events, launches] = await Promise.all([
        repo.getCampaignDays(client.id, trackerLoadFrom(month, lastData, 28), to),
        plan ? repo.getPlanTargets(client.id, plan.id, from, to) : Promise.resolve([]),
        plan
          ? repo
              .getPlanMonths(plan.id)
              .then((m) => planRoasTargets(m, settings))
              .catch(() => null)
          : Promise.resolve(null),
        repo.listEvents(client.id).catch(() => []),
        platform.id === "meta" ? repo.getMetaLaunches(client.id, { from, to }).catch(() => undefined) : Promise.resolve(undefined),
      ]);
      if (!cancel) setLoaded({ key, lastData, campaigns, plan: planRows, planName: plan?.name ?? null, targets, events, launches: launches ?? [] });
    })();
    return () => {
      cancel = true;
    };
  }, [client, settings, platform, month, key]);

  const testsOut = excludeTests ?? settings?.extra.excludeTestCampaigns ?? false;
  const tracker = useMemo(() => {
    if (!settings || !platform || !month || !loaded || loaded.key !== key) return null;
    return buildTracker({
      platform: platform.id,
      month,
      lastData: loaded.lastData,
      campaigns: loaded.campaigns,
      plan: loaded.plan,
      roasOf: loaded.targets ? roasOf(loaded.targets) : null,
      settings,
      events: loaded.events,
      launches: loaded.launches,
      shareDays,
      excludeTests: testsOut,
      campaignId,
    });
  }, [settings, platform, month, loaded, key, shareDays, testsOut, campaignId]);

  const cur = client?.currency ?? "USD";
  const f = (v: number | null, fmt: Format = "currency0") => formatValue(v, fmt, cur);
  const versus = (value: number | null, ref: number | null, dir: "up" | "down" = "up") => {
    const c = compare(value, ref, dir);
    return { text: c.diff === null ? "" : formatDiff(c.diff), tone: c.tone };
  };

  if (!platform) return <Empty>Unknown tracker.</Empty>;
  const controls = (
    <>
      <div className="flex items-center gap-1" role="tablist" aria-label="Ad platform">
        {TRACKER_PLATFORMS.filter((p) => getReport(p.slug)?.status === "ready").map((p) => (
          <Link key={p.id} href={`/reporting/${p.slug}`} role="tab" aria-selected={p.id === platform.id} className={`rounded-lg border px-3 py-1.5 text-sm ${p.id === platform.id ? "border-accent text-text" : "border-border text-text-muted hover:text-text"}`}>
            {p.label}
          </Link>
        ))}
      </div>
      <label className="flex items-center gap-2 text-sm text-text-muted">
        Month
        <select
          aria-label="Month"
          className={selectClass}
          value={month ?? ""}
          onChange={(e) => {
            setPicked(e.target.value);
            setCampaignId(null);
          }}
        >
          {months.map((m) => (
            <option key={m} value={m}>
              {monthName(m)}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-2 text-sm text-text-muted" title="A campaign's share is its part of the platform's spend over these last days with data. Its target and projection are the platform's times that share.">
        Campaign shares from the last
        <select aria-label="Days the campaign shares are read over" className={selectClass} value={shareDays} onChange={(e) => setShareDays(Number(e.target.value) as ShareWindow)}>
          {SHARE_WINDOWS.map((d) => (
            <option key={d} value={d}>
              {d} days
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-2 text-sm text-text-muted" title="iROAS = platform ROAS x the channel's incrementality factor (Store Settings).">
        <input type="checkbox" checked={incremental} onChange={(e) => setIncremental(e.target.checked)} />
        Show iROAS
      </label>
      <label className="flex items-center gap-2 text-sm text-text-muted">
        <input type="checkbox" checked={testsOut} onChange={(e) => setExcludeTests(e.target.checked)} />
        Leave out test campaigns
      </label>
    </>
  );

  if (!client || !settings || !tracker || !month) {
    return (
      <ReportFrame slug={slug} range={null} controls={controls}>
        <Loading />
      </ReportFrame>
    );
  }

  const s = tracker.summary;
  const roasNow = incremental ? s.iRoas : s.roas;
  const roasGoal = incremental ? s.iRoasTarget : s.roasTarget;
  const word = incremental ? "iROAS" : "ROAS";
  const spentVs = versus(s.spentToDate, s.targetToDate);
  const headingVs = versus(s.projectedMonth, s.targetMonth);
  const roasVs = versus(roasNow, roasGoal);
  const neededVs = versus(s.roasNeeded, s.roasTarget, "down");
  const tiles: { label: string; value: string; sub: string; tone: Tone; hint: string }[] = [
    {
      label: "Target for the month",
      value: s.hasPlan ? f(s.targetMonth) : "No plan",
      sub: s.hasPlan ? `${f(s.targetToDate)} up to ${loaded && loaded.lastData < endOfMonth(`${month}-01`) ? loaded.lastData : "the end of the month"}` : "Targets need a plan for this month",
      tone: "neutral",
      hint: `The plan's daily spend for ${platform.label}, added up${loaded?.planName ? ` (plan: ${loaded.planName})` : ""}.`,
    },
    {
      label: "Spent so far",
      value: f(s.spentToDate),
      sub: s.targetToDate !== null ? `${spentVs.text} vs target so far`.trim() : `${s.daysElapsed} days`,
      tone: spentVs.tone,
      hint: "What the campaigns spent on the days of the month that have data.",
    },
    {
      label: "Heading to",
      value: f(s.projectedMonth),
      sub: s.hasPlan ? (s.pace !== null ? `${headingVs.text} vs plan, at ${f(s.pace, "percent1")} of target so far`.trim() : "No day of the month has data yet: the plan as it is") : "Days left at the average of the last 7 days",
      tone: headingVs.tone,
      hint: "Spent so far, plus each day left at its target times the pace so far (spent so far ÷ target so far).",
    },
    {
      label: `${word} so far`,
      value: f(roasNow, "ratio2"),
      sub: roasGoal !== null ? `${roasVs.text} vs target ${f(roasGoal, "ratio2")}`.trim() : "No ROAS target in the plan",
      tone: roasVs.tone,
      hint: incremental ? "Platform revenue x each channel's incrementality factor, over spend." : "Platform-reported revenue over spend (7-day click).",
    },
    {
      label: "ROAS needed on the days left",
      value: f(s.roasNeeded, "ratio2"),
      sub: s.roasNeeded !== null ? `${s.daysLeft} days left${s.roasTarget !== null ? `, target so far ${f(s.roasTarget, "ratio2")}` : ""}` : s.daysLeft === 0 ? "The month is over" : "Needs ROAS targets in the plan",
      tone: neededVs.tone,
      hint: "(Platform revenue the plan expects for the month − platform revenue so far) ÷ the planned spend of the days left.",
    },
  ];

  const hasRows = tracker.campaigns.length > 0;
  const projectedLine = tracker.days.map((d, i) => (!d.past || tracker.days[i + 1]?.past === false ? d.projected : null));
  const series = (
    [
      { id: "actual", label: "Actual", kind: "bar", color: theme.colors.chartPrimary, values: tracker.days.map((d) => d.actual) },
      { id: "projected", label: "Projected", kind: "line", color: theme.colors.chartCompare, values: projectedLine },
      { id: "target", label: "Target", kind: "line", color: theme.colors.chartTarget, values: tracker.days.map((d) => d.target), dashed: true },
    ] satisfies ChartSeries[]
  ).filter((x) => x.values.some((v) => v !== null));

  const dayTotals = tracker.days.reduce(
    (a, d) => ({ target: d.target === null ? a.target : (a.target ?? 0) + d.target, projected: d.projected === null ? a.projected : (a.projected ?? 0) + d.projected, actual: d.actual === null ? a.actual : (a.actual ?? 0) + d.actual, delta: d.delta === null ? a.delta : (a.delta ?? 0) + d.delta }),
    { target: null as number | null, projected: null as number | null, actual: null as number | null, delta: null as number | null },
  );
  const campaignGoal = (c: (typeof tracker.campaigns)[number]) => (c.roasTarget === null ? null : incremental ? c.roasTarget * factor(settings, c.channel) : c.roasTarget);

  return (
    <ReportFrame slug={slug} range={null} controls={controls}>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-[12px] border border-border bg-surface p-4" title={t.hint}>
            <div className="text-xs text-text-muted">{t.label}</div>
            <div className="mt-1 text-2xl font-semibold tabular">{t.value}</div>
            <div className={`mt-1 text-xs ${TONE[t.tone]}`}>{t.sub}</div>
          </div>
        ))}
      </div>

      {!hasRows && s.spentToDate === 0 && (
        <Empty>
          No {platform.label} campaign spent in {monthName(month)} or in the {shareDays} days before the last day with data. Pick another month, or connect {platform.label} in Store Settings.
        </Empty>
      )}

      {series.length > 0 && (
        <section className="rounded-2xl border border-border bg-surface p-5">
          <h3 className="mb-3 text-sm font-medium text-text-muted">
            {tracker.picked ? `${tracker.picked}: spend by day` : `${platform.label} spend by day`}
            {platform.id === "meta" && s.launches > 0 ? ` · ${s.launches} launch${s.launches === 1 ? "" : "es"} this month` : ""}
          </h3>
          <DailyChart dates={tracker.days.map((d) => d.date)} series={series} height={260} formatValue={(v) => f(v)} formatAxis={(v) => compactCurrency(v, cur)} />
        </section>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <section className="rounded-2xl border border-border bg-surface p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-medium uppercase tracking-wide text-text-muted">{tracker.picked ? `Days of ${tracker.picked}` : "Days"}</h3>
            <div className="flex items-center gap-2">
              {tracker.picked && (
                <button type="button" onClick={() => setCampaignId(null)} className="rounded-lg border border-accent px-2.5 py-1 text-xs text-text">
                  Show all campaigns
                </button>
              )}
              <button
                type="button"
                onClick={() =>
                  download(
                    `${slug}-${month}-days`,
                    ["Day", "Moments", "Target", "Projected", "Actual", "Delta"],
                    tracker.days.map((d) => [d.date, [...d.moments, ...(d.launches ? [`${d.launches} launch${d.launches === 1 ? "" : "es"}`] : [])].join("; "), d.target, d.projected, d.actual, d.delta]),
                  )
                }
                className="rounded-lg border border-border px-2.5 py-1 text-xs text-text-muted"
              >
                Download CSV
              </button>
            </div>
          </div>
          <div className="max-h-[640px] overflow-auto">
            <table className="w-full border-collapse text-xs">
              <thead className="sticky top-0 bg-surface">
                <tr className="text-text-faint">
                  <th className="px-2 py-1 text-left font-normal">Day</th>
                  <th className="px-2 py-1 text-left font-normal">Moments</th>
                  <th className="px-2 py-1 text-right font-normal">Target</th>
                  <th className="px-2 py-1 text-right font-normal">Projected</th>
                  <th className="px-2 py-1 text-right font-normal">Actual</th>
                  <th className="px-2 py-1 text-right font-normal">Delta</th>
                </tr>
              </thead>
              <tbody>
                {tracker.days.map((d) => {
                  const tone = d.delta === null || d.target === null ? "neutral" : compare(d.actual, d.target, "up").tone;
                  return (
                    <tr key={d.date} className={`border-t border-border/40 ${d.past ? "" : "text-text-muted"}`}>
                      <td className="whitespace-nowrap px-2 py-1">
                        {WEEKDAY[dayOfWeek(d.date)]} {Number(d.date.slice(8))}
                      </td>
                      <td className="px-2 py-1 text-text-muted">
                        {d.moments.join(", ")}
                        {d.launches > 0 && <span className="text-text-faint">{`${d.moments.length ? " · " : ""}${d.launches} launch${d.launches === 1 ? "" : "es"}`}</span>}
                      </td>
                      <td className="px-2 py-1 text-right tabular">{f(d.target)}</td>
                      <td className="px-2 py-1 text-right tabular">{f(d.projected)}</td>
                      <td className="px-2 py-1 text-right tabular">{f(d.actual)}</td>
                      <td className={`px-2 py-1 text-right tabular ${TONE[tone]}`}>{d.delta === null ? "–" : `${d.delta >= 0 ? "+" : "−"}${f(Math.abs(d.delta))}`}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-border font-medium">
                  <td className="px-2 py-1.5" colSpan={2}>
                    Month
                  </td>
                  <td className="px-2 py-1.5 text-right tabular">{f(dayTotals.target)}</td>
                  <td className="px-2 py-1.5 text-right tabular">{f(dayTotals.projected)}</td>
                  <td className="px-2 py-1.5 text-right tabular">{f(dayTotals.actual)}</td>
                  <td className="px-2 py-1.5 text-right tabular">{dayTotals.delta === null ? "–" : `${dayTotals.delta >= 0 ? "+" : "−"}${f(Math.abs(dayTotals.delta))}`}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>

        <section className="rounded-2xl border border-border bg-surface p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-medium uppercase tracking-wide text-text-muted">Campaigns</h3>
              <p className="mt-1 text-xs text-text-faint">
                {tracker.shareFrom && tracker.shareTo ? `Shares of spend from ${tracker.shareFrom} to ${tracker.shareTo}. ` : ""}
                Click a campaign to see its days.
              </p>
            </div>
            <button
              type="button"
              onClick={() =>
                download(
                  `${slug}-${month}-campaigns`,
                  ["Campaign", "Type", "Share", "Target", "Projected", "Actual", "Platform revenue", "ROAS", "iROAS", "ROAS target"],
                  tracker.campaigns.map((c) => [c.name, c.type, c.share, c.target, c.projected, c.actual, c.revenue, c.roas, c.iRoas, c.roasTarget]),
                )
              }
              className="rounded-lg border border-border px-2.5 py-1 text-xs text-text-muted"
            >
              Download CSV
            </button>
          </div>
          <div className="max-h-[640px] overflow-auto">
            <table className="w-full min-w-[640px] border-collapse text-xs">
              <thead className="sticky top-0 bg-surface">
                <tr className="text-text-faint">
                  <th className="px-2 py-1 text-left font-normal">Campaign</th>
                  <th className="px-2 py-1 text-left font-normal">Type</th>
                  <th className="px-2 py-1 text-right font-normal">Share</th>
                  <th className="px-2 py-1 text-right font-normal">Target</th>
                  <th className="px-2 py-1 text-right font-normal">Projected</th>
                  <th className="px-2 py-1 text-right font-normal">Actual</th>
                  <th className="px-2 py-1 text-right font-normal">{word}</th>
                  <th className="px-2 py-1 text-right font-normal">Target</th>
                </tr>
              </thead>
              <tbody>
                {tracker.campaigns.map((c) => {
                  const value = incremental ? c.iRoas : c.roas;
                  const goal = campaignGoal(c);
                  const on = c.id === campaignId;
                  return (
                    <tr key={c.id} onClick={() => setCampaignId(on ? null : c.id)} className={`cursor-pointer border-t border-border/40 hover:bg-surface-raised ${on ? "bg-surface-raised" : ""}`} aria-selected={on}>
                      <td className="max-w-[280px] truncate px-2 py-1.5" title={c.name}>
                        {c.name}
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-text-muted">{c.type}</td>
                      <td className="px-2 py-1.5 text-right tabular">{f(c.share, "percent1")}</td>
                      <td className="px-2 py-1.5 text-right tabular">{f(c.target)}</td>
                      <td className="px-2 py-1.5 text-right tabular">{f(c.projected)}</td>
                      <td className="px-2 py-1.5 text-right tabular">{f(c.actual)}</td>
                      <td className={`px-2 py-1.5 text-right tabular ${TONE[compare(value, goal, "up").tone]}`}>{f(value, "ratio2")}</td>
                      <td className="px-2 py-1.5 text-right tabular text-text-muted">{f(goal, "ratio2")}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </ReportFrame>
  );
}
