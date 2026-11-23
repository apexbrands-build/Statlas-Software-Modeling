"use client";

import { useState } from "react";
import { formatValue } from "@/lib/format";
import { parseChannelCsv, type DateFormat, type ImportResult } from "@/lib/omni/import";
import { getRepository } from "@/lib/repository";
import type { Currency, OtherChannel } from "@/lib/types";
import { inputCls } from "./ui";

const FORMATS: { id: DateFormat; label: string }[] = [
  { id: "ymd", label: "2027-03-04 (year first)" },
  { id: "mdy", label: "03/04/2027 = March 4 (month first)" },
  { id: "dmy", label: "04/03/2027 = March 4 (day first)" },
];

/**
 * Loads one channel's daily sales from a file (a CSV export of a spreadsheet or of the channel's own reports).
 * The days in the file replace what was loaded before for those days; other days are left as they are.
 */
export function ChannelImport({ clientId, channel, currency }: { clientId: string; channel: OtherChannel; currency: string }) {
  // The dialog passes the store currency as text; anything the formatter does not know is shown in dollars.
  const cur: Currency = currency === "GBP" || currency === "EUR" ? currency : "USD";
  const [format, setFormat] = useState<DateFormat>("ymd");
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const parsed: ImportResult | null = file ? parseChannelCsv(file.text, channel.key, format) : null;
  const money = (v: number) => formatValue(v, "currency0", cur);
  const days = parsed ? new Set(parsed.rows.map((r) => r.date)).size : 0;

  const save = async () => {
    if (!parsed || parsed.rows.length === 0) return;
    setBusy(true);
    setNote(null);
    try {
      await getRepository().saveChannelSales(clientId, channel.key, parsed.rows);
      setNote({ tone: "ok", text: `Saved ${days} day${days === 1 ? "" : "s"} of ${channel.label} sales (${parsed.from} to ${parsed.to}). They show on Home under View.` });
      setFile(null);
    } catch (e) {
      setNote({ tone: "bad", text: e instanceof Error ? e.message : "Could not save the sales." });
    }
    setBusy(false);
  };

  return (
    <div className="space-y-2 rounded-lg border border-border/60 p-3">
      <div className="text-xs font-semibold text-text">Import {channel.label} sales from a file</div>
      <p className="text-xs text-text-muted">
        A CSV with one row per day: a <b>date</b> column and a <b>revenue</b> column, plus <b>orders</b>, <b>units</b>, <b>ad spend</b> and <b>retailer</b> when you have them. The days in the file replace what was loaded before for those days.
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
        <input
          aria-label={`${channel.label} sales file`}
          type="file"
          accept=".csv,.tsv,.txt,text/csv,text/plain"
          className="text-xs text-text-muted file:mr-3 file:rounded-lg file:border file:border-border file:bg-surface file:px-3 file:py-1.5 file:text-xs file:text-text"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            setNote(null);
            setFile(f ? { name: f.name, text: await f.text() } : null);
          }}
        />
      </div>
      {parsed && (
        <div className="space-y-2 text-xs">
          {parsed.rows.length > 0 ? (
            <p className="text-text">
              {file?.name}: {days} day{days === 1 ? "" : "s"} from {parsed.from} to {parsed.to}, {parsed.rows.length} row{parsed.rows.length === 1 ? "" : "s"}. Revenue {money(parsed.revenue)}
              {parsed.adSpend > 0 ? `, ad spend ${money(parsed.adSpend)}` : ""}.
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
