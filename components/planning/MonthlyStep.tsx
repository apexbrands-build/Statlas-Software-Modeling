"use client";

import { useState } from "react";
import { formatValue, type Format } from "@/lib/format";
import { aggregatePlan } from "@/lib/metrics";
import type { PlanMonthInputs, PlanRates } from "@/lib/planning/types";
import type { PlanCtx } from "./ctx";
import { FillMenu } from "./FillMenu";
import { btn, MONTHS, NumField } from "./ui";

type RateKey = keyof PlanRates;

const RATE_ROWS: { key: RateKey; label: string; hint: string; suffix?: string; decimals: number }[] = [
  { key: "discountPct", label: "Discounts", hint: "% of gross sales", suffix: "%", decimals: 2 },
  { key: "shippingPct", label: "Shipping charged", hint: "% of gross - discounts", suffix: "%", decimals: 2 },
  { key: "taxPct", label: "Tax", hint: "% of gross - discounts", suffix: "%", decimals: 2 },
  { key: "refundPct", label: "Refunds", hint: "% of gross - discounts", suffix: "%", decimals: 2 },
  { key: "cogsPct", label: "COGS", hint: "% of net sales", suffix: "%", decimals: 2 },
  { key: "otherVarPct", label: "Other variable costs", hint: "% of net sales + shipping", suffix: "%", decimals: 2 },
  { key: "newAov", label: "New customer AOV", hint: "order revenue per order", decimals: 2 },
  { key: "returningAov", label: "Returning AOV", hint: "order revenue per order", decimals: 2 },
];

