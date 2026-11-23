"use client";

import { useState } from "react";
import { cellValue, haloGridChannels } from "@/lib/planning/halo";
import { getRepository } from "@/lib/repository";
import { CHANNEL_LABELS, type ChannelKey, type HaloCell, type HaloSettings as Halo, type HaloSource, type OtherChannel, type RetailerRow } from "@/lib/types";
import { ChannelImport } from "./ChannelImport";
import { Check, Field, inputCls, NumberInput } from "./ui";

const SOURCES: { id: HaloSource; label: string }[] = [
  { id: "own_test", label: "Own test" },
  { id: "benchmark", label: "Benchmark" },
  { id: "assumption", label: "Assumption" },
];

const PRESETS: { label: string; channel: Omit<OtherChannel, "key"> }[] = [
  { label: "Amazon", channel: { label: "Amazon", kind: "marketplace", costPct: 0, aov: 0 } },
  { label: "TikTok Shop", channel: { label: "TikTok Shop", kind: "marketplace", costPct: 0, aov: 0 } },
  { label: "Retail", channel: { label: "Retail", kind: "retail", costPct: 0, aov: 0, netPct: 50, retailers: [] } },
  { label: "Other", channel: { label: "New channel", kind: "marketplace", costPct: 0, aov: 0 } },
];

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "channel";
const round2 = (v: number) => Math.round(v * 100) / 100;
const smallBtn = "rounded-lg border border-border px-3 py-1.5 text-xs text-text-muted hover:text-text";

/**
 * Store Settings > Edit > "Other sales channels and halo": the client's sales channels besides its own site, and how much revenue each
 * ad channel creates on them (the halo factors). Factors are typed from tests run elsewhere; nothing here estimates one.
 */
