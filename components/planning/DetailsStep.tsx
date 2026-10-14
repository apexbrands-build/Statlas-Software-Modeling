"use client";

import { useState } from "react";
import { formatValue } from "@/lib/format";
import { aggregate } from "@/lib/metrics";
import { addYears, endOfMonth, todayLocal } from "@/lib/dates";
import { inputsFromFacts, sourceRange } from "@/lib/planning/history";
import type { PlanMonthInputs } from "@/lib/planning/types";
import type { PlanCtx } from "./ctx";
import { RoasLine } from "./RoasLine";
import { btn, btnPrimary, inputClass, MONTHS, NumField } from "./ui";

/** Returning revenue per month, next to last year, so it can be overridden with one number. */
function ReturningLine({ ctx }: { ctx: PlanCtx }) {
  const { months, rows, client, history, editInputs } = ctx;
  const money = (v: number | null) => formatValue(v, "currency0", client.currency);
  const pct = (v: number | null) => formatValue(v, "percent1", client.currency);

  const data = months.map((m) => {
    const ly = aggregate(history.facts.filter((f) => f.date >= addYears(m.month, -1) && f.date <= addYears(endOfMonth(m.month), -1)));
    const lyOrder = ly.newOrderRevenue + ly.returningOrderRevenue;
    const day = rows[m.month] ?? [];
    const order = day.reduce((a, r) => a + r.orderRevenue, 0);
    return { m, lyHas: ly.days > 0, lyRet: ly.returningOrderRevenue, lyOrder, order, ret: m.inputs?.returningRevenue ?? null };
  });
  const sum = (f: (d: (typeof data)[number]) => number) => data.reduce((a, d) => a + f(d), 0);
  const totOrder = sum((d) => d.order);
  const totRet = sum((d) => d.ret ?? 0);
  const totLyRet = sum((d) => d.lyRet);
  const totLyOrder = sum((d) => d.lyOrder);

  return (
    <div className="space-y-3">
      <p className="max-w-3xl text-sm text-text-muted">
        Returning order revenue per month. The Returning Customer Model (Models tab) fills the Model column, including the customers the plan will acquire. Type an Override when you know something the past does not, like a subscription launch; it beats the model until you clear it. After a couple of months, actualize the model to follow the real behaviour.
      </p>
      <div className="overflow-x-auto rounded-xl border border-border bg-surface">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-xs text-text-muted">
              <th className="px-3 py-2 text-left">Month</th>
              <th className="px-2 py-2 text-right">Order revenue (plan)</th>
              <th className="px-2 py-2 text-right">Returning revenue (plan)</th>
              <th className="px-2 py-2 text-right">Model</th>
              <th className="px-2 py-2 text-right">Override</th>
              <th className="px-2 py-2 text-right">% of order revenue</th>
              <th className="px-2 py-2 text-right">Last year returning</th>
              <th className="px-2 py-2 text-right">Last year %</th>
              <th className="px-2 py-2 text-right">vs last year</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d, i) => (
              <tr key={d.m.month} className="border-b border-border/40">
                <td className="px-3 py-1">
                  {MONTHS[i]} {d.m.locked && "🔒"}
                </td>
                <td className="px-2 py-1 text-right tabular">{d.m.inputs ? money(d.order) : "–"}</td>
                <td className="px-2 py-1 text-right tabular font-medium">{d.m.inputs ? money(d.ret ?? 0) : <span className="text-text-faint" title="Start this month in the Overview tab first">–</span>}</td>
                <td className="px-2 py-1 text-right tabular text-text-muted">{d.m.inputs?.returningModel != null ? money(d.m.inputs.returningModel) : "–"}</td>
                <td className="px-2 py-1 text-right">
                  {d.m.inputs ? (
                    <span className="inline-flex items-center gap-1">
                      <NumField
                        value={d.m.inputs.returningOverride ?? 0}
                        disabled={d.m.locked}
                        className="w-28"
                        onCommit={(v) => editInputs(d.m.month, (x) => (v > 0 ? { ...x, returningOverride: v, returningRevenue: v } : { ...x, returningOverride: null, returningRevenue: x.returningModel ?? x.returningRevenue }))}
                      />
                      {d.m.inputs.returningOverride != null && !d.m.locked && (
                        <button className="text-xs text-accent underline" title="Go back to the model" onClick={() => editInputs(d.m.month, (x) => ({ ...x, returningOverride: null, returningRevenue: x.returningModel ?? x.returningRevenue }))}>
                          clear
                        </button>
                      )}
                    </span>
                  ) : (
                    <span className="text-text-faint">–</span>
                  )}
                </td>
                <td className="px-2 py-1 text-right tabular">{d.m.inputs && d.order ? pct((d.ret ?? 0) / d.order) : "–"}</td>
                <td className="px-2 py-1 text-right tabular text-text-muted">{d.lyHas ? money(d.lyRet) : "–"}</td>
                <td className="px-2 py-1 text-right tabular text-text-muted">{d.lyHas && d.lyOrder ? pct(d.lyRet / d.lyOrder) : "–"}</td>
                <td className="px-2 py-1 text-right tabular text-text-muted">{d.lyHas && d.lyRet && d.ret !== null ? pct(d.ret / d.lyRet - 1) : "–"}</td>
              </tr>
            ))}
            <tr className="bg-surface-raised font-semibold">
              <td className="px-3 py-2">{ctx.plan.year}</td>
              <td className="px-2 py-2 text-right tabular">{money(totOrder)}</td>
              <td className="px-2 py-2 text-right tabular">{money(totRet)}</td>
              <td colSpan={2} />
              <td className="px-2 py-2 text-right tabular">{totOrder ? pct(totRet / totOrder) : "–"}</td>
              <td className="px-2 py-2 text-right tabular">{money(totLyRet)}</td>
              <td className="px-2 py-2 text-right tabular">{totLyOrder ? pct(totLyRet / totLyOrder) : "–"}</td>
              <td className="px-2 py-2 text-right tabular">{totLyRet && totRet ? pct(totRet / totLyRet - 1) : "–"}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Details: the other lines of the forecast, one table per line         */
