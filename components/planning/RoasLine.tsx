"use client";

import { useState } from "react";
import { endOfMonth } from "@/lib/dates";
import { actualPlatformRoas, roasCellValue, roasChannels, roasTarget, rowMethod, withRoas } from "@/lib/planning/roas";
import { CHANNEL_LABELS, type ChannelKey } from "@/lib/types";
import type { PlanCtx } from "./ctx";
import { btnPrimary, inputClass, MONTHS, NumField } from "./ui";

const round2 = (v: number) => Math.round(v * 100) / 100;

/** The ROAS line of the Details step: one row per channel, one value per month, Suggested (aMER / incrementality factor) or typed. */
export function RoasLine({ ctx }: { ctx: PlanCtx }) {
  const { months, settings, history, editInputs } = ctx;
  const [msg, setMsg] = useState<string | null>(null);
  const channels = roasChannels(settings, months);
  const factorOf = (k: ChannelKey) => settings.multipliers[k] ?? 1;

  const setMethod = (k: ChannelKey, method: "suggested" | "manual") => {
    for (const m of months) {
      if (m.locked || !m.inputs) continue;
      if (method === "suggested") editInputs(m.month, (i) => withRoas(i, k, null));
      else editInputs(m.month, (i) => withRoas(i, k, (() => { const v = roasTarget(i, k, factorOf(k)).value; return v === null ? null : round2(v); })()));
    }
    setMsg(`${CHANNEL_LABELS[k]} set to ${method === "suggested" ? "Suggested" : "Manual"} for the open months (locked months skipped). Press Save plan to keep it.`);
  };

  const actualize = () => {
    let n = 0;
    for (const m of months) {
      if (m.locked || !m.inputs) continue;
      const end = endOfMonth(m.month);
      if (end > history.lastData) continue;
      const facts = history.facts.filter((f) => f.date >= m.month && f.date <= end);
      for (const k of channels) {
        const a = actualPlatformRoas(facts, k);
        if (a === null) continue;
        editInputs(m.month, (i) => withRoas(i, k, round2(a)));
        n += 1;
      }
    }
    setMsg(n ? "Completed months now hold the ROAS each channel actually delivered (platform-reported, 7-day click). Press Save plan to keep it." : "No completed months with ad spend yet.");
  };

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-base font-semibold">ROAS targets</h3>
        <p className="max-w-3xl text-sm text-text-muted">
          Platform ROAS target per channel and month. Suggested = the month&apos;s aMER divided by the channel&apos;s incrementality factor (Store Settings), so a channel that only delivers 75% incrementally needs a higher platform ROAS to hit the same aMER. Type a number to set your own for a month. Home&apos;s channel tiles compare actual ROAS to these.
        </p>
      </div>
      <div className="overflow-x-auto rounded-xl border border-border bg-surface">
        <table className="w-full min-w-[1100px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-xs text-text-muted">
              <th className="px-3 py-2 text-left">Channel</th>
              <th className="px-2 py-2 text-right">Factor</th>
              <th className="px-2 py-2 text-left">Method</th>
              {MONTHS.map((mo) => (
                <th key={mo} className="px-1 py-2 text-right font-medium">
                  {mo}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {channels.map((k) => {
              const method = rowMethod(months, k);
              return (
                <tr key={k} className="border-b border-border/40">
                  <td className="px-3 py-1">{CHANNEL_LABELS[k]}</td>
                  <td className="px-2 py-1 text-right tabular text-text-muted">{factorOf(k)}</td>
                  <td className="px-2 py-1">
                    <select className={`${inputClass} w-28`} aria-label={`${CHANNEL_LABELS[k]} method`} value={method === "mixed" ? "mixed" : method} onChange={(e) => e.target.value !== "mixed" && setMethod(k, e.target.value as "suggested" | "manual")}>
                      <option value="suggested">Suggested</option>
                      <option value="manual">Manual</option>
                      {method === "mixed" && <option value="mixed">Mixed</option>}
                    </select>
                  </td>
                  {months.map((m) => {
                    const t = roasTarget(m.inputs, k, factorOf(k));
                    const shown = roasCellValue(t.value);
                    return (
                      <td key={m.month} className="px-1 py-1 text-right">
                        {m.inputs && shown !== null ? <NumField value={shown} decimals={2} className={`w-14 ${t.manual ? "border-accent!" : ""}`} disabled={m.locked} onCommit={(v) => editInputs(m.month, (i) => withRoas(i, k, v))} /> : <span className="text-text-faint" title={m.inputs ? "Set this month's aMER in the Overview tab first" : undefined}>–</span>}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button className={btnPrimary} onClick={actualize}>
          Actualize all YTD
        </button>
        <p className="text-xs text-text-faint">Typed values have an accent border. Returning channels have no target: aMER measures acquisition.</p>
      </div>
      {msg && <p className="text-xs text-text-muted">{msg}</p>}
    </div>
  );
}
