"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { MONTHS, btn, btnPrimary, inputClass } from "@/components/planning/ui";
import { catalogShare, metaSpendOf, monthsWithData, SPEND_PER_AD_RANGE, spendPerNewAd } from "@/lib/creative/demand";
import { scoreMetrics } from "@/lib/creative/metrics";
import { computeCreativeMonth, creativeInsights, isStale, launchProgress, lockAll, regenerateCreative, type CreativeMonth, type CreativeOverrides } from "@/lib/creative/plan";
import { adPlanResults, readSavedBlocks } from "@/lib/creative/saved";
import { creativeScore } from "@/lib/creative/score";
import type { CreativeHistory } from "@/lib/creative/types";
import { addDays, startOfMonth, todayLocal } from "@/lib/dates";
import { formatValue } from "@/lib/format";
import { DEFAULT_CREATIVE, type CreativeSettings, type SavedModel } from "@/lib/planning/models";
import type { MarketingEvent } from "@/lib/planning/events";
import type { PlanMonth } from "@/lib/planning/types";
import { getRepository } from "@/lib/repository";
import type { Client, ClientSettings, DailyFact, PlanVersion } from "@/lib/types";
import { CreativeMonthView } from "./CreativeMonthView";
import { CreativeScoreCard } from "./CreativeScoreCard";

const round2 = (v: number) => Math.round(v * 100) / 100;

function Ring({ value, total }: { value: number; total: number }) {
  const r = 36;
  const c = 2 * Math.PI * r;
  const done = total > 0 ? Math.min(1, value / total) : 0;
  return (
    <svg viewBox="0 0 96 96" className="h-24 w-24 shrink-0" role="img" aria-label={`${total} new ads needed, ${value} launched`}>
      <circle cx={48} cy={48} r={r} fill="none" stroke="currentColor" opacity={0.15} strokeWidth={9} />
      <circle cx={48} cy={48} r={r} fill="none" stroke="var(--apex-accent)" strokeWidth={9} strokeLinecap="round" strokeDasharray={`${c * done} ${c}`} transform="rotate(-90 48 48)" />
      <text x={48} y={50} textAnchor="middle" fontSize={22} fontWeight={700} fill="currentColor">
        {total}
      </text>
      <text x={48} y={66} textAnchor="middle" fontSize={9} fill="currentColor" opacity={0.6}>
        new ads
      </text>
    </svg>
  );
}

function Bar({ label, done, need }: { label: string; done: number; need: number }) {
  const w = need > 0 ? Math.min(100, (done / need) * 100) : 0;
  return (
    <div className="text-xs">
      <div className="flex justify-between text-text-muted">
        <span>{label}</span>
        <span className="tabular">
          {done} / {need}
        </span>
      </div>
      <div className="mt-0.5 h-1.5 rounded-full bg-bg">
        <div className="h-full rounded-full bg-accent" style={{ width: `${w}%` }} />
      </div>
    </div>
  );
}

/** The four inputs behind a month's number, in the order the CTC Modeling page lists them, with the maths in one line. */
function RecommendationBreakdown({ c, monthName, year }: { c: NonNullable<CreativeMonth["basis"]["ctc"]>; monthName: string; year: number }) {
  const pct = (v: number) => `${v >= 1 ? "+" : "−"}${Math.abs(Math.round((v - 1) * 100))}%`;
  const rows: { label: string; value: string; note: string }[] = [
    { label: `Ads launched in ${monthName} ${year - 1}`, value: String(c.lastYearAds), note: "the starting point" },
    { label: "Planned Meta spend vs last year", value: pct(c.spendRatio), note: `against ${monthName} ${year - 1}` },
    { label: "Creative Score multiplier", value: `× ${c.health.toFixed(2)}`, note: c.health > 1 ? "unhealthy ads: more new ads" : c.health < 1 ? "healthy ads: fewer new ads" : "neutral" },
    { label: "Evergreen carry-forward", value: `× ${c.carryForward.toFixed(2)}`, note: c.evergreenShare === null ? "no evergreen data" : `${Math.round(c.evergreenShare * 100)}% of ads are evergreen` },
  ];
  return (
    <div className="space-y-1.5 text-xs">
      <ul className="divide-y divide-border/50 rounded-lg border border-border/60">
        {rows.map((r) => (
          <li key={r.label} className="flex items-baseline justify-between gap-3 px-3 py-1.5">
            <span className="text-text-muted">{r.label}</span>
            <span className="tabular">
              <span className="font-medium text-text">{r.value}</span> <span className="text-text-faint">· {r.note}</span>
            </span>
          </li>
        ))}
      </ul>
      {c.raisedBySanity && <p className="text-text-muted">Raised from {c.fromInputs} to {c.ads}: last year&apos;s volume was too low for this spend, so the number follows what the spend needs instead.</p>}
    </div>
  );
}