/* ------------------------------------------------------------------ */

type Rates = PlanMonthInputs["rates"];
interface LineDef {
  id: string;
  label: string;
  unit: "pct" | "money" | "revenue";
  help: string;
  get: (i: PlanMonthInputs) => number;
  set: (i: PlanMonthInputs, v: number) => PlanMonthInputs;
  /** Value of this line in a set of actuals (null = no data). */
  actual: (x: PlanMonthInputs | null) => number | null;
}
const rate = (k: keyof Rates) => ({ get: (i: PlanMonthInputs) => i.rates[k], set: (i: PlanMonthInputs, v: number): PlanMonthInputs => ({ ...i, rates: { ...i.rates, [k]: v } }), actual: (x: PlanMonthInputs | null) => (x ? x.rates[k] : null) });

const LINES: LineDef[] = [
  { id: "returning", label: "Returning revenue", unit: "revenue", help: "", get: (i) => i.returningRevenue, set: (i, v) => ({ ...i, returningRevenue: v }), actual: () => null },
  { id: "discounts", label: "Discounts", unit: "pct", help: "Discounts as % of gross sales. Q4 usually runs deeper, so last year's same month is the default.", ...rate("discountPct") },
  { id: "shipping", label: "Shipping", unit: "pct", help: "Shipping charged to customers, as % of gross sales after discounts.", ...rate("shippingPct") },
  { id: "taxes", label: "Taxes", unit: "pct", help: "Sales tax collected, as % of gross sales after discounts (part of order revenue, never of CM).", ...rate("taxPct") },
  { id: "returns", label: "Returns", unit: "pct", help: "Refunds as % of gross sales after discounts.", ...rate("refundPct") },
  { id: "cogs", label: "COGS", unit: "pct", help: "Cost of goods as % of net sales (from Shopify variant costs, or the client's flat rate).", ...rate("cogsPct") },
  { id: "variable", label: "Variable costs", unit: "pct", help: "Other variable costs (cost of delivery, fees) as % of net sales plus shipping.", ...rate("otherVarPct") },
  { id: "sga", label: "SG&A (fixed costs)", unit: "money", help: "Fixed monthly costs. Only used in the Plan P&L, never in contribution margin. Starts from the client's setting.", get: (i) => i.fixedCosts ?? 0, set: (i, v) => ({ ...i, fixedCosts: v }), actual: (x) => (x ? (x.fixedCosts ?? 0) : null) },
  // The ROAS line has its own table (channels by month); the entry only places it in the menu.
  { id: "roas", label: "ROAS targets", unit: "revenue", help: "", get: () => 0, set: (i) => i, actual: () => null },
];

