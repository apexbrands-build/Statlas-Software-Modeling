"use client";

import { useState } from "react";
import { dayOfWeek } from "@/lib/dates";
import { formatValue } from "@/lib/format";
import { aggregatePlan } from "@/lib/metrics";
import { PLAN_PLATFORMS } from "@/lib/planning/types";
import type { ChannelKey } from "@/lib/types";
import type { PlanCtx } from "./ctx";
import { btn, inputClass, MONTHS, WEEKDAYS } from "./ui";

/** Step 4: the final daily rows (what Home and the reports compare against). Read-only; CSV export. */
export function InputStep({ ctx }: { ctx: PlanCtx }) {
  const { months, rows, client } = ctx;
  const [month, setMonth] = useState((months.find((m) => m.inputs) ?? months[0]).month);
  const [copied, setCopied] = useState(false);
  const day = rows[month] ?? [];
  const t = aggregatePlan(day);
  const f = (v: number | null, fmt: "currency0" | "ratio2" | "percent1" = "currency0") => formatValue(v, fmt, client.currency);
  const channels: { key: ChannelKey; label: string }[] = PLAN_PLATFORMS.flatMap((p) => [
    { key: p.main, label: `${p.label}` },
    { key: p.alt, label: `${p.label} ${p.altLabel}` },
  ]).filter((c) => day.some((r) => (r.spendByChannel[c.key] ?? 0) > 0));

  const csv = () => {
    const head = ["Date", "Total revenue", "Spend", "MER", "aMER", "New revenue", "Returning revenue", "CM", ...channels.map((c) => `${c.label} spend`)];
    const body = day.map((r) => [r.date, r.orderRevenue, r.spend, r.spend ? r.orderRevenue / r.spend : "", r.spend ? r.newRevenue / r.spend : "", r.newRevenue, r.returningRevenue, r.cm, ...channels.map((c) => r.spendByChannel[c.key] ?? 0)].join(","));
    return [head.join(","), ...body].join("\n");
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <select value={month} onChange={(e) => setMonth(e.target.value)} className={inputClass} aria-label="Month">
          {months.map((m, i) => (
            <option key={m.month} value={m.month}>
              {MONTHS[i]} {ctx.plan.year}
            </option>
          ))}
        </select>
        <span className="text-xs text-text-muted">These are the daily targets after you save. Change them in the earlier steps.</span>
        <button
          className={`${btn} ml-auto`}
          disabled={!day.length}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(csv());
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            } catch {
              /* clipboard unavailable */
            }
          }}
        >
          {copied ? "Copied" : "Copy as CSV"}
        </button>
      </div>
      {!day.length ? (
        <div className="rounded-xl border border-border bg-surface p-6 text-sm text-text-muted">This month has no inputs yet, so it has no targets.</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-surface">
          <table className="w-full min-w-[900px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-text-muted">
                {["Date", "Total revenue", "Spend", "MER", "aMER", "New revenue", "Returning revenue", "CM", ...channels.map((c) => c.label)].map((h, i) => (
                  <th key={h + i} className={`px-2 py-2 ${i === 0 ? "text-left" : "text-right"}`}>
                    {h}
                  </th>
                ))}
              </tr>
              <tr className="border-b border-border bg-surface-raised text-xs font-semibold">
                <td className="px-2 py-1">Totals</td>
                <Num v={f(t.orderRevenue)} />
                <Num v={f(t.spend)} />
                <Num v={t.spend ? f(t.orderRevenue / t.spend, "ratio2") : "–"} />
                <Num v={t.spend ? f(t.newRevenue / t.spend, "ratio2") : "–"} />
                <Num v={f(t.newRevenue)} />
                <Num v={f(t.returningRevenue)} />
                <Num v={f(t.cm)} />
                {channels.map((c) => (
                  <Num key={c.key} v={f(t.spendByChannel[c.key] ?? 0)} />
                ))}
              </tr>
              <tr className="border-b border-border text-[11px] text-text-faint">
                <td className="px-2 py-1">% of total</td>
                <Num v={f(1, "percent1")} />
                <Num v={f(1, "percent1")} />
                <td />
                <td />
                <Num v={t.orderRevenue ? f(t.newRevenue / t.orderRevenue, "percent1") : "–"} />
                <Num v={t.orderRevenue ? f(t.returningRevenue / t.orderRevenue, "percent1") : "–"} />
                <Num v={t.orderRevenue ? f(t.cm / t.orderRevenue, "percent1") : "–"} />
                {channels.map((c) => (
                  <Num key={c.key} v={t.spend ? f((t.spendByChannel[c.key] ?? 0) / t.spend, "percent1") : "–"} />
                ))}
              </tr>
            </thead>
            <tbody>
              {day.map((r) => (
                <tr key={r.date} className="border-b border-border/40">
                  <td className="px-2 py-1 text-text-muted">
                    {r.date.slice(5)} <span className="text-xs text-text-faint">{WEEKDAYS[dayOfWeek(r.date)].toLowerCase()}</span>
                  </td>
                  <Num v={f(r.orderRevenue)} />
                  <Num v={f(r.spend)} />
                  <Num v={r.spend ? f(r.orderRevenue / r.spend, "ratio2") : "–"} />
                  <Num v={r.spend ? f(r.newRevenue / r.spend, "ratio2") : "–"} />
                  <Num v={f(r.newRevenue)} />
                  <Num v={f(r.returningRevenue)} />
                  <Num v={f(r.cm)} />
                  {channels.map((c) => (
                    <Num key={c.key} v={f(r.spendByChannel[c.key] ?? 0)} />
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const Num = ({ v }: { v: string }) => <td className="px-2 py-1 text-right tabular">{v}</td>;
