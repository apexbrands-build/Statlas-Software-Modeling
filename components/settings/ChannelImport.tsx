"use client";

import { useMemo, useState } from "react";
import { formatValue } from "@/lib/format";
import { splitLine, type DateFormat, type NumberFormat } from "@/lib/omni/import";
import { detectKind, fileKinds, normHeader, parseChannelFile, type FileImport } from "@/lib/omni/import-kinds";
import { readMap, writeMap, type ColumnMap } from "@/lib/omni/import-map";
import { CATALOG, metricInfo, platformOf, type Platform } from "@/lib/omni/metrics";
import { getRepository } from "@/lib/repository";
import type { Currency, OtherChannel } from "@/lib/types";
import { inputCls } from "./ui";

const FORMATS: { id: DateFormat; label: string }[] = [
  { id: "ymd", label: "2027-03-04 (year first)" },
  { id: "mdy", label: "03/04/2027 = March 4 (month first)" },
  { id: "dmy", label: "04/03/2027 = March 4 (day first)" },
];

const BUY_BOX = "buy_box_pct";

/** What a column can be for this platform: the date, the four core numbers, each stored metric, or nothing. */
function targetOptions(platform: Platform, retail: boolean): { value: string; label: string }[] {
  const c = CATALOG[platform];
  return [
    { value: "date", label: "Date" },
    ...(retail ? [{ value: "retailer", label: "Retailer" }] : []),
    { value: "revenue", label: c.coreLabels.revenue },
    { value: "orders", label: c.coreLabels.orders },
    { value: "units", label: c.coreLabels.units },
    { value: "adSpend", label: c.coreLabels.adSpend },
    ...(platform === "amazon" ? [{ value: BUY_BOX, label: "Buy Box %" }] : []),
    ...c.stored.filter((m) => m.key !== "buy_box_views").map((m) => ({ value: m.key, label: `${m.group}: ${m.label}` })),
  ];
}

const headerOf = (text: string) => {
  const first = text.replace(/^﻿/, "").split(/\r\n|\n|\r/)[0] ?? "";
  const count = (d: string) => splitLine(first, d).length;
  return splitLine(first, [",", ";", "\t"].reduce((best, d) => (count(d) > count(best) ? d : best), ","));
};

/**
 * Loads one channel's numbers from a file: the platform's own export as it is (recognised by its columns), or any file with one row
 * per day. A file changes only the numbers it holds; the rest of each day is kept.
 */
