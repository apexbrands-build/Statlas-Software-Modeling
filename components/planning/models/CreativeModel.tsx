"use client";

import { useEffect, useMemo, useState } from "react";
import { catalogShare, metaSpendOf, monthsWithData, SPEND_PER_AD_RANGE, spendPerNewAd } from "@/lib/creative/demand";
import { scoreMetrics } from "@/lib/creative/metrics";
import { computeCreativeMonth, creativeInsights, isStale, launchProgress, lockAll, regenerateCreative, yearTable, type CreativeMonth, type CreativeOverrides } from "@/lib/creative/plan";
import { creativeScore } from "@/lib/creative/score";
import type { CreativeHistory } from "@/lib/creative/types";
import { startOfMonth, todayLocal } from "@/lib/dates";
import { formatValue } from "@/lib/format";
import { DEFAULT_CREATIVE, type CreativeSettings } from "@/lib/planning/models";
import type { PlanMonth } from "@/lib/planning/types";
import { getRepository } from "@/lib/repository";
import { btn, btnPrimary, inputClass, MONTHS } from "../ui";
import { CreativeMonthView } from "./CreativeMonthView";
import { CreativeScoreCard } from "./CreativeScoreCard";
import { CreativeYearTable } from "./CreativeYearTable";
import type { ModelCtx } from "./ModelsStep";

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

