"use client";

import Link from "next/link";
import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Empty, Loading, ReportFrame, selectClass } from "./ReportFrame";
import { useApp } from "@/lib/app-context";
import { addMonths, dayOfWeek, endOfMonth } from "@/lib/dates";
import { formatDiff, formatValue } from "@/lib/format";
import { compare } from "@/lib/metrics";
import type { MarketingEvent } from "@/lib/planning/events";
import { planRoasTargets, roasOf, type MonthRoasTargets } from "@/lib/planning/roas";
import { pickPlan, readScenarioChoice } from "@/lib/planning/scenarios";
import { getReport } from "@/lib/reports/registry";
import { getRepository } from "@/lib/repository";
import { soFar, standing, type Standing } from "@/lib/trackers/grid";
import { buildTracker, SHARE_WINDOWS, TRACKER_PLATFORMS, trackerLoadFrom, trackerOfSlug, type ShareWindow, type TrackerCell } from "@/lib/trackers/spend-tracker";
import type { CampaignDay, PlanTargetDay } from "@/lib/types";

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const monthName = (m: string) => new Date(`${m.slice(0, 7)}-15T12:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

/** Colour carries one meaning on this page: actual against its reference, beyond 10% either way. */
const toneOf = (s: Standing) => (s === "above" ? "text-good" : s === "below" ? "text-bad" : "");
const barOf = (s: Standing) => (s === "above" ? "bg-good" : s === "below" ? "bg-bad" : "bg-text-muted");

/** Column widths of the grid, in px. The day and the platform's total stay in place while the campaigns scroll sideways. */
const DAY_W = 140;
const COL_W = 76;
type Col = "target" | "projected" | "actual" | "delta" | "roas";
type Columns = "all" | "short";
const TOTAL_COLS: Record<Columns, Col[]> = { all: ["target", "projected", "actual", "delta", "roas"], short: ["target", "actual", "roas"] };
const BLOCK_COLS: Record<Columns, Col[]> = { all: ["target", "projected", "actual", "roas"], short: ["actual", "roas"] };
const focusRing = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent";

type Return = Pick<TrackerCell, "roas" | "iRoas" | "roasTarget" | "iRoasTarget">;
/** One block of columns: the platform's total, a group's subtotal, a campaign, or planned spend no campaign carries. */
interface Block {
  id: string;
  kind: "total" | "subtotal" | "campaign" | "none";
  name: string;
  /** The campaign's part of the platform's recent spend. */
  share: number | null;
  target: number | null;
  projected: number | null;
  actual: number;
  ret: Return;
  cells: TrackerCell[];
}

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

/** Spend so far against the target so far, as a bar: the track runs to 150% of target and the tick marks 100%. */
function Pace({ pace, tone }: { pace: number | null; tone: Standing }) {
  if (pace === null) return <span className="text-text-faint">No target so far</span>;
  return (
    <span className="flex items-center gap-1.5" title="Spend so far as a share of the target so far. The tick marks 100%.">
      <span className="relative h-1 min-w-0 flex-1 rounded-full bg-border" aria-hidden>
        <span className={`absolute inset-y-0 left-0 rounded-full ${barOf(tone)}`} style={{ width: `${(Math.min(pace, 1.5) / 1.5) * 100}%` }} />
        <span className="absolute -top-0.5 h-2 w-px bg-text" style={{ left: `${100 / 1.5}%` }} />
      </span>
      <span className={`tabular ${toneOf(tone)}`}>{Math.round(pace * 100)}%</span>
    </span>
  );
}

/**
 * The spend tracker of one ad platform, as one wide grid: the days of the month down the side, the platform's total first, then its
 * types (new and returning customers, brand and non-brand) each followed by the campaigns that carry it. On every day the campaigns
 * add up to the total. The month row and each block's pace bar stay in view; the list above the grid jumps to a campaign.
 * Numbers come from `buildTracker`.
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
  const [columns, setColumns] = useState<Columns>("all");
  const [closed, setClosed] = useState<Set<string>>(() => new Set());
  const [lit, setLit] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

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
  const money = (v: number | null) => formatValue(v, "number", cur);
  const withSymbol = (v: number | null) => formatValue(v, "currency0", cur);
  const ratio = (v: number | null) => formatValue(v, "ratio2", cur);

  if (!platform) return <Empty>Unknown tracker.</Empty>;
  const controls = (
    <>
      <div className="flex items-center gap-1" role="tablist" aria-label="Ad platform">
        {TRACKER_PLATFORMS.filter((p) => getReport(p.slug)?.status === "ready").map((p) => (
          <Link key={p.id} href={`/reporting/${p.slug}`} role="tab" aria-selected={p.id === platform.id} className={`rounded-lg border px-3 py-1.5 text-sm ${focusRing} ${p.id === platform.id ? "border-accent text-text" : "border-border text-text-muted hover:text-text"}`}>
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
      <label className="flex items-center gap-2 text-sm text-text-muted" title="A type's target is shared out to its campaigns by their share of that type's spend over these last days with data.">
        Split by the spend of the last
        <select aria-label="Days the campaign shares are read over" className={selectClass} value={shareDays} onChange={(e) => setShareDays(Number(e.target.value) as ShareWindow)}>
          {SHARE_WINDOWS.map((d) => (
            <option key={d} value={d}>
              {d} days
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-2 text-sm text-text-muted" title="iROAS = platform ROAS x the type's incrementality factor (Store Settings).">
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
  const roasIn = (c: Return) => (incremental ? c.iRoas : c.roas);
  const goalIn = (c: Return) => (incremental ? c.iRoasTarget : c.roasTarget);
  const signed = (v: number | null) => (v === null ? "–" : `${v >= 0 ? "+" : "−"}${money(Math.abs(v))}`);
  const pct = (a: number | null, b: number | null) => {
    const c = compare(a, b, "up");
    return c.diff === null ? "" : formatDiff(c.diff);
  };

  // One sentence instead of tiles: the grid is the page.
  const line: string[] = [];
  if (s.daysElapsed === 0) line.push("No day of this month has data yet.");
  else if (s.targetToDate !== null) line.push(`Spent ${withSymbol(s.spentToDate)} against a target of ${withSymbol(s.targetToDate)} so far (${pct(s.spentToDate, s.targetToDate)}).`);
  else line.push(`Spent ${withSymbol(s.spentToDate)} so far. No plan holds ${platform.label} spend for this month, so there is no target.`);
  if (s.projectedMonth !== null && s.daysLeft > 0) {
    line.push(s.hasPlan ? `Heading to ${withSymbol(s.projectedMonth)} against a plan of ${withSymbol(s.targetMonth)} (${pct(s.projectedMonth, s.targetMonth)}), if the days left keep this pace.` : `Heading to ${withSymbol(s.projectedMonth)} if the days left run at the average of the last 7 days.`);
  }
  if (s.roasTarget !== null) {
    const partial = s.targetedShare !== null && s.targetedShare < 0.999;
    line.push(`${word} so far ${ratio(roasIn(s))} against a target of ${ratio(goalIn(s))}${partial ? `, read on the spend that has a target (everything: ${ratio(incremental ? s.iRoasAll : s.roasAll)})` : ""}.`);
  }
  if (s.planMet) line.push("The platform revenue so far already covers the month's plan.");
  else if (s.roasNeeded !== null) line.push(`The days left need a ROAS of ${ratio(s.roasNeeded)}${s.roasPlanLeft !== null ? ` (the plan expects ${ratio(s.roasPlanLeft)})` : ""}.`);
  // How each type of spend is doing, whatever campaign carried it.
  const byType =
    tracker.channels.length > 1
      ? tracker.channels
          .filter((c) => c.actual > 0 || (c.target ?? 0) > 0)
          .map((c) => `${c.label}: ${withSymbol(c.actual)}${c.target !== null ? ` of a ${withSymbol(soFar(c.days).target)} target so far` : " spent"}${roasIn(c) !== null ? `, ${word} ${ratio(roasIn(c))}${goalIn(c) !== null ? ` against ${ratio(goalIn(c))}` : ""}` : ""}.`)
      : [];
  const notes = [
    loaded && tracker.through < loaded.lastData ? `${platform.label}'s data runs through ${tracker.through}; the store's through ${loaded.lastData}. The days after it are read as still to come.` : null,
    s.testsLeftOut > 0 ? `Test campaigns are left out of what was spent (${withSymbol(s.testsLeftOut)} this month). The plan's target still holds their budget, so spend and pace read low by that much.` : null,
    s.hasPlan && loaded?.planName ? `Targets come from the plan "${loaded.planName}".` : null,
  ].filter((x): x is string => x !== null);

  // The blocks of the grid: the total, then each type with the campaigns that carry it.
  const total: Block = { id: "total", kind: "total", name: `${platform.label} total`, share: null, target: s.targetMonth, projected: s.projectedMonth, actual: s.spentToDate, ret: s, cells: tracker.days };
  const groups = tracker.groups.map((g) => {
    const subtotal: Block[] = g.subtotal ? [{ id: `sub:${g.key}`, kind: "subtotal", name: "Subtotal", share: null, target: g.subtotal.target, projected: g.subtotal.projected, actual: g.subtotal.actual, ret: g.subtotal, cells: g.subtotal.days }] : [];
    const blocks: Block[] = [...subtotal, ...g.campaigns.map((c): Block => ({ id: c.id, kind: c.placeholder ? "none" : "campaign", name: c.name, share: c.share, target: c.target, projected: c.projected, actual: c.actual, ret: c, cells: c.days }))];
    // A group can be folded down to its subtotal.
    const open = !(g.subtotal && closed.has(g.key));
    return { key: g.key as string, label: g.label, canFold: g.subtotal !== null, open, count: g.campaigns.filter((c) => !c.placeholder).length, blocks, shown: open ? blocks : subtotal };
  });
  // With one group only, its name would say nothing the page does not: the campaigns sit straight after the total.
  const hasBands = groups.length > 1;
  const totalCols = TOTAL_COLS[columns];
  const blockCols = BLOCK_COLS[columns];
  const leaves = totalCols.length + groups.reduce((a, g) => a + g.shown.length * blockCols.length, 0);
  const firstToCome = tracker.days.findIndex((d) => !d.past);

  const colName = (c: Col) => (c === "target" ? "Target" : c === "projected" ? "Projected" : c === "actual" ? "Actual" : c === "delta" ? "Delta" : word);
  /** A day's cell of a block. */
  const dayCell = (c: Col, x: TrackerCell, b: Block): { text: string; tone: string; title?: string; dot?: boolean } => {
    if (c === "target") return { text: money(x.target), tone: "" };
    if (c === "projected") return { text: money(x.projected), tone: "" };
    if (c === "delta") return { text: signed(x.delta), tone: "" };
    if (c === "actual") return { text: money(x.actual), tone: toneOf(standing(x.actual, x.target)), dot: b.kind === "campaign" && x.launches > 0, title: b.kind === "campaign" && x.launches > 0 ? "New ads went live in this campaign that day" : undefined };
    return { text: ratio(roasIn(x)), tone: toneOf(standing(roasIn(x), goalIn(x))), title: goalIn(x) !== null ? `Target ${ratio(goalIn(x))}` : undefined };
  };
  /** The month's cell of a block. */
  const monthCell = (c: Col, b: Block): { text: string; tone: string; title?: string } => {
    const sf = soFar(b.cells);
    if (c === "target") return { text: money(b.target), tone: "", title: b.kind === "campaign" ? "Its type's target for the month times the campaign's share of that type's recent spend. Not a budget set for the campaign." : "The plan's spend for the month" };
    if (c === "projected") return { text: money(b.projected), tone: "", title: "Spent so far plus the days left, each at its target times its type's pace so far. A projection, not a commitment." };
    if (c === "delta") return { text: signed(sf.target === null ? null : sf.actual - sf.target), tone: "", title: "Spent so far minus the target so far" };
    if (c === "actual") return { text: money(b.actual), tone: toneOf(standing(sf.actual, sf.target)), title: sf.target !== null ? `Target so far ${money(sf.target)}` : undefined };
    return { text: ratio(roasIn(b.ret)), tone: toneOf(standing(roasIn(b.ret), goalIn(b.ret))), title: goalIn(b.ret) !== null ? `Target ${ratio(goalIn(b.ret))}` : "No ROAS target for this type in the plan" };
  };

  const stick = (left: number): CSSProperties => ({ left });
  const totalLeft = (i: number) => DAY_W + i * COL_W;
  const pin = "xl:sticky xl:z-10";
  const num = "px-2 text-right tabular whitespace-nowrap";
  /** The left edge of a block: a heavier rule where a type begins. */
  const edge = (i: number, firstOfGroup: boolean, firstGroup = false) => (i > 0 || (firstOfGroup && firstGroup) ? "" : firstOfGroup ? "border-l-2 border-l-border" : "border-l border-l-border/60");
  /** The total's own edges: a rule on its left, and a heavier one on its right where the campaigns slide under it. */
  const rim = (i: number) => `${i === 0 ? "border-l-2 border-l-border" : ""} ${i === totalCols.length - 1 ? "border-r-2 border-r-border" : ""}`;
  const fill = (b: Block) => (b.kind === "subtotal" ? "bg-surface-raised" : "bg-surface");
  const ink = (b: Block) => (b.kind === "none" ? "text-text-faint" : "");

  const fold = (groupKey: string) =>
    setClosed((prev) => {
      const next = new Set(prev);
      if (next.has(groupKey)) next.delete(groupKey);
      else next.add(groupKey);
      return next;
    });
  /** Brings a block into view, just right of the columns that stay in place, and lights its header for a moment. */
  const jumpTo = (groupKey: string, id: string) => {
    setClosed((prev) => {
      if (!prev.has(groupKey)) return prev;
      const next = new Set(prev);
      next.delete(groupKey);
      return next;
    });
    setLit(id);
    requestAnimationFrame(() => {
      const box = scroller.current;
      const head = box ? [...box.querySelectorAll<HTMLElement>("[data-block]")].find((el) => el.dataset.block === id) : undefined;
      if (!box || !head) return;
      const pinned = DAY_W + (window.matchMedia("(min-width: 1280px)").matches ? totalCols.length * COL_W : 0);
      box.scrollTo({ left: Math.max(0, head.offsetLeft - pinned), behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    });
    window.setTimeout(() => setLit((now) => (now === id ? null : now)), 1800);
  };

  const csv = () => {
    const all = [total, ...groups.flatMap((g) => g.blocks)];
    const cols: Col[] = ["target", "projected", "actual", "delta", "roas"];
    const value = (c: Col, x: TrackerCell) => (c === "roas" ? roasIn(x) : x[c]);
    const headRow = ["Day", "Moments", ...all.flatMap((b) => cols.map((c) => `${b.name} ${colName(c).toLowerCase()}`))];
    const rows = tracker.days.map((d, i) => [d.date, [...d.moments, ...(d.launches ? [`${d.launches} launch${d.launches === 1 ? "" : "es"}`] : [])].join("; "), ...all.flatMap((b) => cols.map((c) => value(c, b.cells[i])))]);
    download(`${slug}-${month}`, headRow, rows);
  };

  /** The header of a block: its name, how much of its target it has spent so far, and its return against its target. */
  const blockHead = (b: Block) => {
    const sf = soFar(b.cells);
    const goal = goalIn(b.ret);
    return (
      <>
        <div className="flex items-baseline gap-2">
          <span className={`min-w-0 flex-1 truncate font-medium ${ink(b)}`} title={b.name}>
            {b.name}
          </span>
          {b.kind === "campaign" && b.share !== null && (
            <span className="shrink-0 font-normal text-text-faint" title={`Its part of ${platform.label}'s spend${tracker.shareFrom && tracker.shareTo ? ` from ${tracker.shareFrom} to ${tracker.shareTo}` : ""}`}>
              {formatValue(b.share, "percent1", cur)}
            </span>
          )}
        </div>
        <div className="mt-1 text-[11px] font-normal text-text-muted">{b.kind === "none" ? <span className="text-text-faint">Planned spend no campaign is carrying</span> : <Pace pace={sf.pace} tone={standing(sf.actual, sf.target)} />}</div>
        {goal !== null && (
          <div className="mt-0.5 truncate text-[11px] font-normal text-text-faint">
            {word} target {ratio(goal)}
          </div>
        )}
      </>
    );
  };

  const empty = tracker.campaigns.length === 0 && s.spentToDate === 0 && !s.hasPlan;
  return (
    <ReportFrame slug={slug} range={null} controls={controls}>
      <p className="max-w-[110ch] text-sm text-text-muted">{line.join(" ")}</p>
      {byType.length > 0 && <p className="max-w-[110ch] text-xs text-text-muted">By type of spend, whatever campaign carried it. {byType.join(" ")}</p>}
      {notes.map((n) => (
        <p key={n} className="text-xs text-text-faint">
          {n}
        </p>
      ))}

      {empty ? (
        <Empty>
          No {platform.label} campaign spent in {monthName(month)} or in the {shareDays} days before the last day with data. Pick another month, or connect {platform.label} in Store Settings.
        </Empty>
      ) : (
        <section className="rounded-2xl border border-border bg-surface p-4">
          <div className="mb-3 flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
            {groups.some((g) => g.blocks.length > 0) && (
              <nav aria-label="Campaigns in the grid" className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1.5 text-xs">
                <span className="text-text-faint">Jump to</span>
                {groups.map((g) => (
                  <Fragment key={g.key}>
                    {hasBands && g.blocks.length > 0 && (
                      <button type="button" onClick={() => jumpTo(g.key, g.blocks[0].id)} className={`rounded-md px-1.5 py-0.5 font-medium text-text hover:bg-surface-raised ${focusRing}`}>
                        {g.label}
                      </button>
                    )}
                    {g.blocks
                      .filter((b) => b.kind !== "subtotal")
                      .map((b) => {
                        const sf = soFar(b.cells);
                        const read = standing(roasIn(b.ret), goalIn(b.ret));
                        return (
                          <button
                            key={b.id}
                            type="button"
                            onClick={() => jumpTo(g.key, b.id)}
                            title={`${b.name}. ${sf.pace !== null ? `Spent ${Math.round(sf.pace * 100)}% of its target so far. ` : ""}${word} ${ratio(roasIn(b.ret))}${goalIn(b.ret) !== null ? `, target ${ratio(goalIn(b.ret))}` : ""}.`}
                            className={`max-w-[200px] truncate rounded-md border border-border px-2 py-0.5 hover:border-text-muted ${focusRing} ${b.kind === "none" ? "text-text-faint" : toneOf(read) || "text-text-muted"}`}
                          >
                            {b.name}
                          </button>
                        );
                      })}
                  </Fragment>
                ))}
              </nav>
            )}
            <div className="flex shrink-0 items-center gap-2 text-xs">
              <div className="flex overflow-hidden rounded-lg border border-border" role="group" aria-label="Columns shown for each campaign">
                {(
                  [
                    ["all", "All columns"],
                    ["short", `Actual and ${word}`],
                  ] as const
                ).map(([id, label]) => (
                  <button key={id} type="button" aria-pressed={columns === id} onClick={() => setColumns(id)} className={`px-2.5 py-1 ${focusRing} ${columns === id ? "bg-surface-raised text-text" : "text-text-muted hover:text-text"}`}>
                    {label}
                  </button>
                ))}
              </div>
              <button type="button" onClick={csv} className={`rounded-lg border border-border px-2.5 py-1 text-text-muted hover:text-text ${focusRing}`}>
                Download CSV
              </button>
            </div>
          </div>

          <div ref={scroller} className="max-h-[74vh] overflow-auto rounded-lg border border-border">
            <table className="table-fixed border-separate border-spacing-0 text-xs" style={{ width: DAY_W + leaves * COL_W }}>
              <colgroup>
                <col style={{ width: DAY_W }} />
                {Array.from({ length: leaves }, (_, i) => (
                  <col key={i} style={{ width: COL_W }} />
                ))}
              </colgroup>
              <thead className="sticky top-0 z-20">
                {hasBands && (
                  <tr>
                    <th rowSpan={3} className="sticky left-0 z-30 border-b border-b-border bg-surface px-2 pb-1 text-left align-bottom font-normal text-text-faint">
                      Day
                    </th>
                    <th rowSpan={2} colSpan={totalCols.length} data-block="total" className={`${pin} border-b border-b-border border-l-2 border-l-border border-r-2 border-r-border bg-surface px-2 py-1.5 text-left align-bottom`} style={stick(totalLeft(0))}>
                      {blockHead(total)}
                    </th>
                    {groups.map((g, gi) => (
                      <th key={g.key} colSpan={g.shown.length * blockCols.length} className={`border-b border-b-border bg-surface-raised px-0 py-0 text-left font-normal ${gi === 0 ? "" : "border-l-2 border-l-border"}`}>
                        <div className="sticky inline-flex max-w-full items-center gap-2 px-2 py-1" style={{ left: DAY_W + 8 }}>
                          {g.canFold ? (
                            <button type="button" aria-expanded={g.open} onClick={() => fold(g.key)} className={`flex items-center gap-1.5 rounded font-medium text-text hover:text-accent ${focusRing}`}>
                              <span aria-hidden className={`inline-block text-[9px] transition-transform ${g.open ? "rotate-90" : ""}`}>
                                ▶
                              </span>
                              {g.label}
                            </button>
                          ) : (
                            <span className="font-medium text-text">{g.label}</span>
                          )}
                          <span className="truncate text-text-faint">
                            {g.count === 1 ? "1 campaign" : `${g.count} campaigns`}
                            {g.open ? "" : ", folded"}
                          </span>
                        </div>
                      </th>
                    ))}
                  </tr>
                )}
                <tr>
                  {!hasBands && (
                    <>
                      <th rowSpan={2} className="sticky left-0 z-30 border-b border-b-border bg-surface px-2 pb-1 text-left align-bottom font-normal text-text-faint">
                        Day
                      </th>
                      <th colSpan={totalCols.length} data-block="total" className={`${pin} border-b border-b-border border-l-2 border-l-border border-r-2 border-r-border bg-surface px-2 py-1.5 text-left align-bottom`} style={stick(totalLeft(0))}>
                        {blockHead(total)}
                      </th>
                    </>
                  )}
                  {groups.map((g, gi) =>
                    g.shown.map((b, bi) => (
                      <th key={b.id} data-block={b.id} colSpan={blockCols.length} className={`border-b border-b-border px-2 py-1.5 text-left align-bottom ${edge(0, bi === 0, gi === 0)} ${fill(b)} ${lit === b.id ? "outline outline-1 -outline-offset-1 outline-accent" : ""}`}>
                        {blockHead(b)}
                      </th>
                    )),
                  )}
                </tr>
                <tr className="text-text-faint">
                  {totalCols.map((c, i) => (
                    <th key={c} className={`${pin} ${num} border-b border-b-border bg-surface py-1 font-normal ${rim(i)}`} style={stick(totalLeft(i))}>
                      {colName(c)}
                    </th>
                  ))}
                  {groups.map((g, gi) =>
                    g.shown.map((b, bi) => (
                      <Fragment key={b.id}>
                        {blockCols.map((c, i) => (
                          <th key={c} className={`${num} border-b border-b-border py-1 font-normal ${edge(i, bi === 0, gi === 0)} ${fill(b)}`}>
                            {colName(c)}
                          </th>
                        ))}
                      </Fragment>
                    )),
                  )}
                </tr>
                <tr className="text-[13px] font-semibold">
                  <th className="sticky left-0 z-30 border-b-2 border-b-border bg-surface-raised px-2 py-2 text-left font-semibold">{monthName(month).split(" ")[0]}</th>
                  {totalCols.map((c, i) => {
                    const x = monthCell(c, total);
                    return (
                      <td key={c} className={`${pin} ${num} border-b-2 border-b-border bg-surface-raised py-2 ${rim(i)} ${x.tone}`} style={stick(totalLeft(i))} title={x.title}>
                        {x.text}
                      </td>
                    );
                  })}
                  {groups.map((g, gi) =>
                    g.shown.map((b, bi) => (
                      <Fragment key={b.id}>
                        {blockCols.map((c, i) => {
                          const x = monthCell(c, b);
                          return (
                            <td key={c} className={`${num} border-b-2 border-b-border bg-surface-raised py-2 ${edge(i, bi === 0, gi === 0)} ${x.tone || ink(b)}`} title={x.title}>
                              {x.text}
                            </td>
                          );
                        })}
                      </Fragment>
                    )),
                  )}
                </tr>
              </thead>
              <tbody>
                {tracker.days.map((d, di) => {
                  // A heavier rule opens each week, so the eye can count in weeks.
                  const week = di > 0 && dayOfWeek(d.date) === 1 ? "border-t border-t-border" : "";
                  const rest = `border-b border-b-border/40 py-1 group-hover/day:bg-surface-raised ${week}`;
                  const tags = [...d.moments, ...(d.launches ? [`${d.launches} launch${d.launches === 1 ? "" : "es"}`] : [])];
                  return (
                    <Fragment key={d.date}>
                      {di === firstToCome && di > 0 && (
                        <tr>
                          <td className="sticky left-0 z-10 border-b border-b-border bg-surface px-2 py-1.5 font-medium text-text-muted">Days to come</td>
                          <td colSpan={leaves} className="border-b border-b-border bg-surface px-0 py-1.5 text-[11px] text-text-faint">
                            <span className="sticky inline-block px-2" style={{ left: DAY_W }}>
                              {s.hasPlan ? "Projected: each type's target at its pace so far" : "Projected at the average of the last 7 days"}
                            </span>
                          </td>
                        </tr>
                      )}
                      <tr className={`group/day ${d.past ? "" : "text-text-muted"}`}>
                        <td className={`sticky left-0 z-10 bg-surface px-2 ${rest}`}>
                          <div className="flex items-baseline gap-1.5">
                            <span className="shrink-0 whitespace-nowrap">
                              <span className="inline-block w-7 text-text-faint">{WEEKDAY[dayOfWeek(d.date)]}</span>
                              <span className="inline-block w-4 text-right">{Number(d.date.slice(8))}</span>
                            </span>
                            {tags.length > 0 && (
                              <span className="min-w-0 flex-1 truncate text-[10px] text-text-muted" title={tags.join(", ")}>
                                {tags.join(", ")}
                              </span>
                            )}
                          </div>
                        </td>
                        {totalCols.map((c, i) => {
                          const x = dayCell(c, d, total);
                          return (
                            <td key={c} className={`${pin} ${num} bg-surface ${rest} ${rim(i)} ${x.tone}`} style={stick(totalLeft(i))} title={x.title}>
                              {x.text}
                            </td>
                          );
                        })}
                        {groups.map((g, gi) =>
                          g.shown.map((b, bi) => (
                            <Fragment key={b.id}>
                              {blockCols.map((c, i) => {
                                const x = dayCell(c, b.cells[di], b);
                                return (
                                  <td key={c} className={`${num} ${rest} ${edge(i, bi === 0, gi === 0)} ${b.kind === "subtotal" ? "bg-surface-raised/60" : ""} ${x.tone || ink(b)}`} title={x.title}>
                                    {x.dot && <span className="mr-1 text-[8px] text-text-muted">●</span>}
                                    {x.text}
                                  </td>
                                );
                              })}
                            </Fragment>
                          )),
                        )}
                      </tr>
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-3 max-w-[110ch] text-xs text-text-faint">
            Amounts in {cur}. The plan&apos;s spend is split by type, then to each type&apos;s campaigns by their share of its spend
            {tracker.shareFrom && tracker.shareTo ? ` from ${tracker.shareFrom} to ${tracker.shareTo}` : ""}, so the campaigns add up to the total. Green and red mark actual against target beyond 10% either way, on spend and on {word}; in the list above
            they mark a campaign&apos;s {word}. A dot marks a day a campaign got new ads.
          </p>
        </section>
      )}
    </ReportFrame>
  );
}
