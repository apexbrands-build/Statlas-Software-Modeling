"use client";

import { useState } from "react";
import { addDays, addYears, dayOfWeek, endOfMonth, todayLocal } from "@/lib/dates";
import { eventDays, TYPE_LABEL } from "@/lib/planning/events";
import { formatValue } from "@/lib/format";
import { rebalance } from "@/lib/planning/alloc";
import { dailySpendColumns, defaultSpendMonth } from "@/lib/planning/spend-columns";
import { PLAN_PLATFORMS, type DayOverride, type PlanMonthInputs } from "@/lib/planning/types";
import { CHANNEL_LABELS, type ChannelKey } from "@/lib/types";
import { aggregate, aggregatePlan, planAmerSpend, totalSpend } from "@/lib/metrics";
import { roasChannels, roasTarget } from "@/lib/planning/roas";
import { Legend, LineChart } from "./models/charts";
import type { PlanCtx } from "./ctx";
import { FillMenu } from "./FillMenu";
import { btn, inputClass, MONTHS, NumField, WEEKDAYS } from "./ui";

const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Monday first

/** Step 2: one month in detail: platform split, brand / non-acquisition share, weekday pattern and the daily table. */
export function SpendStep({ ctx }: { ctx: PlanCtx }) {
  const { months, client, settings, rows, seasonality, setSeasonality, editInputs, fill, history, historySeasonality, events, eventMults } = ctx;
  const [month, setMonth] = useState(() => defaultSpendMonth(months, todayLocal()));
  const [msg, setMsg] = useState<string | null>(null);
  const m = months.find((x) => x.month === month) ?? months[0];
  const money = (v: number | null, f: "currency0" | "currency2" | "ratio2" | "percent1" = "currency0") => formatValue(v, f, client.currency);
  const inputs = m.inputs;
  const dayRows = rows[m.month] ?? [];
  const totals = aggregatePlan(dayRows);
  const acqOf = (r: (typeof dayRows)[number]) => planAmerSpend(aggregatePlan([r]), settings);
  const keys = PLAN_PLATFORMS.map((p) => p.key);
  const spendCols = dailySpendColumns(dayRows);

  // Last year, day by day (364 days earlier keeps the weekday) and for the month.
  const factByDate = new Map(history.facts.map((f) => [f.date, f]));
  const lyDay = (date: string) => factByDate.get(addDays(date, -364));
  const lyMonth = aggregate(history.facts.filter((f) => f.date >= addYears(m.month, -1) && f.date <= endOfMonth(addYears(m.month, -1))));
  const lyHas = lyMonth.days > 0;
  const eventsOn = (date: string) => events.filter((e) => eventDays(e).includes(date));
  const varPct = (cur: number, ly: number) => (ly > 0 ? `${cur >= ly ? "+" : ""}${(((cur - ly) / ly) * 100).toFixed(0)}% vs LY` : null);
  const pctSum = inputs ? keys.reduce((a, k) => a + (inputs.platformPct[k] ?? 0), 0) : 0;

  const setOverride = (date: string, patch: Partial<DayOverride> | null) =>
    editInputs(m.month, (i) => {
      const overrides = { ...(i.overrides ?? {}) };
      if (patch === null) delete overrides[date];
      else overrides[date] = { ...overrides[date], ...patch };
      return { ...i, overrides };
    });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <select value={month} onChange={(e) => setMonth(e.target.value)} className={inputClass} aria-label="Month">
          {months.map((x, i) => (
            <option key={x.month} value={x.month}>
              {MONTHS[i]} {ctx.plan.year}
              {x.locked ? " (locked)" : ""}
            </option>
          ))}
        </select>
        {m.locked && <span className="rounded-full border border-border px-2 py-0.5 text-xs text-text-muted">🔒 Locked: unlock it in the Overview tab to edit</span>}
        {inputs && (
          <>
            <label className="flex items-center gap-1 text-sm text-text-muted">
              Spend
              <NumField value={inputs.spend} disabled={m.locked} onCommit={(v) => editInputs(m.month, (i) => ({ ...i, spend: Math.max(0, v) }))} />
            </label>
            <label className="flex items-center gap-1 text-sm text-text-muted">
              aMER
              <NumField value={inputs.amer} decimals={2} disabled={m.locked} className="w-16" onCommit={(v) => editInputs(m.month, (i) => ({ ...i, amer: Math.max(0, v) }))} />
            </label>
            <dl className="ml-auto flex flex-wrap gap-4 text-sm">
              {(
                [
                  ["Spend", totals.spend, totalSpend(lyMonth)],
                  ["New revenue", totals.newRevenue, lyMonth.newOrderRevenue],
                  ["Returning", totals.returningRevenue, lyMonth.returningOrderRevenue],
                  ["Revenue", totals.orderRevenue, lyMonth.newOrderRevenue + lyMonth.returningOrderRevenue],
                  ["CM", totals.cm, null],
                ] as const
              ).map(([l, v, ly]) => (
                <div key={l} className="border-l-2 border-accent pl-2">
                  <dt className="text-[11px] text-text-muted">{l}</dt>
                  <dd className="tabular font-medium">{money(v)}</dd>
                  {lyHas && ly != null && <dd className="text-[10px] text-text-faint">{varPct(v, ly)}</dd>}
                </div>
              ))}
            </dl>
          </>
        )}
      </div>
      {msg && <p className="text-xs text-text-muted">{msg}</p>}

      {!inputs ? (
        <div className="space-y-2 rounded-xl border border-border bg-surface p-6 text-sm text-text-muted">
          <p>This month has no inputs yet. Start it from real numbers:</p>
          <div className="w-48">
            <FillMenu month={m.month} disabled={m.locked || history.loading} fill={fill} onResult={setMsg} label="Start from…" />
          </div>
        </div>
      ) : (
        <>
          <div className="grid gap-5 lg:grid-cols-2">
            <section className="space-y-2 rounded-xl border border-border bg-surface p-4">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="mr-auto text-sm font-semibold">Platform allocation</h3>
                {/* Placeholders for the Marketing Mix Model (planned: docs/superpowers/plans/2026-10-13-channel-mix-and-mmm-option.md). Disabled until a model result exists. */}
                <button className={btn} disabled title="Available once the Marketing Mix Model is built: it will suggest the split from the client's own history and you will apply it here.">
                  Use Marketing Mix Model
                </button>
                <button className={btn} disabled title="Available once the Marketing Mix Model is built: model strength, allocation analysis and outputs.">
                  See MMM data
                </button>
              </div>
              <p className="text-xs text-text-muted">Share of the month&apos;s spend per platform. Lock a platform to keep its share when you move the others. The Marketing Mix Model suggestion will plug in here.</p>
              {PLAN_PLATFORMS.map((p) => {
                const v = inputs.platformPct[p.key] ?? 0;
                const locked = inputs.lockedPlatforms?.includes(p.key) ?? false;
                return (
                  <div key={p.key} className="flex items-center gap-2 text-sm">
                    <span className="w-28 shrink-0">{p.label}</span>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={0.5}
                      value={v}
                      disabled={m.locked || locked}
                      aria-label={`${p.label} share`}
                      className="min-w-0 flex-1 accent-[var(--apex-accent)]"
                      onChange={(e) => editInputs(m.month, (i) => ({ ...i, platformPct: rebalance(i.platformPct, keys, i.lockedPlatforms ?? [], p.key, Number(e.target.value)) }))}
                    />
                    <NumField value={v} decimals={2} className="w-16" suffix="%" disabled={m.locked || locked} onCommit={(x) => editInputs(m.month, (i) => ({ ...i, platformPct: rebalance(i.platformPct, keys, i.lockedPlatforms ?? [], p.key, x) }))} />
                    <button
                      title={locked ? "Unlock this platform" : "Keep this share when other platforms change"}
                      aria-label={`${locked ? "Unlock" : "Lock"} ${p.label}`}
                      className="text-text-faint hover:text-text"
                      disabled={m.locked}
                      onClick={() => editInputs(m.month, (i) => ({ ...i, lockedPlatforms: locked ? (i.lockedPlatforms ?? []).filter((k) => k !== p.key) : [...(i.lockedPlatforms ?? []), p.key] }))}
                    >
                      {locked ? "🔒" : "🔓"}
                    </button>
                  </div>
                );
              })}
              {Math.abs(pctSum - 100) > 0.05 && <p className="text-xs text-bad">{pctSum === 0 ? "No platform split set: total spend is planned but not split by platform." : `Platform shares add to ${pctSum.toFixed(2)}%: they are scaled to 100% when targets are generated.`}</p>}

              <h3 className="pt-3 text-sm font-semibold">Brand and non-acquisition share</h3>
              <p className="text-xs text-text-muted">Part of a platform&apos;s spend that is Google Brand or non-acquisition (existing customers). Matters for aMER when your client settings exclude them.</p>
              {PLAN_PLATFORMS.filter((p) => (inputs.platformPct[p.key] ?? 0) > 0).map((p) => (
                <div key={p.key} className="flex items-center gap-2 text-sm">
                  <span className="w-44 shrink-0">
                    {p.label} <span className="text-xs text-text-faint">{p.altLabel}</span>
                  </span>
                  <input type="range" min={0} max={100} step={0.5} value={inputs.altPct[p.key] ?? 0} disabled={m.locked} aria-label={`${p.label} ${p.altLabel}`} className="min-w-0 flex-1 accent-[var(--apex-accent)]" onChange={(e) => editInputs(m.month, (i) => ({ ...i, altPct: { ...i.altPct, [p.key]: Number(e.target.value) } }))} />
                  <NumField value={inputs.altPct[p.key] ?? 0} decimals={2} className="w-16" suffix="%" disabled={m.locked} onCommit={(x) => editInputs(m.month, (i) => ({ ...i, altPct: { ...i.altPct, [p.key]: Math.min(100, Math.max(0, x)) } }))} />
                </div>
              ))}
            </section>

            <section className="space-y-2 rounded-xl border border-border bg-surface p-4">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold">Weekday pattern</h3>
                <span className="text-[11px] text-text-faint">same for every month of this plan</span>
              </div>
              <p className="text-xs text-text-muted">
                How much stronger or weaker each weekday is than an average day. Spend and returning revenue follow it. {historySeasonality ? "Calculated from this client's Shopify orders (last 12 months, Black Friday week and one-off spikes ignored)." : history.loading ? "Loading history…" : "Not enough Shopify history to calculate it, so it starts flat."}
              </p>
              <div className="flex items-center gap-2 text-sm">
                <span className="w-28 shrink-0">Strength</span>
                <input type="range" min={0} max={100} step={5} value={seasonality.effectPct} className="min-w-0 flex-1 accent-[var(--apex-accent)]" aria-label="Weekday pattern strength" onChange={(e) => setSeasonality({ ...seasonality, effectPct: Number(e.target.value) })} />
                <span className="w-14 text-right tabular">{seasonality.effectPct}%</span>
              </div>
              {WEEK_ORDER.map((d) => (
                <div key={d} className="flex items-center gap-2 text-sm">
                  <span className="w-28 shrink-0">{WEEKDAYS[d]}</span>
                  <input type="range" min={-60} max={100} step={0.5} value={seasonality.dow[d] ?? 0} className="min-w-0 flex-1 accent-[var(--apex-accent)]" aria-label={`${WEEKDAYS[d]} offset`} onChange={(e) => setSeasonality({ ...seasonality, dow: seasonality.dow.map((x, j) => (j === d ? Number(e.target.value) : x)) })} />
                  <NumField value={seasonality.dow[d] ?? 0} decimals={2} className="w-16" suffix="%" onCommit={(x) => setSeasonality({ ...seasonality, dow: seasonality.dow.map((y, j) => (j === d ? x : y)) })} />
                </div>
              ))}
              <div className="flex gap-2 pt-1">
                <button className={btn} disabled={!historySeasonality} onClick={() => historySeasonality && setSeasonality(historySeasonality)}>
                  Recalculate from Shopify data
                </button>
                <button className={btn} onClick={() => setSeasonality({ ...seasonality, dow: [0, 0, 0, 0, 0, 0, 0] })}>
                  Flat (no pattern)
                </button>
              </div>
            </section>
          </div>

          <RoasPanel ctx={ctx} inputs={inputs} totals={totals} money={money} />

          {lyHas && (
            <section className="grid gap-4 lg:grid-cols-2">
              {(
                [
                  ["Daily spend: plan vs last year", (r: (typeof dayRows)[number]) => r.spend, (f: ReturnType<typeof lyDay>) => (f ? totalSpend(aggregate([f])) : null)],
                  ["Daily order revenue: plan vs last year", (r: (typeof dayRows)[number]) => r.orderRevenue, (f: ReturnType<typeof lyDay>) => (f ? f.newOrderRevenue + f.returningOrderRevenue : null)],
                ] as const
              ).map(([title, cur, ly]) => (
                <div key={title} className="space-y-1 rounded-xl border border-border bg-surface p-4">
                  <h3 className="text-sm font-semibold">{title}</h3>
                  <LineChart
                    labels={dayRows.map((r, i) => (i % 5 === 0 ? String(Number(r.date.slice(8))) : ""))}
                    yFmt={(v) => formatValue(v, "currency0", client.currency)}
                    height={200}
                    series={[
                      { label: "Plan", color: "#38bdf8", values: dayRows.map((r) => cur(r)) },
                      { label: "Last year", color: "#facc15", values: dayRows.map((r) => ly(lyDay(r.date))) },
                    ]}
                  />
                  <Legend items={[{ label: "Plan", color: "#38bdf8" }, { label: "Last year (same weekday)", color: "#facc15" }]} />
                </div>
              ))}
            </section>
          )}

          <section className="space-y-2">
            <h3 className="text-sm font-semibold">Daily plan for {MONTHS[Number(m.month.slice(5, 7)) - 1]}</h3>
            <p className="text-xs text-text-muted">Type over any daily value to fix that day (🔒). The rest of the month absorbs the difference so the month total stays the same. Days with marketing events (Calendar tab) run hotter and the other days are compressed; the lifts come from the Event Effect Model.</p>
            <div className="overflow-x-auto rounded-xl border border-border bg-surface">
              <table className="w-full border-collapse text-sm" style={{ minWidth: 980 + spendCols.length * 90 }}>
                <thead>
                  <tr className="border-b border-border text-xs text-text-muted">
                    <th className="px-3 py-2 text-left">Day</th>
                    <th className="px-2 py-2 text-left">Events</th>
                    <th className="px-2 py-2 text-right">Spend</th>
                    {spendCols.map((c) => (
                      <th key={c.key} className="px-2 py-2 text-right font-normal">
                        {c.label}
                      </th>
                    ))}
                    <th className="px-2 py-2 text-right">aMER</th>
                    <th className="px-2 py-2 text-right">New revenue</th>
                    <th className="px-2 py-2 text-right">Returning</th>
                    <th className="px-2 py-2 text-right">Order revenue</th>
                    <th className="px-2 py-2 text-right">CM</th>
                    <th className="w-8" />
                  </tr>
                  <tr className="border-b border-border bg-surface-raised text-xs font-semibold">
                    <td className="px-3 py-1">Month total</td>
                    <td />
                    <td className="px-2 py-1 text-right tabular">{money(totals.spend)}</td>
                    {spendCols.map((c) => (
                      <td key={c.key} className="px-2 py-1 text-right tabular">
                        {money(totals.spendByChannel[c.key] ?? 0)}
                      </td>
                    ))}
                    <td className="px-2 py-1 text-right tabular">{planAmerSpend(totals, settings) ? money(totals.newRevenue / planAmerSpend(totals, settings), "ratio2") : "–"}</td>
                    <td className="px-2 py-1 text-right tabular">{money(totals.newRevenue)}</td>
                    <td className="px-2 py-1 text-right tabular">{money(totals.returningRevenue)}</td>
                    <td className="px-2 py-1 text-right tabular">{money(totals.orderRevenue)}</td>
                    <td className="px-2 py-1 text-right tabular">{money(totals.cm)}</td>
                    <td />
                  </tr>
                </thead>
                <tbody>
                  {dayRows.map((r) => {
                    const ov = inputs.overrides?.[r.date];
                    return (
                      <tr key={r.date} className="border-b border-border/40">
                        <td className="px-3 py-1 text-text-muted">
                          {Number(r.date.slice(8))} <span className="text-xs text-text-faint">{WEEKDAYS[dayOfWeek(r.date)].toLowerCase()}</span>
                        </td>
                        <td className="px-2 py-1 text-left text-xs">
                          {eventsOn(r.date).map((e) => (
                            <span key={e.id} className="mr-1 inline-block rounded-full bg-accent/15 px-2 py-0.5" title={TYPE_LABEL[e.type]}>
                              {e.name || TYPE_LABEL[e.type]}
                            </span>
                          ))}
                          {eventMults[r.date] && <span className="text-[10px] text-text-faint">spend ×{eventMults[r.date].spend.toFixed(2)}</span>}
                        </td>
                        <td className="px-2 py-1 text-right">
                          <NumField value={r.spend} disabled={m.locked} className="w-24" onCommit={(v) => setOverride(r.date, { spend: Math.max(0, v) })} />
                        </td>
                        {spendCols.map((c) => (
                          <td key={c.key} className="px-2 py-1 text-right tabular text-text-muted">
                            {money(r.spendByChannel[c.key] ?? 0)}
                          </td>
                        ))}
                        <td className="px-2 py-1 text-right tabular text-text-muted">{acqOf(r) ? (r.newRevenue / acqOf(r)).toFixed(2) : "–"}</td>
                        <td className="px-2 py-1 text-right">
                          <NumField value={r.newRevenue} disabled={m.locked} className="w-24" onCommit={(v) => setOverride(r.date, { newRevenue: Math.max(0, v) })} />
                        </td>
                        <td className="px-2 py-1 text-right">
                          <NumField value={r.returningRevenue} disabled={m.locked} className="w-24" onCommit={(v) => setOverride(r.date, { returningRevenue: Math.max(0, v) })} />
                        </td>
                        <td className="px-2 py-1 text-right tabular">{money(r.orderRevenue)}</td>
                        <td className={`px-2 py-1 text-right tabular ${r.cm < 0 ? "text-bad" : ""}`}>{money(r.cm)}</td>
                        <td className="px-1 text-center">
                          {ov && (
                            <button title="Fixed day: click to release it" aria-label={`Release ${r.date}`} disabled={m.locked} onClick={() => setOverride(r.date, null)}>
                              🔒
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

/** The month's ROAS targets next to the spend that was just allocated: what each channel's planned spend should return. Edited in Details. */
function RoasPanel({ ctx, inputs, totals, money }: { ctx: PlanCtx; inputs: PlanMonthInputs; totals: ReturnType<typeof aggregatePlan>; money: (v: number | null, f?: "currency0" | "currency2" | "ratio2" | "percent1") => string }) {
  const { settings, months } = ctx;
  const factorOf = (k: ChannelKey) => settings.multipliers[k] ?? 1;
  const rows = roasChannels(settings, months)
    .filter((k) => (totals.spendByChannel[k] ?? 0) > 0)
    .map((k) => {
      const t = roasTarget(inputs, k, factorOf(k));
      const spend = totals.spendByChannel[k] ?? 0;
      return { k, spend, factor: factorOf(k), platform: t.value, manual: t.manual, incremental: t.value === null ? null : t.value * factorOf(k), expected: t.value === null ? null : spend * t.value };
    });
  if (!rows.length) return null;
  const th = "px-2 py-2 text-right font-medium";
  return (
    <section className="space-y-2 rounded-xl border border-border bg-surface p-4">
      <h3 className="text-sm font-semibold">ROAS targets</h3>
      <p className="text-xs text-text-muted">What the planned spend should return. Platform ROAS target = aMER ÷ the channel&apos;s incrementality factor; the incremental ROAS target is the aMER. Change them in Details, ROAS targets.</p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-xs text-text-muted">
              <th className="px-2 py-2 text-left">Channel</th>
              <th className={th}>Planned spend</th>
              <th className={th}>Factor</th>
              <th className={th}>iROAS target</th>
              <th className={th}>Platform ROAS target</th>
              <th className={th}>Expected platform revenue</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.k} className="border-b border-border/40">
                <td className="px-2 py-1">{CHANNEL_LABELS[r.k]}</td>
                <td className="px-2 py-1 text-right tabular">{money(r.spend)}</td>
                <td className="px-2 py-1 text-right tabular text-text-muted">{r.factor}</td>
                <td className="px-2 py-1 text-right tabular">{r.incremental === null ? "–" : money(r.incremental, "ratio2")}</td>
                <td className={`px-2 py-1 text-right tabular font-medium ${r.manual ? "text-accent" : ""}`}>{r.platform === null ? "–" : money(r.platform, "ratio2")}</td>
                <td className="px-2 py-1 text-right tabular">{r.expected === null ? "–" : money(r.expected)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