/** The fourth model: how many new Meta ads each month needs, and the Creative Score of the account. */
export function CreativeModel({ mc }: { mc: ModelCtx }) {
  const { ctx, saveModel } = mc;
  const { plan, client, months, events, editInputs, history: planHistory } = ctx;
  const asOf = planHistory.lastData || todayLocal();
  const now = `${asOf}T00:00:00.000Z`;
  const money = (v: number | null) => formatValue(v, "currency0", client.currency);

  const [history, setHistory] = useState<CreativeHistory | null | "loading">("loading");
  const [settings, setSettings] = useState<CreativeSettings>(DEFAULT_CREATIVE);
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
        (h) => !cancel && setHistory(h),
        () => !cancel && setHistory(null),
      );
    return () => {
      cancel = true;
    };
  }, [client.id, plan.year, asOf]);

  useEffect(() => {
    let cancel = false;
    getRepository()
      .getPlanModel(plan.id, "creative")
      .then(
        (m) => !cancel && m && setSettings({ ...DEFAULT_CREATIVE, ...(m.settings as Partial<CreativeSettings>) }),
        () => undefined,
      );
    return () => {
      cancel = true;
    };
  }, [plan.id]);

  const data = history === "loading" ? null : history;
  const openMonth = startOfMonth(asOf);
  const metrics = useMemo(() => (data ? scoreMetrics(data) : null), [data]);
  const score = useMemo(() => (metrics ? creativeScore(metrics) : null), [metrics]);
  const planNonCatalog = useMemo(() => {
    const share = data ? catalogShare(data.months, openMonth) : 0;
    return Object.fromEntries(months.map((m) => [m.month, metaSpendOf(m.inputs) * (1 - share)]));
  }, [data, months, openMonth]);

  const computeFor = (m: PlanMonth, overrides: CreativeOverrides) => computeCreativeMonth({ month: m.month, inputs: m.inputs, history: data, events, planNonCatalog, overrides, now });

  const selMonth = months.find((m) => m.month === sel) ?? months[0];
  const saved = selMonth.inputs?.creative;
  const monthLocked = selMonth.locked || Boolean(saved?.locked);
  const overrides = draft[sel] ?? saved?.overrides ?? {};
  const block: CreativeMonth | null = !selMonth.inputs ? null : monthLocked && saved ? saved : computeFor(selMonth, overrides);
  const stale = Boolean(saved && block && !monthLocked && isStale(saved, block.basis.targetSpend));
  const progress = data ? launchProgress(data.ads, events, sel, settings.leadDays) : null;
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

  const applyBlocks = (blocks: Record<string, CreativeMonth>) => {
    let n = 0;
    for (const m of months) {
      const b = blocks[m.month];
      if (!b || b === m.inputs?.creative) continue;
      editInputs(m.month, (i) => ({ ...i, creative: b }));
      n += 1;
    }
    return n;
  };
  const recompute = () => regenerateCreative(months, (m, savedOverrides) => computeFor(m, draft[m.month] ?? savedOverrides));

  const regenerate = () => {
    const n = applyBlocks(recompute());
    setDraft({});
    setMsg({ tone: "ok", text: n ? `Recalculated ${n} month${n === 1 ? "" : "s"} (locked months left as they are). Press Save plan to keep it.` : "Nothing to recalculate: every planned month is locked or has no inputs." });
  };

  const save = async () => {
    setBusy(true);
    const n = applyBlocks(recompute());
    setDraft({});
    const err = await saveModel("creative", settings, { asOf, score: score?.score ?? null, parts: score?.parts ?? null, metrics, mode: score?.mode ?? null }, "Saved the creative demand model");
    setBusy(false);
    setMsg(err ? { tone: "bad", text: err } : { tone: "ok", text: `Saved. ${n} month${n === 1 ? "" : "s"} updated. Press Save plan to keep the numbers in the plan.` });
  };

  const withBlock = months.filter((m) => m.inputs?.creative);
  const allLocked = withBlock.length > 0 && withBlock.every((m) => m.locked || m.inputs!.creative!.locked);
  const toggleLock = () => {
    const n = applyBlocks(lockAll(months, !allLocked));
    setMsg({ tone: "ok", text: `${allLocked ? "Unlocked" : "Locked"} ${n} month${n === 1 ? "" : "s"}. Press Save plan to keep it.` });
  };

  const insights = score && metrics ? creativeInsights(score, metrics, block) : [];
  // The year table shows what Save would write (locked months as saved), so it is useful before the first Save.
  const previewMonths = useMemo(() => {
    const blocks = regenerateCreative(months, (m, o) => computeCreativeMonth({ month: m.month, inputs: m.inputs, history: data, events, planNonCatalog, overrides: draft[m.month] ?? o, now }));
    return months.map((m) => (m.inputs && blocks[m.month] ? { ...m, inputs: { ...m.inputs, creative: blocks[m.month] } } : m));
  }, [months, data, events, planNonCatalog, draft, now]);
  const year = useMemo(() => yearTable({ year: plan.year, months: previewMonths, history: data, facts: planHistory.facts, settings: ctx.settings, lastData: planHistory.lastData }), [plan.year, previewMonths, data, planHistory.facts, planHistory.lastData, ctx.settings]);
  const gap = block ? Math.max(0, block.basis.targetSpend - block.basis.currentSpend * block.basis.carryRate) : 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="mr-auto">
          <h2 className="text-lg font-semibold" style={{ fontFamily: "var(--apex-font-heading)" }}>
            Creative Demand Model
          </h2>
          <p className="text-xs text-text-muted">How many new Meta ads each month needs to carry the plan&apos;s Meta spend, and how healthy the account&apos;s creative is. It does not change any target.</p>
        </div>
        <button className={btnPrimary} onClick={save} disabled={busy || history === "loading"}>
          {busy ? "Saving…" : "Save"}
        </button>
        <button className={btn} onClick={regenerate} disabled={history === "loading"}>
          Regenerate Plan
        </button>
        <button className={btn} onClick={toggleLock} disabled={withBlock.length === 0}>
          {allLocked ? "Unlock Plan" : "Lock Plan"}
        </button>
      </div>
      {msg && <p className={`rounded-lg border p-3 text-sm ${msg.tone === "ok" ? "border-good/40 bg-good/10 text-good" : "border-bad/40 bg-bad/10 text-bad"}`}>{msg.text}</p>}

      <div className="flex flex-wrap gap-1" role="tablist" aria-label="Month">
        {months.map((m, i) => (
          <button key={m.month} role="tab" aria-selected={m.month === sel} onClick={() => setSel(m.month)} className={`flex items-center gap-1 rounded-lg border px-3 py-1.5 text-sm ${m.month === sel ? "border-accent bg-accent font-semibold text-black" : "border-border text-text-muted hover:text-text"}`}>
            {MONTHS[i]}
            {m.inputs?.creative && <span className={`h-1.5 w-1.5 rounded-full ${m.month === sel ? "bg-black" : "bg-accent"}`} title="Saved in the plan" />}
          </button>
        ))}
      </div>

      {history === "loading" ? (
        <div className="h-64 animate-pulse rounded-xl bg-surface" />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
          <CreativeScoreCard history={data} score={score} metrics={metrics} currency={client.currency} />

          <div className="space-y-3 rounded-xl border border-border bg-surface p-4">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="mr-auto text-sm font-semibold">
                New ads needed in {monthName} {plan.year}
              </h3>
              {monthLocked && <span className="rounded-full border border-border px-2 py-0.5 text-xs text-text-muted">🔒 locked</span>}
              {stale && <span className="rounded-full border border-accent/50 bg-accent/10 px-2 py-0.5 text-xs">Spend changed, regenerate</span>}
              {saved && !stale && !monthLocked && <span className="rounded-full border border-border px-2 py-0.5 text-xs text-text-muted">saved in the plan</span>}
            </div>

            {!selMonth.inputs || !block ? (
              <p className="text-sm text-text-muted">Plan this month first: start it in the Overview tab, then come back.</p>
            ) : block.basis.reason === "no_meta_spend" ? (
              <p className="text-sm text-text-muted">No Meta spend planned for {monthName}: no new ads are needed. Give Facebook / Meta a share in the Spend tab.</p>
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
                {block.basis.reason === "covered" ? (
                  <p className="text-xs text-text-muted">The Meta target ({money(block.basis.targetSpend)}) is already covered by the spend that carries over from last month ({money(block.basis.currentSpend)} × {block.basis.carryRate.toFixed(2)}).</p>
                ) : (
                  <p className="text-xs text-text-muted">
                    Meta target {money(block.basis.targetSpend)} (without catalog) − {money(block.basis.currentSpend)} still running × {block.basis.carryRate.toFixed(2)} = {money(gap)} to cover with new ads at {money(block.basis.spendPerAd)} each.{" "}
                    <span title="Carry rate and spend per ad come from this account's own history when it has three months of data; otherwise the Canon defaults (0.725 and $295).">{block.basis.source === "account" ? "From this account." : "Canon defaults in use."}</span>
                    {perAd?.outsideRange && perAd.source === "account" && ` Spend per new ad is outside the Canon range (${SPEND_PER_AD_RANGE[0]} to ${SPEND_PER_AD_RANGE[1]}).`}
                  </p>
                )}
              </>
            )}

            {selMonth.inputs && block && (
              <div className="grid grid-cols-2 gap-3 border-t border-border pt-3 sm:grid-cols-4">
                <OverrideField label="Ads needed" value={overrides.needed} auto={String(block.needed)} disabled={monthLocked} onChange={(v) => setOverride({ needed: v })} />
                <OverrideField label="Carry rate" value={overrides.carryRate} auto={block.basis.carryRate.toFixed(2)} disabled={monthLocked} onChange={(v) => setOverride({ carryRate: v })} />
                <OverrideField label="Spend per new ad" value={overrides.spendPerAd} auto={String(round2(block.basis.spendPerAd))} disabled={monthLocked} onChange={(v) => setOverride({ spendPerAd: v })} />
                <OverrideField label="Moments share" suffix="%" value={overrides.momentsShare === undefined ? undefined : round2(overrides.momentsShare * 100)} auto={String(round2(block.basis.momentsShare * 100))} disabled={monthLocked} onChange={(v) => setOverride({ momentsShare: v === undefined ? undefined : v / 100 })} />
              </div>
            )}
          </div>
        </div>
      )}

      {history !== "loading" && <CreativeMonthView ctx={ctx} month={sel} history={data} block={block} asOf={asOf} />}

      {history !== "loading" && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">{plan.year} at a glance</h3>
          <CreativeYearTable rows={year.rows} total={year.total} selected={sel} onSelect={setSel} currency={client.currency} />
        </div>
      )}

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
