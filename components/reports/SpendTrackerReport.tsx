"use client";

import Link from "next/link";
import { Fragment, useEffect, useMemo, useState, type CSSProperties } from "react";
import { Empty, Loading, ReportFrame, selectClass } from "./ReportFrame";
import { useApp } from "@/lib/app-context";
import { addMonths, dayOfWeek, endOfMonth } from "@/lib/dates";
import { formatDiff, formatValue, type Format } from "@/lib/format";
import { compare, type Tone } from "@/lib/metrics";
import type { MarketingEvent } from "@/lib/planning/events";
import { planRoasTargets, roasOf, type MonthRoasTargets } from "@/lib/planning/roas";
import { pickPlan, readScenarioChoice } from "@/lib/planning/scenarios";
import { getReport } from "@/lib/reports/registry";
import { getRepository } from "@/lib/repository";
import { buildTracker, SHARE_WINDOWS, TRACKER_PLATFORMS, trackerLoadFrom, trackerOfSlug, type ShareWindow, type TrackerCell } from "@/lib/trackers/spend-tracker";
import type { CampaignDay, PlanTargetDay } from "@/lib/types";

const TONE: Record<Tone, string> = { good: "text-good", bad: "text-bad", neutral: "" };
const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const monthName = (m: string) => new Date(`${m.slice(0, 7)}-15T12:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

/** Column widths of the grid, in px. The day and the platform's total stay in place while the campaigns scroll sideways. */
const DAY_W = 148;
const COL_W = 84;
const TOTAL_COLS = 5;
const CAMPAIGN_COLS = 4;

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
 * The spend tracker of one ad platform, as one wide grid: the days of the month down the side, the platform's total first (target,
 * projected, actual), then every campaign as its own block of columns. On every day the campaigns add up to the total, so the grid
 * shows which campaign is carrying the plan and which is over or under on spend and on return. Numbers come from `buildTracker`.
 */
export function SpendTrackerReport({ slug }: { slug: string }) {
  const { client } = useApp();
  // A new store starts from a clean page: its own month and no carried-over choices.
  return <TrackerPage key={client?.id ?? "none"} slug={slug} />;
}

function TrackerPage({ slug }: { slug: string }) {
  const { client, settings } = useApp();
  const platform = trackerOfSlug(slug);
  const [lastData, setLastData] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [shareDays, setShareDays] = useState<ShareWindow>(28);
  const [incremental, setIncremental] = useState(false);
  const [excludeTests, setExcludeTests] = useState(false);
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  // The page opens on the month of the store's last day with data (the store's "now", whatever the viewer's time zone).
  const thisMonth = lastData ? lastData.slice(0, 7) : null;
  const month = picked ?? thisMonth;
  const months = useMemo(() => (thisMonth ? Array.from({ length: 15 }, (_, i) => addMonths(`${thisMonth}-01`, 2 - i).slice(0, 7)) : []), [thisMonth]);
  const key = client && platform && month ? `${client.id}|${platform.id}|${month}` : null;

  useEffect(() => {
    if (!client) return;
    let cancel = false;
    getRepository()
      .getLastDataDate(client.id)
      .then((d) => {
        if (!cancel) setLastData(d);
      })
      .catch((e: unknown) => {
        if (!cancel) setFailed(e instanceof Error ? e.message : "The store's data could not be read.");
      });
    return () => {
      cancel = true;
    };
  }, [client]);

  useEffect(() => {
    if (!client || !settings || !platform || !month || !key || !lastData) return;
    let cancel = false;
    (async () => {
      try {
        const repo = getRepository();
        const from = `${month}-01`;
        const to = endOfMonth(from);
        const plan = pickPlan(await repo.listPlans(client.id), Number(month.slice(0, 4)), readScenarioChoice(client.id));
        const [campaigns, planRows, targets, events, launches] = await Promise.all([
          repo.getCampaignDays(client.id, trackerLoadFrom(month, lastData, 28), to),
          plan ? repo.getPlanTargets(client.id, plan.id, from, to) : Promise.resolve([]),
          plan
            ? repo
                .getPlanMonths(plan.id)
                // Returning campaigns get a target too: the same bar through their own factor.
                .then((m) => planRoasTargets(m, settings, { returning: true }))
                .catch(() => null)
            : Promise.resolve(null),
          repo.listEvents(client.id).catch(() => []),
          platform.id === "meta" ? repo.getMetaLaunches(client.id, { from, to }).catch(() => undefined) : Promise.resolve(undefined),
        ]);
        if (!cancel) setLoaded({ key, lastData, campaigns, plan: planRows, planName: plan?.name ?? null, targets, events, launches: launches ?? [] });
      } catch (e) {
        if (!cancel) setFailed(e instanceof Error ? e.message : "The tracker's data could not be read.");
      }
    })();
    return () => {
      cancel = true;
    };
  }, [client, settings, platform, month, key, lastData]);

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
      // Tests are counted unless asked otherwise: the plan's target holds every campaign's budget, tests included.
      excludeTests,
    });
  }, [settings, platform, month, loaded, key, shareDays, excludeTests]);

  const cur = client?.currency ?? "USD";
  const f = (v: number | null, fmt: Format = "currency0") => formatValue(v, fmt, cur);

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
        <select aria-label="Month" className={selectClass} value={month ?? ""} onChange={(e) => setPicked(e.target.value)}>
          {months.map((m) => (
            <option key={m} value={m}>
              {monthName(m)}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-2 text-sm text-text-muted" title="A campaign's share is its part of the platform's spend over these last days with data. The platform's target and projection are shared out to the campaigns by it.">
        Split by the spend of the last
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
        <input type="checkbox" checked={excludeTests} onChange={(e) => setExcludeTests(e.target.checked)} />
        Leave out test campaigns
      </label>
    </>
  );

  if (!client || !settings || !tracker || !month) {
    return (
      <ReportFrame slug={slug} range={null} controls={controls}>
        {failed ? <Empty>The tracker could not be loaded: {failed}</Empty> : <Loading />}
      </ReportFrame>
    );
  }

  const s = tracker.summary;
  const word = incremental ? "iROAS" : "ROAS";
  const roasOfCell = (c: Pick<TrackerCell, "roas" | "iRoas">) => (incremental ? c.iRoas : c.roas);
  const goalOfCell = (c: Pick<TrackerCell, "roasTarget" | "iRoasTarget">) => (incremental ? c.iRoasTarget : c.roasTarget);
  const toneOf = (value: number | null, ref: number | null) => TONE[compare(value, ref, "up").tone];
  const signed = (v: number | null) => (v === null ? "–" : `${v >= 0 ? "+" : "−"}${f(Math.abs(v))}`);
  const pct = (a: number | null, b: number | null) => {
    const c = compare(a, b, "up");
    return c.diff === null ? "" : formatDiff(c.diff);
  };

  // One sentence instead of tiles: the grid is the page.
  const line: string[] = [];
  if (s.daysElapsed === 0) line.push("No day of this month has data yet.");
  else if (s.targetToDate !== null) line.push(`Spent ${f(s.spentToDate)} against a target of ${f(s.targetToDate)} so far (${pct(s.spentToDate, s.targetToDate)}).`);
  else line.push(`Spent ${f(s.spentToDate)} so far. No plan holds ${platform.label} spend for this month, so there is no target.`);
  if (s.projectedMonth !== null && s.daysLeft > 0) {
    line.push(s.hasPlan ? `Heading to ${f(s.projectedMonth)} against a plan of ${f(s.targetMonth)} (${pct(s.projectedMonth, s.targetMonth)}), if the days left keep this pace.` : `Heading to ${f(s.projectedMonth)} if the days left run at the average of the last 7 days.`);
  }
  if (s.roasTarget !== null) {
    const partial = s.targetedShare !== null && s.targetedShare < 0.999;
    line.push(`${word} so far ${f(roasOfCell(s), "ratio2")} against a target of ${f(goalOfCell(s), "ratio2")}${partial ? `, read on the spend that has a target (everything: ${f(incremental ? s.iRoasAll : s.roasAll, "ratio2")})` : ""}.`);
  }
  if (s.planMet) line.push("The platform revenue so far already covers the month's plan.");
  else if (s.roasNeeded !== null) line.push(`The days left need a ROAS of ${f(s.roasNeeded, "ratio2")}${s.roasPlanLeft !== null ? ` (the plan expects ${f(s.roasPlanLeft, "ratio2")})` : ""}.`);
  const notes = [
    loaded && tracker.through < loaded.lastData ? `${platform.label}'s data runs through ${tracker.through}; the store's through ${loaded.lastData}. The days after it are read as still to come.` : null,
    s.testsLeftOut > 0 ? `Test campaigns are left out of what was spent (${f(s.testsLeftOut)} this month). The plan's target still holds their budget, so spend and pace read low by that much.` : null,
    s.hasPlan && loaded?.planName ? `Targets come from the plan "${loaded.planName}".` : null,
  ].filter((x): x is string => x !== null);

  const stick = (left: number, width: number): CSSProperties => ({ left, width, minWidth: width, maxWidth: width });
  const totalLeft = (i: number) => DAY_W + i * COL_W;
  const col: CSSProperties = { width: COL_W, minWidth: COL_W };
  const pin = "xl:sticky z-10 bg-surface";
  const cell = "px-2 py-1 text-right tabular whitespace-nowrap";
  const head = "px-2 py-1 text-right font-normal whitespace-nowrap";

  // After the total: the platform's types (when it has more than one), then the campaigns. Every block has the same four columns.
  const typeBlocks = tracker.channels.length > 1 ? tracker.channels : [];
  const blocks = [
    ...typeBlocks.map((c) => ({ id: `type:${c.key}`, name: c.label, sub: `All ${c.label.toLowerCase()} campaigns${c.pace !== null ? ` · ${f(c.pace, "percent1")} of target so far` : ""}`, kind: "type" as const, target: c.target, projected: c.projected, actual: c.actual, cells: c.days, ret: c })),
    ...tracker.campaigns.map((c) => ({
      id: c.id,
      name: c.name,
      sub: c.placeholder ? "Planned spend no campaign is carrying" : `${c.type}${c.share !== null ? ` · ${f(c.share, "percent1")} of spend` : ""}`,
      kind: c.placeholder ? ("none" as const) : ("campaign" as const),
      target: c.target,
      projected: c.projected,
      actual: c.actual,
      cells: c.days,
      ret: c,
    })),
  ];
  const blockTone = (kind: "type" | "campaign" | "none") => (kind === "type" ? "bg-surface-raised/60" : kind === "none" ? "text-text-faint" : "");

  const csv = () => {
    const headRow = ["Day", "Moments", "Total target", "Total projected", "Total actual", "Total delta", `Total ${word}`, ...blocks.flatMap((b) => [`${b.name} target`, `${b.name} projected`, `${b.name} actual`, `${b.name} ${word}`])];
    const rows = tracker.days.map((d, i) => [
      d.date,
      [...d.moments, ...(d.launches ? [`${d.launches} launch${d.launches === 1 ? "" : "es"}`] : [])].join("; "),
      d.target,
      d.projected,
      d.actual,
      d.delta,
      roasOfCell(d),
      ...blocks.flatMap((b) => [b.cells[i].target, b.cells[i].projected, b.cells[i].actual, roasOfCell(b.cells[i])]),
    ]);
    download(`${slug}-${month}`, headRow, rows);
  };

  return (
    <ReportFrame slug={slug} range={null} controls={controls}>
      <p className="text-sm text-text-muted">{line.join(" ")}</p>
      {notes.map((n) => (
        <p key={n} className="text-xs text-text-faint">
          {n}
        </p>
      ))}

      {tracker.campaigns.length === 0 && s.spentToDate === 0 && !s.hasPlan ? (
        <Empty>
          No {platform.label} campaign spent in {monthName(month)} or in the {shareDays} days before the last day with data. Pick another month, or connect {platform.label} in Store Settings.
        </Empty>
      ) : (
        <section className="rounded-2xl border border-border bg-surface p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-text-faint">
              The plan&apos;s spend is split by type first (each type has its own target and ROAS target), then to that type&apos;s campaigns by their share of its spend
              {tracker.shareFrom && tracker.shareTo ? ` from ${tracker.shareFrom} to ${tracker.shareTo}` : ""}. The campaigns add up to the total. Green and red compare actual with target, beyond 10% either way. Days to come are dimmed.
            </p>
            <button type="button" onClick={csv} className="rounded-lg border border-border px-2.5 py-1 text-xs text-text-muted">
              Download CSV
            </button>
          </div>
          <div className="max-h-[72vh] overflow-auto">
            <table className="border-separate border-spacing-0 text-xs">
              <thead className="sticky top-0 z-20 bg-surface">
                <tr>
                  <th rowSpan={2} className="sticky left-0 z-30 border-b border-border bg-surface px-2 py-1 text-left align-bottom font-normal text-text-faint" style={stick(0, DAY_W)}>
                    Day
                  </th>
                  <th colSpan={TOTAL_COLS} className={`${pin} border-b border-l border-border px-2 py-1 text-left font-medium`} style={{ left: totalLeft(0) }}>
                    {platform.label} total
                  </th>
                  {blocks.map((b) => (
                    <th key={b.id} colSpan={CAMPAIGN_COLS} className={`border-b border-l border-border px-2 py-1 text-left font-medium ${blockTone(b.kind)}`} style={{ maxWidth: COL_W * CAMPAIGN_COLS }}>
                      <div className="truncate" title={b.name}>
                        {b.name}
                      </div>
                      <div className="truncate font-normal text-text-faint" title={`${b.sub}${goalOfCell(b.ret) !== null ? ` · ${word} target ${f(goalOfCell(b.ret), "ratio2")}` : ""}`}>
                        {b.sub}
                        {goalOfCell(b.ret) !== null ? ` · ${word} target ${f(goalOfCell(b.ret), "ratio2")}` : ""}
                      </div>
                    </th>
                  ))}
                </tr>
                <tr className="text-text-faint">
                  {["Target", "Projected", "Actual", "Delta", word].map((h, i) => (
                    <th key={h} className={`${pin} ${head} border-b border-border ${i === 0 ? "border-l" : ""}`} style={stick(totalLeft(i), COL_W)}>
                      {h}
                    </th>
                  ))}
                  {blocks.map((b) => (
                    <Fragment key={b.id}>
                      {["Target", "Projected", "Actual", word].map((h, i) => (
                        <th key={h} className={`${head} border-b border-border ${i === 0 ? "border-l" : ""} ${blockTone(b.kind)}`} style={col}>
                          {h}
                        </th>
                      ))}
                    </Fragment>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr className="font-medium">
                  <td className="sticky left-0 z-10 border-b border-border bg-surface px-2 py-1.5" style={stick(0, DAY_W)}>
                    Month
                  </td>
                  <td className={`${pin} ${cell} border-b border-l border-border`} style={stick(totalLeft(0), COL_W)}>
                    {f(s.targetMonth)}
                  </td>
                  <td className={`${pin} ${cell} border-b border-border`} style={stick(totalLeft(1), COL_W)} title="Spent so far plus each day left at its target times the pace so far. A projection, not a commitment.">
                    {f(s.projectedMonth)}
                  </td>
                  <td className={`${pin} ${cell} border-b border-border ${toneOf(s.spentToDate, s.targetToDate)}`} style={stick(totalLeft(2), COL_W)} title={s.targetToDate !== null ? `Target so far ${f(s.targetToDate)}` : undefined}>
                    {f(s.spentToDate)}
                  </td>
                  <td className={`${pin} ${cell} border-b border-border`} style={stick(totalLeft(3), COL_W)} title="Spent so far minus the target so far">
                    {signed(s.targetToDate === null ? null : s.spentToDate - s.targetToDate)}
                  </td>
                  <td className={`${pin} ${cell} border-b border-border ${toneOf(roasOfCell(s), goalOfCell(s))}`} style={stick(totalLeft(4), COL_W)} title={goalOfCell(s) !== null ? `Target ${f(goalOfCell(s), "ratio2")}, read on the spend that has a ROAS target in the plan` : "No ROAS target in the plan"}>
                    {f(roasOfCell(s), "ratio2")}
                  </td>
                  {blocks.map((b) => (
                    <Fragment key={b.id}>
                      <td className={`${cell} border-b border-l border-border ${blockTone(b.kind)}`} title={b.kind === "campaign" ? "Its type's target for the month times the campaign's share of that type's spend. Not a budget set for the campaign." : "The plan's spend for the month"}>
                        {f(b.target)}
                      </td>
                      <td className={`${cell} border-b border-border ${blockTone(b.kind)}`} title="Spent so far plus the projection for the days left: each type's target times that type's pace so far.">
                        {f(b.projected)}
                      </td>
                      <td className={`${cell} border-b border-border ${blockTone(b.kind)}`}>{f(b.actual)}</td>
                      <td className={`${cell} border-b border-border ${blockTone(b.kind)} ${toneOf(roasOfCell(b.ret), goalOfCell(b.ret))}`} title={goalOfCell(b.ret) !== null ? `Target ${f(goalOfCell(b.ret), "ratio2")}` : "No ROAS target for this type in the plan"}>
                        {f(roasOfCell(b.ret), "ratio2")}
                      </td>
                    </Fragment>
                  ))}
                </tr>
                {tracker.days.map((d, i) => (
                  <tr key={d.date} className={d.past ? "" : "text-text-muted"}>
                    <td className="sticky left-0 z-10 border-b border-border/40 bg-surface px-2 py-1" style={stick(0, DAY_W)}>
                      <span className="whitespace-nowrap">
                        {WEEKDAY[dayOfWeek(d.date)]} {Number(d.date.slice(8))}
                      </span>
                      {(d.moments.length > 0 || d.launches > 0) && (
                        <div className="truncate text-[10px] text-text-faint" title={[...d.moments, ...(d.launches ? [`${d.launches} campaign${d.launches === 1 ? "" : "s"} got new ads`] : [])].join(", ")}>
                          {[...d.moments, ...(d.launches ? [`${d.launches} launch${d.launches === 1 ? "" : "es"}`] : [])].join(", ")}
                        </div>
                      )}
                    </td>
                    <td className={`${pin} ${cell} border-b border-l border-border/40`} style={stick(totalLeft(0), COL_W)}>
                      {f(d.target)}
                    </td>
                    <td className={`${pin} ${cell} border-b border-border/40`} style={stick(totalLeft(1), COL_W)}>
                      {f(d.projected)}
                    </td>
                    <td className={`${pin} ${cell} border-b border-border/40 ${toneOf(d.actual, d.target)}`} style={stick(totalLeft(2), COL_W)}>
                      {f(d.actual)}
                    </td>
                    <td className={`${pin} ${cell} border-b border-border/40`} style={stick(totalLeft(3), COL_W)}>
                      {signed(d.delta)}
                    </td>
                    <td className={`${pin} ${cell} border-b border-border/40 ${toneOf(roasOfCell(d), goalOfCell(d))}`} style={stick(totalLeft(4), COL_W)}>
                      {f(roasOfCell(d), "ratio2")}
                    </td>
                    {blocks.map((b) => {
                      const x = b.cells[i];
                      const bg = blockTone(b.kind);
                      return (
                        <Fragment key={b.id}>
                          <td className={`${cell} border-b border-l border-border/40 ${bg}`}>{f(x.target)}</td>
                          <td className={`${cell} border-b border-border/40 ${bg}`}>{f(x.projected)}</td>
                          <td className={`${cell} border-b border-border/40 ${bg} ${toneOf(x.actual, x.target)}`} title={x.launches ? "New ads went live in this campaign that day" : undefined}>
                            {x.launches > 0 && <span className="mr-1 text-text-faint">●</span>}
                            {f(x.actual)}
                          </td>
                          <td className={`${cell} border-b border-border/40 ${bg} ${toneOf(roasOfCell(x), goalOfCell(x))}`}>{f(roasOfCell(x), "ratio2")}</td>
                        </Fragment>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </ReportFrame>
  );
}
