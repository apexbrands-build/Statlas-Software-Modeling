"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useApp } from "@/lib/app-context";
import { getBrowserClient } from "@/lib/supabase/client";
import { dataMode } from "@/lib/supabase/env";

interface Integration {
  id: string;
  provider: string;
  account_id: string;
  account_name: string | null;
  status: string;
  last_synced_at: string | null;
  last_error: string | null;
}

const PROVIDERS: { id: string; label: string; ready: boolean; note: string }[] = [
  { id: "shopify", label: "Shopify", ready: true, note: "Orders, customers, product costs (read-only)" },
  { id: "meta", label: "Meta Ads", ready: true, note: "Ad spend and 7-day click purchases (read-only)" },
  { id: "google_ads", label: "Google Ads", ready: false, note: "Ad spend (coming next)" },
];

export function Connections() {
  const { client } = useApp();
  const params = useSearchParams();
  const [rows, setRows] = useState<Integration[]>([]);
  const [shop, setShop] = useState(() => (typeof window === "undefined" ? "" : (new URLSearchParams(window.location.search).get("shop") ?? "")));
  const [adAccount, setAdAccount] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [newName, setNewName] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!client || dataMode !== "supabase") return;
    const db = getBrowserClient();
    const { data } = await db
      .from("integrations")
      .select("id,provider,account_id,account_name,status,last_synced_at,last_error")
      .eq("client_id", client.id)
      .order("created_at");
    setRows((data ?? []) as Integration[]);
  }, [client]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  useEffect(() => {
    if (dataMode !== "supabase") return;
    getBrowserClient()
      .auth.getUser()
      .then(async ({ data }: { data: { user: { id: string } | null } }) => {
        if (!data.user) return;
        const { data: p } = await getBrowserClient().from("profiles").select("role").eq("id", data.user.id).maybeSingle();
        setIsAdmin(p?.role === "admin");
      });
  }, []);

  if (dataMode !== "supabase") {
    return (
      <section className="rounded-2xl border border-border bg-surface p-4 text-sm text-text-muted">
        Connections are available once the app runs on real data (set <code>NEXT_PUBLIC_DATA_MODE=supabase</code>). Seed data is showing now.
      </section>
    );
  }

  const status = params.get("connected") ? `Connected ${params.get("connected")}.` : params.get("error") ? `Connection problem: ${params.get("error")}` : null;

  async function addClient() {
    if (busy === "client") return;
    setBusy("client");
    setMsg(null);
    const res = await fetch("/api/clients", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: newName }) });
    if (!res.ok) {
      setBusy(null);
      return setMsg((await res.json()).error ?? "Could not create client");
    }
    setNewName("");
    window.location.reload();
  }

  const shopify = rows.filter((r) => r.provider === "shopify");
  const meta = rows.filter((r) => r.provider === "meta");

  async function connectMeta() {
    if (!client) return;
    setBusy("meta");
    setMsg(null);
    const res = await fetch("/api/meta/connect", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientId: client.id, adAccountId: adAccount }) });
    const json = await res.json();
    setBusy(null);
    if (!res.ok) return setMsg(json.error ?? "Could not connect");
    setAdAccount("");
    await load();
  }

  async function syncMeta(id: string, provider: "meta" | "shopify" = "meta") {
    setBusy(id);
    setMsg(null);
    const res = await fetch(`/api/sync/${provider}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ integrationId: id, days: 90 }) });
    const json = await res.json();
    setBusy(null);
    setMsg(res.ok ? (provider === "meta" ? `Synced ${json.rows} campaign-days.` : `Synced ${json.orders} orders.${json.note ? ` ${json.note}` : ""}`) : (json.error ?? "Sync failed"));
    await load();
  }
  const inputCls = "rounded-lg border border-border bg-surface px-3 py-1.5 text-sm outline-none focus:border-accent";

  return (
    <section className="rounded-2xl border border-border bg-surface">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold">Connections{client ? ` · ${client.name}` : ""}</h2>
        <p className="mt-0.5 text-xs text-text-muted">Read-only connections. Tokens are stored encrypted on the server and never shown here.</p>
      </div>
      {status && <p className="border-b border-border px-4 py-2 text-xs text-accent">{status}</p>}
      <div className="divide-y divide-border">
        {PROVIDERS.map((p) => (
          <div key={p.id} className="px-4 py-3">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-sm">{p.label}</div>
                <div className="text-xs text-text-muted">{p.note}</div>
              </div>
              {!p.ready && <span className="rounded-full border border-border px-2 text-[10px] uppercase tracking-wide text-text-faint">Soon</span>}
            </div>
            {p.id === "shopify" && client && (
              <div className="mt-3 space-y-2">
                {shopify.map((r) => (
                  <div key={r.id} className="flex items-center justify-between text-xs">
                    <span>
                      {r.account_name ?? r.account_id} <span className="text-text-muted">({r.account_id})</span>
                    </span>
                    <span className="flex items-center gap-3">
                      <span className={r.status === "connected" ? "text-good" : "text-bad"}>{r.status}{r.last_error ? `: ${r.last_error}` : ""}</span>
                      <button disabled={busy === r.id} onClick={() => syncMeta(r.id, "shopify")} className="rounded-lg border border-border px-2 py-1 text-text-muted hover:text-text disabled:opacity-50">
                        {busy === r.id ? "Syncing…" : "Sync now"}
                      </button>
                    </span>
                  </div>
                ))}
                <form
                  className="flex flex-wrap items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    window.location.href = `/api/shopify/install?client=${client.id}&shop=${encodeURIComponent(shop)}`;
                  }}
                >
                  <input className={`${inputCls} w-64`} placeholder="store-name.myshopify.com" value={shop} onChange={(e) => setShop(e.target.value)} />
                  <button className="rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-black">Connect Shopify</button>
                </form>
              </div>
            )}
            {p.id === "meta" && client && (
              <div className="mt-3 space-y-2">
                {meta.map((r) => (
                  <div key={r.id} className="flex items-center justify-between gap-3 text-xs">
                    <span>
                      {r.account_name ?? r.account_id} <span className="text-text-muted">({r.account_id})</span>
                    </span>
                    <span className="flex items-center gap-3">
                      <span className={r.status === "connected" ? "text-good" : "text-bad"}>{r.status}{r.last_error ? `: ${r.last_error}` : ""}</span>
                      <button disabled={busy === r.id} onClick={() => syncMeta(r.id)} className="rounded-lg border border-border px-2 py-1 text-text-muted hover:text-text disabled:opacity-50">
                        {busy === r.id ? "Syncing…" : "Sync now"}
                      </button>
                    </span>
                  </div>
                ))}
                <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); void connectMeta(); }}>
                  <input className={`${inputCls} w-64`} placeholder="Ad account ID, e.g. act_1234567890" value={adAccount} onChange={(e) => setAdAccount(e.target.value)} />
                  <button disabled={busy === "meta" || !adAccount.trim()} className="rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-black disabled:opacity-50">Connect Meta</button>
                </form>
              </div>
            )}
          </div>
        ))}
      </div>
      {msg && <p className="border-t border-border px-4 py-2 text-xs text-text-muted">{msg}</p>}
      {isAdmin && (
        <div className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-3">
          <input className={`${inputCls} w-64`} placeholder="New client name" value={newName} onChange={(e) => setNewName(e.target.value)} />
          <button onClick={addClient} disabled={!newName.trim() || busy === "client"} className="rounded-lg border border-border px-3 py-1.5 text-sm text-text-muted hover:text-text disabled:opacity-50">
            Add client
          </button>
        </div>
      )}
    </section>
  );
}