type Basis = "last_year" | "recent" | "range";

export function DetailsStep({ ctx }: { ctx: PlanCtx }) {
  const [line, setLine] = useState("returning");
  const def = LINES.find((l) => l.id === line) ?? LINES[0];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          Line
          <select className={inputClass} value={line} onChange={(e) => setLine(e.target.value)} aria-label="Line">
            {LINES.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
        </label>
        <button className={btn} disabled={LINES.findIndex((l) => l.id === line) === 0} onClick={() => setLine(LINES[LINES.findIndex((l) => l.id === line) - 1].id)}>
          Back
        </button>
        <button className={btn} disabled={LINES.findIndex((l) => l.id === line) === LINES.length - 1} onClick={() => setLine(LINES[LINES.findIndex((l) => l.id === line) + 1].id)}>
          Next
        </button>
      </div>
      {def.id === "returning" ? <ReturningLine ctx={ctx} /> : def.id === "roas" ? <RoasLine ctx={ctx} /> : <RateLine ctx={ctx} def={def} />}
      <p className="text-xs text-text-faint">Email, SMS and organic revenue lines are not planned yet: strategists usually forecast totals only. Spend, aMER and returning revenue come from the Models.</p>
    </div>
  );
}

function RateLine({ ctx, def }: { ctx: PlanCtx; def: LineDef }) {
  const { months, history, settings, client, editInputs, plan } = ctx;
  const [basis, setBasis] = useState<Basis>("last_year");
  const [growth, setGrowth] = useState(0);
  const [from, setFrom] = useState(`${plan.year - 1}-04-01`);
  const [to, setTo] = useState(`${plan.year - 1}-06-30`);
  const [msg, setMsg] = useState<string | null>(null);
  const today = todayLocal();
  const fmt = (v: number | null) => (v == null ? "–" : def.unit === "pct" ? `${v.toFixed(2)}%` : formatValue(v, def.unit === "money" && def.id.endsWith("Aov") ? "currency2" : "currency0", client.currency));

  const over = (a: string, b: string, count: number): PlanMonthInputs | null => inputsFromFacts(history.facts.filter((f) => f.date >= a && f.date <= b), count, settings, "actuals");
  const ly = (month: string) => {
    const r = sourceRange("last_year", month, today);
    return def.actual(over(r.from, r.to, 1));
  };
  const actual = (month: string) => {
    const end = endOfMonth(month);
    return end <= history.lastData ? def.actual(over(month, end, 1)) : null;
  };
  const inferred = (month: string): number | null => {
    if (basis === "last_year") return ly(month);
    if (basis === "recent") {
      const r = sourceRange("recent", month, today);
      return def.actual(over(r.from, r.to, r.months));
    }
    const days = Math.max(1, (new Date(to).getTime() - new Date(from).getTime()) / 86400000 + 1);
    return def.actual(over(from, to, Math.max(1, days / 30.4)));
  };
  const round = (v: number) => Math.round(v * (def.unit === "pct" ? 100 : 100)) / 100;

  const apply = () => {
    let n = 0;
    for (const m of months) {
      if (m.locked) continue;
      const v = inferred(m.month);
      if (v == null) continue;
      editInputs(m.month, (i) => def.set(i, round(v * (1 + growth / 100))), true);
      n += 1;
    }
    setMsg(n ? `Applied to ${n} month${n === 1 ? "" : "s"} (locked months skipped). Press Save plan to update the daily targets.` : "No data to infer from for that choice.");
  };
  const actualize = () => {
    let n = 0;
    for (const m of months) {
      if (m.locked) continue;
      const v = actual(m.month);
      if (v == null) continue;
      editInputs(m.month, (i) => def.set(i, round(v)), true);
      n += 1;
    }
    setMsg(n ? `${n} elapsed month${n === 1 ? "" : "s"} set to what actually happened.` : "No completed months with data yet.");
  };

  const th = "px-2 py-2 text-right font-medium";
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_260px]">
      <div className="space-y-3">
        <div>
          <h3 className="text-base font-semibold">{def.label}</h3>
          <p className="max-w-3xl text-sm text-text-muted">{def.help}</p>
        </div>
        <div className="overflow-x-auto rounded-xl border border-border bg-surface">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-text-muted">
                <th className="px-3 py-2 text-left">Month</th>
                <th className={th}>Plan</th>
                <th className={th}>Inferred</th>
                <th className={th}>Last year</th>
                <th className={th}>vs last year</th>
                <th className={th}>Actual</th>
                <th className="w-16" />
              </tr>
            </thead>
            <tbody>
              {months.map((m, i) => {
                const cur = m.inputs ? def.get(m.inputs) : null;
                const lyV = ly(m.month);
                const inf = inferred(m.month);
                const act = actual(m.month);
                const diff = cur != null && lyV ? (def.unit === "pct" ? `${cur - lyV >= 0 ? "+" : ""}${(cur - lyV).toFixed(2)} pts` : `${cur >= lyV ? "+" : ""}${(((cur - lyV) / lyV) * 100).toFixed(1)}%`) : "–";
                return (
                  <tr key={m.month} className="border-b border-border/40">
                    <td className="px-3 py-1">
                      {MONTHS[i]} {m.locked && "🔒"}
                    </td>
                    <td className="px-2 py-1 text-right">
                      <NumField value={cur ?? 0} decimals={2} className="w-24" suffix={def.unit === "pct" ? "%" : undefined} disabled={m.locked} onCommit={(v) => editInputs(m.month, (x) => def.set(x, v), true)} />
                    </td>
                    <td className="px-2 py-1 text-right tabular text-text-muted">{fmt(inf)}</td>
                    <td className="px-2 py-1 text-right tabular text-text-muted">{fmt(lyV)}</td>
                    <td className="px-2 py-1 text-right tabular text-text-muted">{diff}</td>
                    <td className="px-2 py-1 text-right tabular">{fmt(act)}</td>
                    <td className="px-1 text-right">
                      {inf != null && !m.locked && (
                        <button className="text-xs text-accent underline" title="Set this month to the inferred value" onClick={() => editInputs(m.month, (x) => def.set(x, round(inf * (1 + growth / 100))), true)}>
                          use
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {msg && <p className="text-xs text-text-muted">{msg}</p>}
      </div>

      <aside className="space-y-3 self-start rounded-xl border border-border bg-surface p-4">
        <h3 className="text-sm font-semibold">Modeling tools</h3>
        <button className={`${btnPrimary} w-full`} onClick={actualize}>
          Actualize all YTD
        </button>
        <p className="text-[11px] text-text-faint">Sets every completed month to what actually happened.</p>
        <div className="space-y-2 border-t border-border pt-3">
          <label className="block text-xs text-text-muted">
            Extrapolate based on
            <select className={`${inputClass} mt-1 w-full`} value={basis} onChange={(e) => setBasis(e.target.value as Basis)}>
              <option value="last_year">Same month last year (YoY)</option>
              <option value="recent">Last 3 months</option>
              <option value="range">Date range</option>
            </select>
          </label>
          {basis === "range" && (
            <div className="flex gap-1">
              <input type="date" className={`${inputClass} w-full`} value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} />
              <input type="date" className={`${inputClass} w-full`} value={to} onChange={(e) => e.target.value && setTo(e.target.value)} />
            </div>
          )}
          <label className="block text-xs text-text-muted">
            % increase / decrease
            <div className="mt-1">
              <NumField value={growth} decimals={1} className="w-20" suffix="%" onCommit={setGrowth} />
            </div>
          </label>
          <button className={`${btnPrimary} w-full`} onClick={apply}>
            Apply to open months
          </button>
        </div>
      </aside>
    </div>
  );
}