/** Step 1: the whole year in one table. Type spend, aMER and returning revenue per month; the rest is derived. */
export function MonthlyStep({ ctx }: { ctx: PlanCtx }) {
  const { months, rows, client, settings, editInputs, fill, setLocked, history } = ctx;
  const [growth, setGrowth] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);
  const [showRates, setShowRates] = useState(true);
  const money = (v: number | null, f: Format = "currency0") => formatValue(v, f, client.currency);

  const setField = (month: string, fn: (i: PlanMonthInputs) => PlanMonthInputs) => editInputs(month, fn);
  const fillAll = (source: "last_year" | "recent") => {
    const problems: string[] = [];
    for (const m of months) {
      const e = ctx.fill(m.month, source, growth);
      if (e) problems.push(e);
    }
    setMsg(problems.length ? problems.slice(0, 3).join(" ") + (problems.length > 3 ? ` (+${problems.length - 3} more)` : "") : null);
  };
  const actualize = () => {
    if (!window.confirm("Replace the plan values for every elapsed month with this client's actuals? Locked months are skipped.")) return;
    const problems: string[] = [];
    for (const m of months) {
      if (m.month > history.lastData || endOf(m.month) > history.lastData) continue;
      const e = ctx.fill(m.month, "actuals");
      if (e) problems.push(e);
    }
    setMsg(problems.length ? problems.join(" ") : null);
  };

  const monthTotals = months.map((m) => aggregatePlan(rows[m.month] ?? []));
  const year = aggregatePlan(Object.values(rows).flat());
  const th = "px-2 py-2 text-right text-xs font-medium text-text-muted";
  const td = "px-2 py-1 text-right tabular text-sm";
  const hasInputs = (i: number) => months[i].inputs !== null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-surface p-3 text-sm">
        <div>
          <p className="text-xs text-text-muted">Fill empty or all months in one go</p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1 text-xs text-text-muted">
              Growth on last year
              <NumField value={growth} onCommit={setGrowth} decimals={1} className="w-16" suffix="%" />
            </label>
            <button className={btn} onClick={() => fillAll("last_year")} disabled={history.loading}>
              Fill all from last year
            </button>
            <button className={btn} onClick={() => fillAll("recent")} disabled={history.loading}>
              Fill all from last 3 months
            </button>
            <button className={btn} onClick={actualize} disabled={history.loading}>
              Actualize elapsed months
            </button>
          </div>
        </div>
        <p className="max-w-md text-xs text-text-faint">
          Spend, aMER and returning revenue are yours to set. Fill copies this client&apos;s real numbers (spend split, aMER, discount / shipping / refund / COGS rates) so you start from a realistic month and then adjust. Growth applies to spend and returning revenue.
        </p>
      </div>
      {msg && <p className="rounded-lg border border-border bg-surface p-2 text-xs text-text-muted">{msg}</p>}
      {history.loading && <p className="text-xs text-text-muted">Loading this client&apos;s history…</p>}

      <div className="overflow-x-auto rounded-xl border border-border bg-surface">
        <table className="w-full min-w-[1100px] border-collapse">
          <thead>
            <tr className="border-b border-border">
              <th className="sticky left-0 z-10 min-w-48 bg-surface px-3 py-2 text-left text-xs font-medium text-text-muted">{ctx.plan.year}</th>
              {months.map((m, i) => (
                <th key={m.month} className={`${th} min-w-24`}>
                  <div className="flex items-center justify-end gap-1">
                    <button title={m.locked ? "Locked: click to unlock" : "Lock this month"} onClick={() => setLocked(m.month, !m.locked)} className="text-text-faint hover:text-text" aria-label={`${m.locked ? "Unlock" : "Lock"} ${MONTHS[i]}`}>
                      {m.locked ? "🔒" : "🔓"}
                    </button>
                    <span className="text-text">{MONTHS[i]}</span>
                  </div>
                </th>
              ))}
              <th className={`${th} min-w-28`}>Year</th>
            </tr>
            <tr className="border-b border-border">
              <th className="sticky left-0 z-10 bg-surface px-3 py-1 text-left text-xs font-normal text-text-faint">Start from</th>
              {months.map((m) => (
                <th key={m.month} className="px-1 py-1">
                  <FillMenu month={m.month} disabled={m.locked || history.loading} growthPct={growth} fill={fill} onResult={setMsg} />
                </th>
              ))}
              <th />
            </tr>
          </thead>
          <tbody>
            <Section title="You decide" />
            <Row label="Ad spend" hint="all platforms">
              {months.map((m, i) => (
                <td key={m.month} className={td}>
                  {hasInputs(i) ? <NumField value={m.inputs!.spend} disabled={m.locked} onCommit={(v) => setField(m.month, (x) => ({ ...x, spend: Math.max(0, v) }))} /> : <Dash />}
                </td>
              ))}
              <td className={td}>{year.days ? money(year.spend) : "–"}</td>
            </Row>
            <Row label="aMER" hint="new revenue ÷ acquisition spend">
              {months.map((m, i) => (
                <td key={m.month} className={td}>
                  {hasInputs(i) ? <NumField value={m.inputs!.amer} decimals={2} disabled={m.locked} onCommit={(v) => setField(m.month, (x) => ({ ...x, amer: Math.max(0, v) }))} /> : <Dash />}
                </td>
              ))}
              <td className={td}>{money(year.spend ? year.newRevenue / year.spend : null, "ratio2")}</td>
            </Row>
            <Row label="Returning revenue" hint="order revenue from existing customers">
              {months.map((m, i) => (
                <td key={m.month} className={td}>
                  {hasInputs(i) ? <NumField value={m.inputs!.returningRevenue} disabled={m.locked} onCommit={(v) => setField(m.month, (x) => ({ ...x, returningRevenue: Math.max(0, v) }))} /> : <Dash />}
                </td>
              ))}
              <td className={td}>{year.days ? money(year.returningRevenue) : "–"}</td>
            </Row>

            <Section title="Result" />
            {(
              [
                ["New revenue", (t: ReturnType<typeof aggregatePlan>) => t.newRevenue, false],
                ["Order revenue", (t: ReturnType<typeof aggregatePlan>) => t.orderRevenue, true],
                ["Net sales", (t: ReturnType<typeof aggregatePlan>) => (t.grossSales === null ? 0 : t.grossSales - (t.discounts ?? 0) - (t.refunds ?? 0)), false],
                ["Contribution margin", (t: ReturnType<typeof aggregatePlan>) => t.cm, true],
              ] as const
            ).map(([label, pick, bold]) => (
              <Row key={label} label={label} bold={bold}>
                {monthTotals.map((t, i) => (
                  <td key={i} className={`${td} ${bold ? "font-semibold" : ""} ${label === "Contribution margin" && t.days && t.cm < 0 ? "text-bad" : ""}`}>
                    {t.days ? money(pick(t)) : "–"}
                  </td>
                ))}
                <td className={`${td} ${bold ? "font-semibold" : ""}`}>{year.days ? money(pick(year)) : "–"}</td>
              </Row>
            ))}
            <Row label="MER" hint="order revenue ÷ spend">
              {monthTotals.map((t, i) => (
                <td key={i} className={td}>
                  {t.days && t.spend ? money(t.orderRevenue / t.spend, "ratio2") : "–"}
                </td>
              ))}
              <td className={td}>{year.spend ? money(year.orderRevenue / year.spend, "ratio2") : "–"}</td>
            </Row>
            <Row label="CM % of order revenue">
              {monthTotals.map((t, i) => (
                <td key={i} className={td}>
                  {t.days && t.orderRevenue ? money(t.cm / t.orderRevenue, "percent1") : "–"}
                </td>
              ))}
              <td className={td}>{year.orderRevenue ? money(year.cm / year.orderRevenue, "percent1") : "–"}</td>
            </Row>

            <tr className="border-t border-border">
              <td colSpan={14} className="px-3 py-2">
                <button className="text-xs font-medium text-text-muted hover:text-text" onClick={() => setShowRates((s) => !s)}>
                  {showRates ? "▾" : "▸"} Rates that turn revenue into P&amp;L and CM
                </button>
              </td>
            </tr>
            {showRates &&
              RATE_ROWS.map((r) => (
                <Row key={r.key} label={r.label} hint={r.key === "otherVarPct" ? `${r.hint} (client default ${settings.otherVariablePct}%)` : r.hint}>
                  {months.map((m, i) => (
                    <td key={m.month} className={td}>
                      {hasInputs(i) ? (
                        <NumField value={m.inputs!.rates[r.key]} decimals={r.decimals} suffix={r.suffix} disabled={m.locked} className="w-16" onCommit={(v) => setField(m.month, (x) => ({ ...x, rates: { ...x.rates, [r.key]: Math.max(0, v) } }))} />
                      ) : (
                        <Dash />
                      )}
                    </td>
                  ))}
                  <td />
                </Row>
              ))}
            {showRates && (
              <Row label="Fixed costs (SG&A)" hint={`per month, only in Plan P&L, not CM (client default ${money(settings.monthlyFixedCosts)})`}>
                {months.map((m, i) => (
                  <td key={m.month} className={td}>
                    {hasInputs(i) ? <NumField value={m.inputs!.fixedCosts ?? settings.monthlyFixedCosts} disabled={m.locked} onCommit={(v) => setField(m.month, (x) => ({ ...x, fixedCosts: Math.max(0, v) }))} /> : <Dash />}
                  </td>
                ))}
                <td className={td}>{money(months.reduce((a, m) => a + (m.inputs ? (m.inputs.fixedCosts ?? settings.monthlyFixedCosts) : 0), 0))}</td>
              </Row>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-text-faint">
        CM = Net Sales + Shipping − COGS − Ad spend − Cost of delivery. Fixed costs are not part of CM (they appear in the Plan P&amp;L). A month only becomes a target once it has inputs and the plan is saved.
      </p>
    </div>
  );
}

function endOf(month: string) {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

const Dash = () => <span className="text-text-faint">–</span>;

function Section({ title }: { title: string }) {
  return (
    <tr>
      <td colSpan={14} className="bg-surface-raised px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
        {title}
      </td>
    </tr>
  );
}

function Row({ label, hint, bold, children }: { label: string; hint?: string; bold?: boolean; children: React.ReactNode }) {
  return (
    <tr className="border-b border-border/50">
      <th scope="row" className="sticky left-0 z-10 bg-surface px-3 py-1 text-left">
        <div className={`text-sm ${bold ? "font-semibold" : "font-normal"}`}>{label}</div>
        {hint && <div className="text-[10px] font-normal text-text-faint">{hint}</div>}
      </th>
      {children}
    </tr>
  );
}
