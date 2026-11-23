"use client";

import { useEffect, useMemo, useState } from "react";
import { addDays, todayLocal } from "@/lib/dates";
import { formatValue } from "@/lib/format";
import { channelSpendShares, haloSettingsOf } from "@/lib/planning/halo";
import { DEFAULT_NEW_CUSTOMER, type NewCustomerSettings } from "@/lib/planning/models";
import { adCreatedReturning, haloWarnings, otherMonth, type HaloWarningKind } from "@/lib/planning/other-channels";
import { fitPlanModel } from "@/lib/planning/plan-fit";
import type { OtherLine } from "@/lib/planning/types";
import { getRepository } from "@/lib/repository";
import { CHANNEL_LABELS, type ChannelKey } from "@/lib/types";
import type { PlanCtx } from "./ctx";
import { inputClass, MONTHS } from "./ui";

type FitSettings = Pick<NewCustomerSettings, "fitKind" | "beyondHistory" | "actualizeFrom" | "recentWeight">;

/** A number box that can be left empty (empty and zero mean different things on these lines). Commits on blur or Enter. */
function OptionalNum({ value, onCommit, disabled, placeholder, label }: { value: number | null; onCommit: (v: number | null) => void; disabled?: boolean; placeholder?: string; label: string }) {
  const shown = value === null ? "" : String(Math.round(value));
  return (
    <input
      key={shown}
      aria-label={label}
      type="text"
      inputMode="decimal"
      defaultValue={shown}
      placeholder={placeholder}
      disabled={disabled}
      className={`${inputClass} w-[5.5rem] text-right tabular`}
      onBlur={(e) => {
        const raw = e.currentTarget.value.replace(/[, £$€%]/g, "").trim();
        if (raw === "") {
          if (value !== null) onCommit(null);
          return;
        }
        const v = Number(raw);
        if (Number.isFinite(v) && v >= 0 && v !== value) onCommit(v);
        else e.currentTarget.value = shown;
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
    />
  );
}

const WARNING_TEXT: Record<HaloWarningKind, (months: string) => string> = {
  benchmark: () => "the factor is a benchmark or an assumption, not this client's own test.",
  old: () => "the factor was measured more than six months ago. Test it again.",
  range: (months) => `planned spend in ${months} is more than 30% away from the spend the factor was measured at. A factor only holds near that level.`,
};

/**
 * The "Other sales channels" line of the Details step: a revenue forecast per month for each channel besides the store's own site
 * (Amazon, TikTok Shop, retail), the part of it the plan's ads create (the halo), and the blended aMER. Nothing here changes the .com targets.
 */
export function OtherChannelsLine({ ctx }: { ctx: PlanCtx }) {
  const { months, settings, history, editInputs, client, plan, seasonality } = ctx;
  const channels = haloSettingsOf(settings).channels;
  const money = (v: number | null) => formatValue(v, "currency0", client.currency);

  // The saved New Customer model gives the spend curve, so a forecast that assumed another ad spend moves along the curve, not a straight line.
  const [model, setModel] = useState<FitSettings | null>(null);
  useEffect(() => {
    let cancel = false;
    getRepository()
      .getPlanModel(plan.id, "new_customer")
      .then((m) => !cancel && setModel({ ...DEFAULT_NEW_CUSTOMER, ...((m?.settings as Partial<NewCustomerSettings> | undefined) ?? {}) }))
      .catch(() => !cancel && setModel({ ...DEFAULT_NEW_CUSTOMER }));
    return () => {
      cancel = true;
    };
  }, [plan.id]);
  const curve = useMemo(() => (model && history.facts.length ? (fitPlanModel(history.facts, settings, seasonality.dow, model)?.curve ?? null) : null), [model, history.facts, settings, seasonality.dow]);
  const recent = useMemo(() => (history.lastData ? history.facts.filter((f) => f.date > addDays(history.lastData, -90) && f.date <= history.lastData) : []), [history.facts, history.lastData]);

  if (!channels.length) {
    return (
      <div className="space-y-2">
        <h3 className="text-base font-semibold">Other sales channels</h3>
        <p className="max-w-3xl text-sm text-text-muted">This client has no other sales channels yet. Add Amazon, TikTok Shop or retail in Store Settings, Edit, &quot;Other sales channels and halo&quot;. They then get a forecast line here, and the plan can count what the ads create on them.</p>
      </div>
    );
  }

  const data = months.map((m) => (m.inputs ? otherMonth(m.month, m.inputs, settings, curve) : null));
  const returning = months.map((m) => (m.inputs ? adCreatedReturning(m.inputs, settings, recent) : null));
  const retentionHalo = returning.some((r) => (r?.haloRevenue ?? 0) > 0);
  const setLine = (month: string, key: string, patch: Partial<OtherLine>) => editInputs(month, (i) => ({ ...i, other: { ...(i.other ?? {}), [key]: { ...(i.other?.[key] ?? {}), ...patch } } }));

  // One sentence per factor and problem, with the months it applies to.
  const today = todayLocal();
  const warnings = new Map<string, { channel: ChannelKey; salesChannel: string; kind: HaloWarningKind; months: string[] }>();
  months.forEach((m, mi) => {
    if (!m.inputs) return;
    const shares = channelSpendShares(m.inputs);
    const spend = Object.fromEntries(Object.entries(shares).map(([k, s]) => [k, (s ?? 0) * m.inputs!.spend])) as Partial<Record<ChannelKey, number>>;
    for (const w of haloWarnings(settings, spend, today)) {
      const id = `${w.channel}|${w.salesChannel}|${w.kind}`;
      const have = warnings.get(id) ?? { ...w, months: [] };
      have.months.push(MONTHS[mi]);
      warnings.set(id, have);
    }
  });
  const labelOf = (key: string) => channels.find((c) => c.key === key)?.label ?? key;
  const anyModelled = data.some((d) => d?.modelled);
  const anyCapped = data.some((d) => d?.lines.some((l) => l.capped));

  const th = "px-1 py-2 text-right font-medium";
  const td = "px-1 py-1 text-right tabular";
  const rowLabel = "px-3 py-1 text-left";
  const dash = <span className="text-text-faint">–</span>;

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-base font-semibold">Other sales channels</h3>
        <p className="max-w-3xl text-sm text-text-muted">
          A revenue forecast per month for each channel besides the store&apos;s own site, for example the finance team&apos;s number. &quot;Ad spend it assumed&quot; is the acquisition spend that forecast was built on: leave it empty when it assumed this plan&apos;s
          spend, type 0 when it assumed no ads. The forecast then moves by what the ads create on the difference. Nothing here changes the .com targets.
        </p>
      </div>
      <div className="overflow-x-auto rounded-xl border border-border bg-surface">
        <table className="w-full min-w-[1180px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-xs text-text-muted">
              <th className="px-3 py-2 text-left">Line</th>
              {MONTHS.map((mo) => (
                <th key={mo} className={th}>
                  {mo}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {channels.map((c, ci) => (
              <ChannelRows key={c.key}>
                <tr className="border-b border-border/40 bg-bg/40">
                  <td className={`${rowLabel} font-medium`}>{c.label}: forecast you type</td>
                  {months.map((m, mi) => {
                    const l = data[mi]?.lines[ci];
                    return (
                      <td key={m.month} className={td}>
                        {l ? <OptionalNum label={`${c.label} forecast ${MONTHS[mi]}`} value={l.typed} placeholder={l.frame !== null ? String(Math.round(l.frame)) : ""} disabled={m.locked} onCommit={(v) => setLine(m.month, c.key, { revenue: v })} /> : dash}
                      </td>
                    );
                  })}
                </tr>
                <tr className="border-b border-border/40">
                  <td className={`${rowLabel} text-text-muted`}>Ad spend it assumed</td>
                  {months.map((m, mi) => {
                    const l = data[mi]?.lines[ci];
                    return (
                      <td key={m.month} className={td}>
                        {l ? <OptionalNum label={`${c.label} assumed ad spend ${MONTHS[mi]}`} value={l.assumedSpend} placeholder="same" disabled={m.locked} onCommit={(v) => setLine(m.month, c.key, { assumedSpend: v })} /> : dash}
                      </td>
                    );
                  })}
                </tr>
                <tr className="border-b border-border/40">
                  <td className={`${rowLabel} text-text-muted`}>Forecast</td>
                  {months.map((m, mi) => {
                    const l = data[mi]?.lines[ci];
                    return (
                      <td key={m.month} className={`${td} font-medium`}>
                        {l && l.forecast !== null ? money(l.forecast) : dash}
                      </td>
                    );
                  })}
                </tr>
                <tr className="border-b border-border/40">
                  <td className={`${rowLabel} text-text-muted`}>Of which created by ads</td>
                  {months.map((m, mi) => {
                    const l = data[mi]?.lines[ci];
                    return (
                      <td
                        key={m.month}
                        className={`${td} ${l?.capped ? "text-bad" : ""}`}
                        title={l?.capped ? "The factor says the ads created more than this channel's whole forecast, so the credit is cut to fit. Lower the halo factor in Store Settings." : l && l.halo > 0 && l.forecast === null ? "No forecast is typed for this channel, so nothing caps this number." : undefined}
                      >
                        {l && l.halo > 0 ? money(l.created) : dash}
                      </td>
                    );
                  })}
                </tr>
                {c.kind === "retail" && (
                  <tr className="border-b border-border">
                    <td className={`${rowLabel} text-text-muted`}>Units per store per week the ads must create</td>
                    {months.map((m, mi) => {
                      const l = data[mi]?.lines[ci];
                      return (
                        <td key={m.month} className={td} title={l && l.doors > 0 ? `${l.doors.toLocaleString()} stores on shelf` : undefined}>
                          {l && l.unitsPerStoreWeek !== null && l.halo > 0 ? l.unitsPerStoreWeek.toFixed(2) : dash}
                        </td>
                      );
                    })}
                  </tr>
                )}
              </ChannelRows>
            ))}
            <tr className="border-b border-border/40">
              <td className={rowLabel}>aMER (.com, the daily number)</td>
              {months.map((m) => (
                <td key={m.month} className={td}>
                  {m.inputs && m.inputs.amer > 0 ? m.inputs.amer.toFixed(2) : dash}
                </td>
              ))}
            </tr>
            <tr className="border-b border-border/40">
              <td className={rowLabel}>Blended aMER (modelled)</td>
              {months.map((m, mi) => (
                <td key={m.month} className={`${td} font-medium ${data[mi]?.lines.some((l) => l.capped) ? "text-bad" : ""}`} title={data[mi]?.lines.some((l) => l.capped) ? "Uses the full halo factor, which is larger than a channel's forecast allows. Lower the factor in Store Settings." : undefined}>
                  {data[mi]?.modelled ? data[mi]!.blendedAmer.toFixed(2) : dash}
                </td>
              ))}
            </tr>
            <tr className={retentionHalo ? "border-b border-border/40" : ""}>
              <td className={rowLabel}>Returning revenue created by retention ads</td>
              {months.map((m, mi) => (
                <td key={m.month} className={td}>
                  {returning[mi]?.revenue ? money(returning[mi]!.revenue) : dash}
                </td>
              ))}
            </tr>
            {retentionHalo && (
              <tr>
                <td className={rowLabel}>Created by retention ads on other channels</td>
                {months.map((m, mi) => (
                  <td key={m.month} className={td} title="Kept out of the blended aMER, which measures acquisition.">
                    {returning[mi]?.haloRevenue ? money(returning[mi]!.haloRevenue) : dash}
                  </td>
                ))}
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="max-w-3xl space-y-1 text-xs text-text-faint">
        <p>
          The part created by ads is a transfer of credit, never extra revenue: it is counted once, inside the channel&apos;s forecast. {anyModelled ? "It comes from the halo factors in Store Settings, so it is modelled, not measured here." : "No halo factor is typed in Store Settings yet, so nothing is credited to the ads."}
        </p>
        <p>Returning revenue created by retention ads = planned retention spend × that channel&apos;s platform ROAS over the last 90 days × its factor. It is already inside the Returning model&apos;s forecast at the past level of spend; the line shows how much of it depends on the ads.</p>
        {anyCapped && (
          <p className="text-bad">
            In red: the factor says the ads created more than a channel&apos;s whole forecast, so the credit on that line is cut to fit. The blended aMER and the ROAS targets still use the full factor until you lower it in Store Settings.
          </p>
        )}
        {[...warnings.values()].map((w) => (
          <p key={`${w.channel}|${w.salesChannel}|${w.kind}`} className="text-text-muted">
            {CHANNEL_LABELS[w.channel]} on {labelOf(w.salesChannel)}: {WARNING_TEXT[w.kind](w.months.join(", "))}
          </p>
        ))}
      </div>
    </div>
  );
}

/** Groups a channel's rows without adding a wrapper element to the table. */
function ChannelRows({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
