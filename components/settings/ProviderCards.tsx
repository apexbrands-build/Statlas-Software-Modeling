"use client";

import { useState, type FormEvent } from "react";
import { BrandIcon } from "@/components/BrandIcon";
import { PROVIDERS, type ProviderId, type ProviderKind, type ProviderMeta } from "@/lib/providers";
import { inputCls } from "./ui";

// Add Connection cards for every provider except the three with hand-built cards (Shopify, Meta, Google Ads), driven by lib/providers.ts.

const HAND_BUILT: ProviderId[] = ["shopify", "meta", "google_ads"];
const GROUPS: { kind: ProviderKind; title: string }[] = [
  { kind: "ads", title: "Ads" },
  { kind: "messaging", title: "Email and SMS" },
  { kind: "analytics", title: "Analytics" },
];
const btn = "rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-black disabled:opacity-60";

async function postConnect(body: Record<string, unknown>): Promise<{ name?: string }> {
  const res = await fetch("/api/integrations/connect", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = (await res.json()) as { name?: string; error?: string };
  if (!res.ok) throw new Error(json.error ?? "Could not connect");
  return json;
}

export function ProviderCards({ clientId, onChanged, onClose, setMsg }: { clientId: string; onChanged: () => Promise<void>; onClose: () => void; setMsg: (m: string) => void }) {
  return (
    <>
      {GROUPS.map((g) => {
        const items = Object.values(PROVIDERS).filter((p) => p.kind === g.kind && !HAND_BUILT.includes(p.id));
        if (items.length === 0) return null;
        return (
          <div key={g.kind} className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-text-faint">{g.title}</h3>
            {items.map((p) => (p.available ? <ConnectCard key={p.id} meta={p} clientId={clientId} onChanged={onChanged} onClose={onClose} setMsg={setMsg} /> : <SoonRow key={p.id} meta={p} />))}
          </div>
        );
      })}
    </>
  );
}

function SoonRow({ meta }: { meta: ProviderMeta }) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-border px-4 py-3 text-sm text-text-muted">
      <span className="flex items-center gap-2">
        <BrandIcon provider={meta.icon} title={meta.label} />
        {meta.label}
      </span>
      <span className="rounded-full border border-border px-2 text-[10px] uppercase tracking-wide text-text-faint">Soon</span>
    </div>
  );
}

function ConnectCard({ meta, clientId, onChanged, onClose, setMsg }: { meta: ProviderMeta; clientId: string; onChanged: () => Promise<void>; onClose: () => void; setMsg: (m: string) => void }) {
  const [account, setAccount] = useState("");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const needsKey = meta.auth === "client-key";

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const json = await postConnect({ clientId, provider: meta.id, accountId: account, ...(needsKey ? { apiKey: key } : {}) });
      setKey("");
      setMsg(`Connected ${json.name ?? meta.label}. Click Edit, then Sync now.`);
      await onChanged();
      onClose();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Could not connect");
    }
    setBusy(false);
  }

  return (
    <div className="space-y-2 rounded-xl border border-border p-4">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <BrandIcon provider={meta.icon} title={meta.label} />
        {meta.label}
      </div>
      {meta.setupSteps.length > 0 && (
        <ol className="list-decimal space-y-1 pl-4 text-xs text-text-muted">
          {meta.setupSteps.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
      )}
      <form className="space-y-2" onSubmit={submit}>
        <input className={inputCls} aria-label={meta.accountLabel} placeholder={meta.accountPlaceholder || meta.accountLabel} value={account} onChange={(e) => setAccount(e.target.value)} />
        {needsKey && <input className={inputCls} type="password" autoComplete="off" aria-label="Read-only API key" placeholder="Read-only API key" value={key} onChange={(e) => setKey(e.target.value)} />}
        <button disabled={busy || !account.trim() || (needsKey && !key.trim())} className={btn}>
          {busy ? "…" : "Connect"}
        </button>
      </form>
      {err && <p className="text-xs text-bad">{err}</p>}
    </div>
  );
}

/** Shown in a connection's dialog for providers that use a client API key: the key itself is never shown, only that one is saved. */
export function ReplaceKey({ row, clientId }: { row: { provider: string; account_id: string }; clientId: string }) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setNote(null);
    try {
      await postConnect({ clientId, provider: row.provider, accountId: row.account_id, apiKey: key });
      setKey("");
      setNote({ ok: true, text: "Key replaced." });
    } catch (e2) {
      setNote({ ok: false, text: e2 instanceof Error ? e2.message : "Could not replace the key" });
    }
    setBusy(false);
  }

  return (
    <form className="space-y-2 border-t border-border pt-3" onSubmit={submit}>
      <p className="text-sm text-text-muted">Key saved</p>
      <div className="flex gap-2">
        <input className={inputCls} type="password" autoComplete="off" aria-label="New read-only API key" placeholder="Replace with a new read-only API key" value={key} onChange={(e) => setKey(e.target.value)} />
        <button disabled={busy || !key.trim()} className={btn}>
          {busy ? "…" : "Replace key"}
        </button>
      </div>
      {note && <p className={`text-xs ${note.ok ? "text-text-muted" : "text-bad"}`}>{note.text}</p>}
    </form>
  );
}