export function HaloSettings({
  value,
  multipliers,
  onChange,
  clientId,
  currency,
  shopifyChannels,
}: {
  value: Halo;
  multipliers: Partial<Record<ChannelKey, number>>;
  onChange: (next: Halo) => void;
  clientId: string;
  currency: string;
  /** Shopify sales channels found on the store's orders that are not counted as the own site. */
  shopifyChannels: string[];
}) {
  const [open, setOpen] = useState<string | null>(null);
  // Channels with a factor, plus any channel that still carries a halo: a cell keeps working after its factor is deleted, so it stays visible.
  const adChannels = haloGridChannels(multipliers, value);

  const setChannel = (key: string, patch: Partial<OtherChannel>) => onChange({ ...value, channels: value.channels.map((c) => (c.key === key ? { ...c, ...patch } : c)) });
  const addChannel = (preset: Omit<OtherChannel, "key">) => {
    let key = slug(preset.label);
    for (let n = 2; value.channels.some((c) => c.key === key); n += 1) key = `${slug(preset.label)}_${n}`;
    onChange({ ...value, channels: [...value.channels, { ...preset, key }] });
  };
  const removeChannel = (key: string) => {
    const cells: Halo["cells"] = {};
    for (const [k, row] of Object.entries(value.cells) as [ChannelKey, Record<string, HaloCell>][]) {
      const rest = Object.fromEntries(Object.entries(row ?? {}).filter(([c]) => c !== key));
      if (Object.keys(rest).length) cells[k] = rest;
    }
    onChange({ channels: value.channels.filter((c) => c.key !== key), cells });
  };
  const cellOf = (k: ChannelKey, key: string): HaloCell => value.cells[k]?.[key] ?? { value: 0, source: "assumption" };
  const setCell = (k: ChannelKey, key: string, patch: Partial<HaloCell>) => onChange({ ...value, cells: { ...value.cells, [k]: { ...(value.cells[k] ?? {}), [key]: { ...cellOf(k, key), ...patch } } } });
  const setRetailers = (key: string, rows: RetailerRow[]) => setChannel(key, { retailers: rows });

  return (
    <div className="space-y-5">
      <p className="text-xs text-text-muted">
        Ads also create sales on channels other than the store&apos;s own site. List those channels, then type how much each ad channel creates there. The plan then sets its budget and ROAS targets on the whole business. With nothing typed here every number stays as
        it is.
      </p>

      <div className="space-y-3">
        <h4 className="text-sm font-semibold">Sales channels</h4>
        {value.channels.length === 0 && <p className="text-xs text-text-faint">None yet. Add the channels this client sells on besides its own site.</p>}
        {value.channels.map((c) => (
          <div key={c.key} className="space-y-3 rounded-xl border border-border px-4 py-3">
            <div className="grid gap-3 md:grid-cols-4">
              <Field label="Name">
                <input className={inputCls} value={c.label} onChange={(e) => setChannel(c.key, { label: e.target.value })} />
              </Field>
              <Field label="Kind">
                <select aria-label={`${c.label} kind`} className={inputCls} value={c.kind} onChange={(e) => setChannel(c.key, { kind: e.target.value as OtherChannel["kind"] })}>
                  <option value="marketplace">Marketplace</option>
                  <option value="retail">Retail (stores)</option>
                </select>
              </Field>
              <Field label="Variable costs" hint="% of the channel's net revenue: product, fees, fulfilment, trade spend">
                <NumberInput label={`${c.label} variable costs`} value={c.costPct} suffix="%" onChange={(v) => setChannel(c.key, { costPct: v })} />
              </Field>
              <Field label="Average order value">
                <NumberInput label={`${c.label} average order value`} value={c.aov} step={0.01} onChange={(v) => setChannel(c.key, { aov: v })} />
              </Field>
            </div>
            <div className="grid gap-3 md:grid-cols-4">
              <Field label="60-day repeat" hint="Revenue within 60 days as a multiple of the first order. 1 = none counted">
                <NumberInput label={`${c.label} 60-day repeat`} value={c.ltv60 ?? 1} step={0.05} onChange={(v) => setChannel(c.key, { ltv60: v })} />
              </Field>
              <Field label="90-day repeat">
                <NumberInput label={`${c.label} 90-day repeat`} value={c.ltv90 ?? 1} step={0.05} onChange={(v) => setChannel(c.key, { ltv90: v })} />
              </Field>
              <Field label="1-year repeat">
                <NumberInput label={`${c.label} 1-year repeat`} value={c.ltv365 ?? 1} step={0.05} onChange={(v) => setChannel(c.key, { ltv365: v })} />
              </Field>
              {c.kind === "retail" ? (
                <Field label="Net share of shelf price" hint="What the brand keeps of each dollar sold in store">
                  <NumberInput label={`${c.label} net share of shelf price`} value={c.netPct ?? 0} suffix="%" onChange={(v) => setChannel(c.key, { netPct: v })} />
                </Field>
              ) : (
                <div />
              )}
            </div>
            {c.kind === "retail" && <Retailers channel={c} onChange={(rows) => setRetailers(c.key, rows)} />}
            <ChannelImport clientId={clientId} channel={c} currency={currency} />
            {shopifyChannels.length > 0 && <ShopifyFeed clientId={clientId} channel={c} options={shopifyChannels} onChange={(list) => setChannel(c.key, { shopifyChannels: list })} />}
            <div className="flex justify-end">
              <button type="button" className="text-xs font-semibold text-bad hover:underline" onClick={() => removeChannel(c.key)}>
                Delete {c.label}
              </button>
            </div>
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-text-muted">Add:</span>
          {PRESETS.map((p) => (
            <button key={p.label} type="button" className={smallBtn} onClick={() => addChannel(p.channel)}>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {value.channels.length > 0 && (
        <div className="space-y-3">
          <h4 className="text-sm font-semibold">Halo factors</h4>
          <p className="text-xs text-text-muted">
            For each ad channel: the revenue it creates on that sales channel per $1 of revenue the ad platform reports. It adds to the channel&apos;s factor above. Example: a factor of 1.2 with an Amazon halo of 0.2 makes a total of 1.4.
          </p>
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-text-muted">
                  <th className="px-3 py-2 text-left font-medium">Ad channel</th>
                  <th className="px-2 py-2 text-right font-medium">Own site</th>
                  {value.channels.map((c) => (
                    <th key={c.key} className="px-2 py-2 text-left font-medium">
                      {c.label}
                    </th>
                  ))}
                  <th className="px-2 py-2 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {adChannels.map((k) => {
                  const base = multipliers[k] ?? 1;
                  const total = base + value.channels.reduce((a, c) => a + cellValue(value.cells[k]?.[c.key], c), 0);
                  return (
                    <tr key={k} className="border-b border-border/40 align-top">
                      <td className="px-3 py-2">{CHANNEL_LABELS[k]}</td>
                      <td className="px-2 py-2 text-right tabular text-text-muted" title={multipliers[k] === undefined ? "No factor is saved for this channel, so it counts as 1. Add one under Incrementality, or clear the halo." : undefined}>
                        {round2(base)}
                        {multipliers[k] === undefined ? "*" : ""}
                      </td>
                      {value.channels.map((c) => {
                        const id = `${k}|${c.key}`;
                        const cell = cellOf(k, c.key);
                        return (
                          <td key={c.key} className="px-2 py-2">
                            <div className="flex items-center gap-2">
                              <div className="w-20">
                                <NumberInput label={`${CHANNEL_LABELS[k]} halo on ${c.label}`} step={0.05} value={cell.value} onChange={(v) => setCell(k, c.key, { value: v })} />
                              </div>
                              <button type="button" className="text-xs text-accent underline" aria-expanded={open === id} onClick={() => setOpen(open === id ? null : id)}>
                                {open === id ? "Hide" : cell.value > 0 ? (SOURCES.find((s) => s.id === cell.source)?.label ?? "Details") : "Details"}
                              </button>
                            </div>
                            {open === id && (
                              <div className="mt-2 w-56 space-y-2 rounded-lg border border-border p-2">
                                <Field label="Where it comes from">
                                  <select aria-label={`${CHANNEL_LABELS[k]} on ${c.label} source`} className={inputCls} value={cell.source} onChange={(e) => setCell(k, c.key, { source: e.target.value as HaloSource })}>
                                    {SOURCES.map((s) => (
                                      <option key={s.id} value={s.id}>
                                        {s.label}
                                      </option>
                                    ))}
                                  </select>
                                </Field>
                                <Field label="Measured on">
                                  <input type="date" className={inputCls} value={cell.measuredOn ?? ""} onChange={(e) => setCell(k, c.key, { measuredOn: e.target.value || undefined })} />
                                </Field>
                                <Field label="Monthly spend when measured" hint="The factor holds near this spend level">
                                  <NumberInput label="Monthly spend when measured" value={cell.measuredSpend ?? 0} step={1000} onChange={(v) => setCell(k, c.key, { measuredSpend: v || undefined })} />
                                </Field>
                                <Field label="Note">
                                  <input className={inputCls} value={cell.note ?? ""} onChange={(e) => setCell(k, c.key, { note: e.target.value || undefined })} />
                                </Field>
                                {c.kind === "retail" && <Check checked={Boolean(cell.onShelf)} onChange={(v) => setCell(k, c.key, { onShelf: v })} label="Measured on shelf sales" hint="Converted to the brand's net revenue with the net share above" />}
                              </div>
                            )}
                          </td>
                        );
                      })}
                      <td className="px-2 py-2 text-right tabular font-medium">{round2(total)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-text-faint">
            A factor is measured at one spend level, in one season, with the other channel in stock and priced as it was. It holds near that point: test again when spend moves by about a third, when the season changes, or when a new place to buy opens. Second-round
            effects (a halo of a halo) are not counted.
          </p>
        </div>
      )}
    </div>
  );
}

/** For a channel whose orders are already synced into Shopify under another sales channel: pick those channels and pull their orders in as the channel's sales. */
function ShopifyFeed({ clientId, channel, options, onChange }: { clientId: string; channel: OtherChannel; options: string[]; onChange: (list: string[]) => void }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  // Only channels still offered here are pulled: one that now counts as the own site would be counted twice.
  const picked = (channel.shopifyChannels ?? []).filter((p) => options.some((o) => o.toLowerCase() === p.toLowerCase()));
  const pull = async () => {
    setBusy(true);
    setNote(null);
    try {
      const days = await getRepository().pullChannelSalesFromOrders(clientId, channel.key, picked, "2010-01-01", new Date().toISOString().slice(0, 10));
      setNote(days === null ? "The database is not ready for this yet (migration 0021)." : days === 0 ? "No orders found on those Shopify channels." : `Pulled ${days} day${days === 1 ? "" : "s"} of orders into ${channel.label}.`);
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Could not pull the orders.");
    }
    setBusy(false);
  };
  return (
    <div className="space-y-2 rounded-lg border border-border/60 p-3">
      <div className="text-xs font-semibold text-text">Or use orders already synced from Shopify</div>
      <p className="text-xs text-text-muted">If {channel.label} orders arrive in Shopify under their own sales channel, tick it. Their revenue and orders are then pulled in by day. Shopify knows nothing about ad spend on the channel.</p>
      <div className="flex flex-wrap gap-x-5 gap-y-1">
        {options.map((o) => (
          <Check key={o} checked={picked.some((p) => p.toLowerCase() === o.toLowerCase())} onChange={(v) => onChange(v ? [...picked, o] : picked.filter((p) => p.toLowerCase() !== o.toLowerCase()))} label={o} />
        ))}
      </div>
      <button type="button" disabled={busy || picked.length === 0} onClick={pull} className={`${smallBtn} disabled:opacity-50`}>
        {busy ? "Pulling…" : "Pull their orders now"}
      </button>
      {note && <p className="text-xs text-text-muted">{note}</p>}
    </div>
  );
}

/** A retail channel's simple frame: doors x units per store per week x shelf price, per retailer. An expansion is a new row. */
function Retailers({ channel, onChange }: { channel: OtherChannel; onChange: (rows: RetailerRow[]) => void }) {
  const rows = channel.retailers ?? [];
  const set = (i: number, patch: Partial<RetailerRow>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const cellCls = "px-1 py-1";
  return (
    <div className="space-y-2">
      <div className="text-xs text-text-muted">Retailers. Monthly sales in store = doors × units per store per week × weeks × shelf price. The first order is counted once, in the launch month.</div>
      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-xs">
            <thead>
              <tr className="text-left text-text-muted">
                <th className={cellCls}>Retailer</th>
                <th className={cellCls}>Launch month</th>
                <th className={cellCls}>Doors</th>
                <th className={cellCls}>Units per store per week</th>
                <th className={cellCls}>Shelf price</th>
                <th className={cellCls}>First order (units)</th>
                <th className={cellCls} />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td className={cellCls}>
                    <input aria-label="Retailer" className={inputCls} value={r.retailer} onChange={(e) => set(i, { retailer: e.target.value })} />
                  </td>
                  <td className={cellCls}>
                    <input aria-label="Launch month" type="month" className={inputCls} value={r.launchMonth} onChange={(e) => set(i, { launchMonth: e.target.value })} />
                  </td>
                  <td className={cellCls}>
                    <NumberInput label="Doors" value={r.doors} onChange={(v) => set(i, { doors: v })} />
                  </td>
                  <td className={cellCls}>
                    <NumberInput label="Units per store per week" step={0.1} value={r.unitsPerStoreWeek} onChange={(v) => set(i, { unitsPerStoreWeek: v })} />
                  </td>
                  <td className={cellCls}>
                    <NumberInput label="Shelf price" step={0.01} value={r.shelfPrice} onChange={(v) => set(i, { shelfPrice: v })} />
                  </td>
                  <td className={cellCls}>
                    <NumberInput label="First order units" value={r.pipelineUnits ?? 0} onChange={(v) => set(i, { pipelineUnits: v || undefined })} />
                  </td>
                  <td className={cellCls}>
                    <button type="button" className="text-xs font-semibold text-bad hover:underline" aria-label={`Delete ${r.retailer || "retailer"}`} onClick={() => onChange(rows.filter((_, j) => j !== i))}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <button type="button" className={smallBtn} onClick={() => onChange([...rows, { retailer: "", launchMonth: new Date().toISOString().slice(0, 7), doors: 0, unitsPerStoreWeek: 0, shelfPrice: 0 }])}>
        Add retailer
      </button>
    </div>
  );
}