export function ChannelImport({ clientId, channel, currency }: { clientId: string; channel: OtherChannel; currency: string }) {
  // The dialog passes the store currency as text; anything the formatter does not know is shown in dollars.
  const cur: Currency = currency === "GBP" || currency === "EUR" ? currency : "USD";
  const platform = platformOf(channel);
  const kinds = useMemo(() => fileKinds(platform), [platform]);
  const options = useMemo(() => targetOptions(platform, channel.kind === "retail"), [platform, channel.kind]);
  const [format, setFormat] = useState<DateFormat>("ymd");
  const [numbers, setNumbers] = useState<NumberFormat>("us");
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [kind, setKind] = useState<string>("generic");
  const [mapping, setMapping] = useState<ColumnMap>({});
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);

  const parsed: FileImport | null = useMemo(
    () => (file ? parseChannelFile(file.text, channel.key, { platform, kind, dateFormat: format, numberFormat: numbers, mapping }) : null),
    [file, channel.key, platform, kind, format, numbers, mapping],
  );
  const days = parsed ? new Set(parsed.rows.map((r) => r.date)).size : 0;

  const pickKind = (id: string) => {
    setKind(id);
    setMapping(readMap(clientId, channel.key, id));
  };
  const mapColumn = (header: string, target: string) => {
    const next = { ...mapping, [normHeader(header)]: target === "" ? null : target };
    setMapping(next);
    writeMap(clientId, channel.key, kind, next);
  };
  const show = (key: string, v: number) => {
    const info = metricInfo(platform, key);
    const unit = info?.unit ?? "number";
    return `${info?.label ?? key} ${unit === "currency" || unit === "price" ? formatValue(v, "currency0", cur) : formatValue(v, "number", cur)}`;
  };

  const save = async () => {
    if (!parsed || parsed.rows.length === 0) return;
    setBusy(true);
    setNote(null);
    try {
      await getRepository().mergeChannelSales(clientId, channel.key, parsed.rows);
      setNote({ tone: "ok", text: `Saved ${days} day${days === 1 ? "" : "s"} of ${channel.label} numbers (${parsed.from} to ${parsed.to}). They show on Home under View.` });
      setFile(null);
    } catch (e) {
      setNote({ tone: "bad", text: e instanceof Error ? e.message : "Could not save the file." });
    }
    setBusy(false);
  };

  const totals = parsed ? Object.entries(parsed.totals) : [];
  return (
    <div className="space-y-2 rounded-lg border border-border/60 p-3">
      <div className="text-xs font-semibold text-text">Load {channel.label} numbers from a file</div>
      <p className="text-xs text-text-muted">
        {platform === "amazon"
          ? "Amazon's own exports as they are (Business Reports: Sales and Traffic by date; Amazon Ads: a Sponsored Products, Brands or Display report by day), or any file with one row per day."
          : platform === "tiktok_shop"
            ? "TikTok Shop's own exports (shop analytics, shop ads, affiliates) or any file with one row per day. Save an Excel file as CSV first."
            : "A CSV with one row per day: a date column and a revenue column, plus orders, units, ad spend and retailer when you have them."}{" "}
        A file changes only the numbers it holds; the rest of each day is kept. Saving here is immediate: it does not wait for Submit.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-xs text-text-muted">
          Dates are written as
          <select aria-label={`${channel.label} date format`} className={`${inputCls} w-auto`} value={format} onChange={(e) => setFormat(e.target.value as DateFormat)}>
            {FORMATS.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-xs text-text-muted">
          Numbers are written as
          <select aria-label={`${channel.label} number format`} className={`${inputCls} w-auto`} value={numbers} onChange={(e) => setNumbers(e.target.value as NumberFormat)}>
            <option value="us">1,234.56 (comma for thousands)</option>
            <option value="eu">1.234,56 (dot for thousands)</option>
          </select>
        </label>
        <input
          aria-label={`${channel.label} sales file`}
          type="file"
          accept=".csv,.tsv,.txt,text/csv,text/plain"
          className="text-xs text-text-muted file:mr-3 file:rounded-lg file:border file:border-border file:bg-surface file:px-3 file:py-1.5 file:text-xs file:text-text"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            setNote(null);
            if (!f) return setFile(null);
            const text = await f.text();
            // The kind of file is read from its columns; a mapping made by hand for that kind in this browser is applied again.
            const detected = detectKind(headerOf(text), platform);
            setKind(detected);
            setMapping(readMap(clientId, channel.key, detected));
            setFile({ name: f.name, text });
          }}
        />
      </div>
      {parsed && (
        <div className="space-y-2 text-xs">
          {kinds.length > 1 && (
            <label className="flex flex-wrap items-center gap-2 text-text-muted">
              This file is
              <select aria-label={`${channel.label} kind of file`} className={`${inputCls} w-auto`} value={parsed.kind} onChange={(e) => pickKind(e.target.value)}>
                {kinds.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          {(parsed.kind === "amazon_ads_sb" || parsed.kind === "amazon_ads_sd") && (
            <p className="text-text">Sponsored Brands and Sponsored Display files have the same columns, so the app cannot tell them apart. Check that the kind above is the right one before saving.</p>
          )}
          {parsed.columns.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-border/60">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="text-left text-text-faint">
                    <th className="px-2 py-1 font-normal">Column in the file</th>
                    <th className="px-2 py-1 font-normal">Read as</th>
                  </tr>
                </thead>
                <tbody>
                  {parsed.columns.map((c) => (
                    <tr key={c.header} className="border-t border-border/40">
                      <td className="px-2 py-1 text-text">{c.header}</td>
                      <td className="px-2 py-1">
                        <select aria-label={`${channel.label} column ${c.header}`} className={`${inputCls} w-auto`} value={c.target ?? ""} onChange={(e) => mapColumn(c.header, e.target.value)}>
                          <option value="">Not used</option>
                          {options.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {parsed.rows.length > 0 ? (
            <p className="text-text">
              {file?.name}: {days} day{days === 1 ? "" : "s"} from {parsed.from} to {parsed.to}.{" "}
              {totals
                .slice(0, 8)
                .map(([k, v]) => show(k, v))
                .join(" · ")}
              {totals.length > 8 ? ` · and ${totals.length - 8} more` : ""}.
            </p>
          ) : (
            <p className="text-bad">Nothing in {file?.name} could be read.</p>
          )}
          {parsed.errors.length > 0 && (
            <div className="rounded-lg border border-bad/40 p-2 text-bad">
              <div className="font-medium">
                {parsed.errors.length} line{parsed.errors.length === 1 ? "" : "s"} left out:
              </div>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                {parsed.errors.slice(0, 8).map((er) => (
                  <li key={`${er.line}-${er.message}`}>
                    Line {er.line}: {er.message}
                  </li>
                ))}
              </ul>
              {parsed.errors.length > 8 && <div className="mt-1">and {parsed.errors.length - 8} more.</div>}
              {parsed.errors.some((er) => er.message.startsWith("Could not read the date")) && <div className="mt-1 text-text-muted">If the dates look right, pick the other date format above.</div>}
              {parsed.errors.some((er) => er.message.includes("how numbers are written")) && <div className="mt-1 text-text-muted">If the numbers look right, pick the other number format above.</div>}
            </div>
          )}
          <button type="button" disabled={busy || parsed.rows.length === 0} onClick={save} className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-black disabled:opacity-50">
            {busy ? "Saving…" : `Save ${days} day${days === 1 ? "" : "s"}`}
          </button>
        </div>
      )}
      {note && <p className={`text-xs ${note.tone === "ok" ? "text-good" : "text-bad"}`}>{note.text}</p>}
    </div>
  );
}