/** A typed override: empty means "let the model decide" (shown as the placeholder). */
function OverrideField({ label, value, auto, suffix, disabled, onChange }: { label: string; value: number | undefined; auto: string; suffix?: string; disabled?: boolean; onChange: (v: number | undefined) => void }) {
  return (
    <label className="block text-xs text-text-muted">
      {label}
      <span className="mt-0.5 flex items-center gap-1">
        <input
          key={String(value)}
          className={`${inputClass} w-24 text-right tabular ${value !== undefined ? "border-accent!" : ""}`}
          defaultValue={value === undefined ? "" : String(value)}
          placeholder={auto}
          disabled={disabled}
          inputMode="decimal"
          onBlur={(e) => {
            const t = e.currentTarget.value.trim();
            if (t === "") return value === undefined ? undefined : onChange(undefined);
            const v = Number(t.replace(/[, £$€%]/g, ""));
            if (Number.isFinite(v) && v >= 0 && v !== value) onChange(v);
            else e.currentTarget.value = value === undefined ? "" : String(value);
          }}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        />
        {suffix && <span className="text-text-faint">{suffix}</span>}
      </span>
    </label>
  );
}

/**
 * The Ad plan for one plan: the account's Creative Score and, for each month, how many new Meta ads it needs. Its numbers are saved in the plan's
 * `creative` model record, apart from the plan's own targets, so creative strategists never have to open the plan editor. Keyed by plan, so
 * switching client or year starts it fresh.
 */
export function AdPlanBoard({ client, settings, plan, months, events, facts, lastData, savedModel }: { client: Client; settings: ClientSettings; plan: PlanVersion; months: PlanMonth[]; events: MarketingEvent[]; facts: DailyFact[]; lastData: string; savedModel: SavedModel<unknown, unknown> | null }) {
  const asOf = lastData || todayLocal();
  const now = `${asOf}T00:00:00.000Z`;
  const money = (v: number | null) => formatValue(v, "currency0", client.currency);

  const [history, setHistory] = useState<CreativeHistory | null | "loading">("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [modelSettings] = useState<CreativeSettings>(() => ({ ...DEFAULT_CREATIVE, ...((savedModel?.settings as Partial<CreativeSettings> | undefined) ?? {}) }));
  const [blocks, setBlocks] = useState<Record<string, CreativeMonth>>(() => readSavedBlocks(savedModel?.results));
  const [dirty, setDirty] = useState(false);
  const [draft, setDraft] = useState<Record<string, CreativeOverrides>>({});
  const [msg, setMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [sel, setSel] = useState(() => {
    const current = `${asOf.slice(0, 7)}-01`;
    return months.find((m) => m.month === current)?.month ?? months.find((m) => m.inputs)?.month ?? months[0].month;
  });

  useEffect(() => {
    let cancel = false;
    getRepository()
      .getCreativeHistory(client.id, asOf, `${plan.year - 1}-01-01`)
      .then(
        (h) => {
          if (cancel) return;
          setLoadError(null);
          setHistory(h);
        },
        (e) => {
          if (cancel) return;
          setLoadError(e instanceof Error && e.message ? e.message : "unknown error");
          setHistory(null);
        },
      );
    return () => {
      cancel = true;
    };
  }, [client.id, plan.year, asOf]);

  const data = history === "loading" ? null : history;
  const openMonth = startOfMonth(asOf);
  const metrics = useMemo(() => (data ? scoreMetrics(data) : null), [data]);
  const score = useMemo(() => (metrics ? creativeScore(metrics) : null), [metrics]);
  const planNonCatalog = useMemo(() => {
    const share = data ? catalogShare(data.months, openMonth) : 0;
    return Object.fromEntries(months.map((m) => [m.month, metaSpendOf(m.inputs) * (1 - share)]));
  }, [data, months, openMonth]);

  // Campaign-level Meta spend (the source of truth): stands in for current spend where the ad-level data has nothing.
  const metaFacts = useMemo(() => {
    const byMonth: Record<string, number> = {};
    let last30 = 0;
    const from = addDays(asOf, -29);
    for (const f of facts) {
      const v = (f.channels.meta_acquisition?.spend ?? 0) + (f.channels.meta_returning?.spend ?? 0);
      const k = `${f.date.slice(0, 7)}-01`;
      byMonth[k] = (byMonth[k] ?? 0) + v;
      if (f.date >= from && f.date <= asOf) last30 += v;
    }
    return { byMonth, last30 };
  }, [facts, asOf]);

  const computeFor = (m: PlanMonth, overrides: CreativeOverrides) => computeCreativeMonth({ month: m.month, inputs: m.inputs, history: data, events, planNonCatalog, metaFacts, overrides, score: score?.score ?? null, evergreenShare: metrics?.evergreenShare ?? null, now });

  const selMonth = months.find((m) => m.month === sel) ?? months[0];
  const saved = blocks[sel];
  const monthLocked = Boolean(saved?.locked);
  const overrides = draft[sel] ?? saved?.overrides ?? {};
  const block: CreativeMonth | null = !selMonth.inputs ? null : monthLocked ? saved : computeFor(selMonth, overrides);
  const stale = Boolean(saved && block && !monthLocked && isStale(saved, block.basis.metaSpend));
  const progress = data ? launchProgress(data.ads, events, sel, modelSettings.leadDays) : null;
  const perAd = data ? spendPerNewAd(data.ads, asOf, monthsWithData(data.months)) : null;
  const monthName = MONTHS[Number(sel.slice(5, 7)) - 1];

  const setOverride = (patch: Partial<Record<keyof CreativeOverrides, number | undefined>>) =>
    setDraft((d) => {
      const next: CreativeOverrides = { ...(d[sel] ?? saved?.overrides ?? {}) };
      for (const [k, v] of Object.entries(patch) as [keyof CreativeOverrides, number | undefined][]) {
        if (v === undefined) delete next[k];
        else next[k] = v;
      }
      return { ...d, [sel]: next };
    });

  /** What Save would write: every month recomputed with the typed overrides, months whose ad plan is locked as saved. */
  const recompute = () => regenerateCreative(months, blocks, (m, saved0) => computeFor(m, draft[m.month] ?? saved0));
  const preview = useMemo(
    () => regenerateCreative(months, blocks, (m, o) => computeCreativeMonth({ month: m.month, inputs: m.inputs, history: data, events, planNonCatalog, metaFacts, overrides: draft[m.month] ?? o, score: score?.score ?? null, evergreenShare: metrics?.evergreenShare ?? null, now })),
    [months, blocks, data, events, planNonCatalog, metaFacts, draft, score, metrics, now],
  );

  const regenerate = () => {
    const next = recompute();
    setBlocks(next);
    setDraft({});
    setDirty(true);
    const n = Object.values(next).filter((b) => !b.locked).length;
    setMsg({ tone: "ok", text: n ? `Recalculated ${n} month${n === 1 ? "" : "s"} (months with a locked ad plan left as they are). Press Save to keep it.` : "Nothing to recalculate: no month has a plan yet, or every ad plan is locked." });
  };

  const persist = async (next: Record<string, CreativeMonth>, note: string) => {
    setBusy(true);
    try {
      await getRepository().savePlanModel(plan, "creative", modelSettings, adPlanResults({ asOf, score, metrics, months: next }), note);
      setDirty(false);
      return null;
    } catch (e) {
      const text = e instanceof Error ? e.message : "Could not save the ad plan";
      return /plan_models|schema cache/i.test(text) ? "The ad plan could not be stored: the plan models table is missing (migration 0007)." : text;
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    const next = recompute();
    setBlocks(next);
    setDraft({});
    const err = await persist(next, "Saved the ad plan");
    const n = Object.keys(next).length;
    setMsg(err ? { tone: "bad", text: err } : { tone: "ok", text: `Saved the ad plan for ${plan.year} (${n} month${n === 1 ? "" : "s"}).` });
  };

  const hasBlocks = Object.keys(blocks).length > 0;
  const allLocked = hasBlocks && Object.values(blocks).every((b) => b.locked);
  const toggleLock = () => {
    setBlocks((cur) => lockAll(cur, !allLocked));
    setDirty(true);
    setMsg({ tone: "ok", text: `${allLocked ? "Unlocked" : "Locked"} the ad plan. Press Save to keep it.` });
  };

  const insights = score && metrics ? creativeInsights(score, metrics, block) : [];
  const gap = block ? Math.max(0, block.basis.targetSpend - block.basis.currentSpend * block.basis.carryRate) : 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-auto max-w-2xl text-xs text-text-muted">
          How many new Meta ads each month needs: last year&apos;s launches in that month, scaled by the change in planned Meta spend and by how healthy the account&apos;s creative is (the Creative Score). It follows the {plan.year} plan and the marketing calendar and never changes a plan target.
        </p>
        {dirty && <span className="rounded-full border border-accent/50 bg-accent/10 px-2 py-0.5 text-xs">Unsaved changes</span>}
        <button className={btnPrimary} onClick={save} disabled={busy || history === "loading"}>
          {busy ? "Saving…" : "Save"}
        </button>
        <button className={btn} onClick={regenerate} disabled={history === "loading"}>
          Regenerate Plan
        </button>
        <button className={btn} onClick={toggleLock} disabled={!hasBlocks}>
          {allLocked ? "Unlock Plan" : "Lock Plan"}
        </button>
      </div>
      {msg && <p className={`rounded-lg border p-3 text-sm ${msg.tone === "ok" ? "border-good/40 bg-good/10 text-good" : "border-bad/40 bg-bad/10 text-bad"}`}>{msg.text}</p>}

      <div className="flex flex-wrap gap-1" role="tablist" aria-label="Month">
        {months.map((m, i) => (
          <button key={m.month} role="tab" aria-selected={m.month === sel} onClick={() => setSel(m.month)} className={`flex items-center gap-1 rounded-lg border px-3 py-1.5 text-sm ${m.month === sel ? "border-accent bg-accent font-semibold text-black" : "border-border text-text-muted hover:text-text"}`}>
            {MONTHS[i]}
            {preview[m.month] && <span className={`tabular text-xs ${m.month === sel ? "text-black/70" : "text-text-faint"}`}>{preview[m.month].needed}</span>}
            {blocks[m.month] && <span className={`h-1.5 w-1.5 rounded-full ${m.month === sel ? "bg-black" : "bg-accent"}`} title="Saved" />}
          </button>
        ))}
      </div>

      {history === "loading" ? (
        <div className="h-64 animate-pulse rounded-xl bg-surface" />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
          <CreativeScoreCard history={data} score={score} metrics={metrics} currency={client.currency} loadError={loadError} />

          <div className="space-y-3 rounded-xl border border-border bg-surface p-4">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="mr-auto text-sm font-semibold">
                New ads needed in {monthName} {plan.year}
              </h3>
              {monthLocked && <span className="rounded-full border border-border px-2 py-0.5 text-xs text-text-muted">🔒 locked</span>}
              {stale && <span className="rounded-full border border-accent/50 bg-accent/10 px-2 py-0.5 text-xs">Spend changed, regenerate</span>}
              {saved && !stale && !monthLocked && <span className="rounded-full border border-border px-2 py-0.5 text-xs text-text-muted">saved</span>}
            </div>

            {!selMonth.inputs || !block ? (
              <p className="text-sm text-text-muted">
                This month has no plan yet. Start it in{" "}
                <Link href={`/planning/${plan.id}`} className="text-accent underline">
                  Planning
                </Link>
                , then come back.
              </p>
            ) : block.basis.reason === "no_meta_spend" ? (
              <p className="text-sm text-text-muted">No Meta spend planned for {monthName}: no new ads are needed. Give Facebook / Meta a share in the plan&apos;s Spend tab.</p>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-4">
                  <Ring value={progress ? progress.moments.video + progress.moments.image + progress.evergreen.video + progress.evergreen.image : 0} total={block.needed} />
                  <div className="min-w-48 flex-1 space-y-2">
                    <p className="text-xs font-medium text-text-muted">Moments · {block.moments}</p>
                    <Bar label="Videos" done={progress?.moments.video ?? 0} need={block.split.moments.video} />
                    <Bar label="Images" done={progress?.moments.image ?? 0} need={block.split.moments.image} />
                    <p className="pt-1 text-xs font-medium text-text-muted">Evergreen · {block.evergreen}</p>
                    <Bar label="Videos" done={progress?.evergreen.video ?? 0} need={block.split.evergreen.video} />
                    <Bar label="Images" done={progress?.evergreen.image ?? 0} need={block.split.evergreen.image} />
                  </div>
                </div>
                {overrides.needed !== undefined ? (
                  <p className="text-xs text-text-muted">You typed {block.needed} new ads for {monthName}; the model on its own gives {block.basis.modelNeeded}. Clear the field to go back to the model.</p>
                ) : block.basis.ctc ? (
                  <RecommendationBreakdown c={block.basis.ctc} monthName={monthName} year={plan.year} />
                ) : block.basis.reason === "covered" ? (
                  <p className="text-xs text-text-muted">No ads launched in {monthName} last year to build on, so the Canon&apos;s spend arithmetic is used. The Meta target ({money(block.basis.targetSpend)}) is already covered by the spend that carries over from last month ({money(block.basis.currentSpend)} × {block.basis.carryRate.toFixed(2)}).</p>
                ) : (
                  <p className="text-xs text-text-muted">
                    There is no Meta spend for {monthName} last year to build on, so the Canon&apos;s spend arithmetic is used: Meta target {money(block.basis.targetSpend)} (without catalog) − {money(block.basis.currentSpend)} still running × {block.basis.carryRate.toFixed(2)} = {money(gap)} to cover with new ads at {money(block.basis.spendPerAd)} each.{" "}
                    <span title="Carry rate and spend per ad come from this account's own history when it has three months of data; otherwise the Canon defaults (0.725 and 295, a US-dollar figure).">{block.basis.source === "account" ? "From this account." : "Canon defaults in use."}</span>
                    {perAd?.outsideRange && perAd.source === "account" && ` Spend per new ad is outside the Canon range (${SPEND_PER_AD_RANGE[0]} to ${SPEND_PER_AD_RANGE[1]}).`}
                  </p>
                )}
              </>
            )}

            {selMonth.inputs && block && (
              <div className="grid grid-cols-2 gap-3 border-t border-border pt-3 sm:grid-cols-4">
                <OverrideField label="Ads needed" value={overrides.needed} auto={String(block.needed)} disabled={monthLocked} onChange={(v) => setOverride({ needed: v })} />
                {block.basis.method !== "ctc" && <OverrideField label="Carry rate" value={overrides.carryRate} auto={block.basis.carryRate.toFixed(2)} disabled={monthLocked} onChange={(v) => setOverride({ carryRate: v })} />}
                {block.basis.method !== "ctc" && <OverrideField label="Spend per new ad" value={overrides.spendPerAd} auto={String(round2(block.basis.spendPerAd))} disabled={monthLocked} onChange={(v) => setOverride({ spendPerAd: v })} />}
                <OverrideField label="Moments share" suffix="%" value={overrides.momentsShare === undefined ? undefined : round2(overrides.momentsShare * 100)} auto={String(round2(block.basis.momentsShare * 100))} disabled={monthLocked} onChange={(v) => setOverride({ momentsShare: v === undefined ? undefined : v / 100 })} />
              </div>
            )}
          </div>
        </div>
      )}

      {history !== "loading" && <CreativeMonthView client={client} settings={settings} facts={facts} lastData={lastData} month={sel} history={data} block={block} asOf={asOf} />}

      {insights.length > 0 && (
        <ul className="space-y-1 rounded-xl border border-border bg-surface p-4 text-sm text-text-muted">
          {insights.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
