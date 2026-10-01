"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { BrandIcon } from "@/components/BrandIcon";
import { EditStoreDialog } from "./EditStoreDialog";
import { inputCls, Modal } from "./ui";
import { useApp } from "@/lib/app-context";
import { getBrowserClient } from "@/lib/supabase/client";
import { dataMode } from "@/lib/supabase/env";
import { addDays, todayLocal } from "@/lib/dates";
import type { ClientSettings } from "@/lib/types";

interface Integration {
  id: string;
  provider: string;
  account_id: string;
  account_name: string | null;
  status: string;
  coverage_start: string | null;
  coverage_end: string | null;
  last_synced_at: string | null;
  last_error: string | null;
}

const PROVIDER_LABEL: Record<string, string> = { shopify: "Shopify", meta: "Facebook", google_ads: "Google Ads", pinterest: "Pinterest", klaviyo: "Klaviyo", ga4: "GA4" };

type Dialog = null | "edit" | "add" | "costs" | "store" | { connection: Integration };

export function StoreSettingsPage() {
  const { client, settings, saveSettings } = useApp();
  const params = useSearchParams();
  const [rows, setRows] = useState<Integration[]>([]);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  const live = dataMode === "supabase";

  const load = useCallback(async () => {
    if (!client || !live) return;
    const { data } = await getBrowserClient()
      .from("integrations")
      .select("id,provider,account_id,account_name,status,coverage_start,coverage_end,last_synced_at,last_error")
      .eq("client_id", client.id)
      .order("created_at");
    setRows((data ?? []) as Integration[]);
  }, [client, live]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  useEffect(() => {
    if (!live) return;
    getBrowserClient()
      .auth.getUser()
      .then(async ({ data }: { data: { user: { id: string } | null } }) => {
        if (!data.user) return;
        const { data: p } = await getBrowserClient().from("profiles").select("role").eq("id", data.user.id).maybeSingle();
        setIsAdmin(p?.role === "admin");
      });
  }, [live]);

  // Shopify's install link lands here with ?shop=... : open the Add Connection dialog prefilled.
  const shopParam = params.get("shop");
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (shopParam && live) setDialog("add");
  }, [shopParam, live]);

  if (!client || !settings) return <div className="h-40 animate-pulse rounded-xl bg-surface" />;

  const shopify = rows.find((r) => r.provider === "shopify");
  const banner = params.get("connected") ? `Connected ${params.get("connected")}.` : params.get("error") ? `Connection problem: ${params.get("error")}` : null;

  async function syncAll(provider: "shopify" | "meta" | "google_ads") {
    for (const r of rows.filter((x) => x.provider === provider)) {
      const res = await fetch(`/api/sync/${provider === "google_ads" ? "google" : provider}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ integrationId: r.id, days: provider === "shopify" ? 60 : 90 }) });
      if (!res.ok) throw new Error((await res.json()).error ?? "Sync failed");
    }
    await load();
  }

  const btn = "rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-black";
  const ghost = "rounded-lg border border-border px-3 py-1.5 text-sm text-text-muted hover:text-text";

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {/* Header card */}
      <section className="rounded-2xl border border-border bg-surface">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h1 className="text-lg font-semibold" style={{ fontFamily: "var(--apex-font-heading)" }}>
            {client.name} Settings
          </h1>
          <button onClick={() => setVersion((v) => v + 1)} className={ghost} aria-label="Refresh">
            Refresh
          </button>
        </div>
        <div className="grid gap-4 px-5 py-4 text-sm md:grid-cols-[1.2fr_1.2fr_0.8fr_1fr_1.4fr_auto]">
          <Info label="Store Code" value={shopify ? shopify.account_id.replace(".myshopify.com", "") : client.id.slice(0, 8)} />
          <Info label="Timezone" value={client.timezone} />
          <Info label="Currency" value={client.currency} />
          <Info label="Revenue Definition" value="Order Revenue" />
          <Info label="Channels" value={settings.dtcChannels.join(", ") || "None"} />
          <button onClick={() => setDialog("edit")} className={`${btn} self-center`}>
            Edit
          </button>
        </div>
      </section>

      {banner && <p className="text-sm text-accent">{banner}</p>}
      {msg && <p className="text-sm text-text-muted">{msg}</p>}

      {/* Integrations */}
      <section className="rounded-2xl border border-border bg-surface">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="text-sm font-semibold">Integrations</h2>
          <button onClick={() => setDialog("add")} className={btn}>
            + Add Connection
          </button>
        </div>
        {!live ? (
          <p className="px-5 py-6 text-sm text-text-muted">Connections become available when the app runs on real data. Demo data is showing now.</p>
        ) : rows.length === 0 ? (
          <p className="px-5 py-6 text-sm text-text-muted">No connections yet. Click Add Connection to connect Shopify first.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-text-muted">
                <tr>
                  {["Provider", "Account", "Details", "Value", "Status", ""].map((h) => (
                    <th key={h} className="px-5 py-2 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const ok = r.status === "connected" && r.last_synced_at;
                  return (
                    <tr key={r.id} className="border-t border-border align-top">
                      <td className="px-5 py-3">
                        <span className="flex items-center gap-2 font-medium">
                          <BrandIcon provider={r.provider} title={PROVIDER_LABEL[r.provider]} />
                          {PROVIDER_LABEL[r.provider] ?? r.provider}
                          {r.status === "error" && <span title={r.last_error ?? ""}>⚠️</span>}
                        </span>
                      </td>
                      <td className="px-5 py-3">{r.account_name ?? r.account_id}</td>
                      <td className="px-5 py-3 text-text-muted">{client.timezone}</td>
                      <td className="px-5 py-3 text-text-muted">{client.currency}</td>
                      <td className="min-w-64 px-5 py-3">
                        <div className="text-xs text-text-muted">{r.coverage_start ? `${r.coverage_start} to ${r.coverage_end}` : "Not synced yet"}</div>
                        <div className="mt-1 flex items-center gap-2">
                          <div className="h-1.5 flex-1 rounded-full bg-surface-raised">
                            <div className="h-1.5 rounded-full bg-accent" style={{ width: ok ? "100%" : "0%" }} />
                          </div>
                          <span className="text-xs text-text-muted">{ok ? "100%" : "0%"}</span>
                        </div>
                        {r.last_error && <div className="mt-2 rounded-lg border border-yellow-500/40 px-3 py-1.5 text-xs text-yellow-300">{r.last_error}</div>}
                      </td>
                      <td className="px-5 py-3 text-right">
                        <button onClick={() => setDialog({ connection: r })} className={btn}>
                          Edit
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Costs and expenses */}
      <section className="rounded-2xl border border-border bg-surface">
        <div className="border-b border-border px-5 py-3 text-sm font-semibold">Costs and Expenses</div>
        <div className="px-5 py-4">
          <button onClick={() => setDialog("costs")} className={btn}>
            Cost Settings
          </button>
        </div>
      </section>

      {/* Other options */}
      <section className="rounded-2xl border border-border bg-surface">
        <div className="border-b border-border px-5 py-3 text-sm font-semibold">Other Options</div>
        <div className="space-y-3 px-5 py-4 text-sm text-text-muted">
          <div className="flex items-center gap-3">
            <button disabled className={`${ghost} opacity-50`}>
              Manage Email Reports
            </button>
            Schedule your main dashboard sent to you (coming soon).
          </div>
          <div className="flex items-center gap-3">
            <button disabled={!isAdmin || !live} onClick={() => setDialog("store")} className={`${btn} disabled:opacity-50`}>
              Add New Store
            </button>
            Add another store to the dashboard{isAdmin ? "." : " (admins only)."}
          </div>
        </div>
      </section>

      {dialog === "edit" && (
        <EditStoreDialog
          key={version}
          clientName={client.name}
          currency={client.currency}
          timezone={client.timezone}
          initial={settings}
          onClose={() => setDialog(null)}
          onSave={async (s: ClientSettings) => saveSettings(s)}
          onRecalculate={async (s: ClientSettings) => {
            await saveSettings(s);
            if (live) await syncAll("shopify");
          }}
        />
      )}
      {dialog === "add" && <AddConnectionDialog clientId={client.id} initialShop={shopParam ?? ""} isAdmin={isAdmin} onClose={() => setDialog(null)} onChanged={load} setMsg={setMsg} />}
      {dialog === "costs" && <CostDialog clientId={client.id} live={live} onClose={() => setDialog(null)} setMsg={setMsg} />}
      {dialog === "store" && <NewStoreDialog onClose={() => setDialog(null)} />}
      {typeof dialog === "object" && dialog && "connection" in dialog && (
        <ConnectionDialog
          row={dialog.connection}
          clientId={client.id}
          onDisconnected={async () => {
            setDialog(null);
            setMsg("Connection removed. Loaded data is kept.");
            await load();
          }}
          onClose={() => setDialog(null)}
          onSync={async () => {
            await syncAll(dialog.connection.provider === "meta" ? "meta" : dialog.connection.provider === "google_ads" ? "google_ads" : "shopify");
            setMsg("Synced.");
          }}
        />
      )}
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs font-semibold">{label}</div>
      <div className="text-text-muted">{value}</div>
    </div>
  );
}

function AddConnectionDialog({ clientId, initialShop, isAdmin, onClose, onChanged, setMsg }: { clientId: string; initialShop: string; isAdmin: boolean; onClose: () => void; onChanged: () => Promise<void>; setMsg: (m: string | null) => void }) {
  const [shop, setShop] = useState(initialShop);
  const [account, setAccount] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const btn = "rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-black disabled:opacity-50";

  async function connectMeta() {
    setBusy(true);
    setErr(null);
    const res = await fetch("/api/meta/connect", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientId, adAccountId: account }) });
    const json = await res.json();
    setBusy(false);
    if (!res.ok) return setErr(json.error ?? "Could not connect");
    setMsg(`Connected ${json.name}. Click Edit, then Sync now.`);
    await onChanged();
    onClose();
  }

  return (
    <Modal title="Add Connection" onClose={onClose}>
      <div className="space-y-2 rounded-xl border border-border p-4">
        <div className="flex items-center gap-2 text-sm font-semibold"><BrandIcon provider="shopify" />Shopify</div>
        <p className="text-xs text-text-muted">Read-only: orders, customers, product costs. You approve the install in Shopify as a store admin.</p>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); window.location.href = `/api/shopify/install?client=${clientId}&shop=${encodeURIComponent(shop)}`; }}>
          <input className={inputCls} placeholder="store-name.myshopify.com" value={shop} onChange={(e) => setShop(e.target.value)} />
          <button disabled={!shop.trim()} className={btn}>
            Connect
          </button>
        </form>
      </div>
      <div className="space-y-2 rounded-xl border border-border p-4">
        <div className="flex items-center gap-2 text-sm font-semibold"><BrandIcon provider="meta" title="Meta" />Meta Ads</div>
        <p className="text-xs text-text-muted">Read-only ad spend and 7-day click purchases, through the agency System User.</p>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void connectMeta(); }}>
          <input className={inputCls} placeholder="Ad account ID, e.g. act_1234567890" value={account} onChange={(e) => setAccount(e.target.value)} />
          <button disabled={!account.trim() || busy} className={btn}>
            {busy ? "…" : "Connect"}
          </button>
        </form>
        {err && <p className="text-xs text-bad">{err}</p>}
      </div>
      <GoogleConnect clientId={clientId} isAdmin={isAdmin} onChanged={onChanged} onClose={onClose} setMsg={setMsg} />
      {[["pinterest", "Pinterest"], ["klaviyo", "Klaviyo"], ["ga4", "GA4"]].map(([id, p]) => (
        <div key={p} className="flex items-center justify-between rounded-xl border border-border px-4 py-3 text-sm text-text-muted">
          <span className="flex items-center gap-2"><BrandIcon provider={id} title={p} />{p}</span>
          <span className="rounded-full border border-border px-2 text-[10px] uppercase tracking-wide text-text-faint">Soon</span>
        </div>
      ))}
    </Modal>
  );
}

function ConnectionDialog({ row, clientId, onClose, onSync, onDisconnected }: { row: Integration; clientId: string; onClose: () => void; onSync: () => Promise<void>; onDisconnected: () => Promise<void> }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const syncable = row.provider === "shopify" || row.provider === "meta" || row.provider === "google_ads";
  return (
    <Modal title={`${PROVIDER_LABEL[row.provider] ?? row.provider} connection`} onClose={onClose}>
      <BrandIcon provider={row.provider} size={32} title={PROVIDER_LABEL[row.provider]} />
      <dl className="grid grid-cols-[8rem_1fr] gap-y-2 text-sm">
        <dt className="text-text-muted">Account</dt>
        <dd>{row.account_name ?? row.account_id}</dd>
        <dt className="text-text-muted">ID</dt>
        <dd>{row.account_id}</dd>
        <dt className="text-text-muted">Status</dt>
        <dd>{row.status}</dd>
        <dt className="text-text-muted">Last synced</dt>
        <dd>{row.last_synced_at ? new Date(row.last_synced_at).toLocaleString() : "Never"}</dd>
        <dt className="text-text-muted">Coverage</dt>
        <dd>{row.coverage_start ? `${row.coverage_start} to ${row.coverage_end}` : "–"}</dd>
      </dl>
      {row.last_error && <p className="rounded-lg border border-yellow-500/40 px-3 py-2 text-xs text-yellow-300">{row.last_error}</p>}
      {err && <p className="text-xs text-bad">{err}</p>}
      {syncable && (
        <button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setErr(null);
            try {
              await onSync();
              onClose();
            } catch (e) {
              setErr(e instanceof Error ? e.message : "Sync failed");
            }
            setBusy(false);
          }}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-black disabled:opacity-60"
        >
          {busy ? "Syncing…" : "Sync now"}
        </button>
      )}
      {syncable && <HistoryLoader row={row} />}
      <div className="flex flex-wrap items-center gap-3 border-t border-border pt-3">
        {row.provider === "shopify" && (
          <a href={`/api/shopify/install?client=${clientId}&shop=${encodeURIComponent(row.account_id)}`} className="rounded-lg border border-border px-4 py-2 text-sm text-text-muted hover:text-text">
            Reconnect
          </a>
        )}
        {!confirming ? (
          <button onClick={() => setConfirming(true)} className="rounded-lg border border-bad/50 px-4 py-2 text-sm text-bad hover:bg-bad/10">
            Disconnect
          </button>
        ) : (
          <span className="flex items-center gap-2 text-xs text-text-muted">
            Remove this connection? Data already loaded stays.
            <button
              onClick={async () => {
                const res = await fetch("/api/integrations/disconnect", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ integrationId: row.id }) });
                if (res.ok) await onDisconnected();
                else setErr((await res.json()).error ?? "Could not remove");
              }}
              className="rounded-lg bg-bad px-3 py-1.5 text-sm font-semibold text-black"
            >
              Yes, remove
            </button>
            <button onClick={() => setConfirming(false)} className="rounded-lg border border-border px-3 py-1.5 text-sm">
              Cancel
            </button>
          </span>
        )}
      </div>
      <p className="text-xs text-text-faint">Connections are read-only. Disconnect removes it from this dashboard; to revoke access completely, also remove the app in the store or ad account.</p>
    </Modal>
  );
}

function CostDialog({ clientId, live, onClose, setMsg }: { clientId: string; live: boolean; onClose: () => void; setMsg: (m: string | null) => void }) {
  const [stats, setStats] = useState<{ total: number; withCost: number } | null>(null);
  const [csv, setCsv] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!live) return;
    const db = getBrowserClient();
    Promise.all([
      db.from("products").select("variant_id", { count: "exact", head: true }).eq("client_id", clientId),
      db.from("products").select("variant_id", { count: "exact", head: true }).eq("client_id", clientId).gt("unit_cost", 0),
    ]).then(([t, w]: { count: number | null }[]) => setStats({ total: t.count ?? 0, withCost: w.count ?? 0 }));
  }, [clientId, live]);

  async function upload() {
    setBusy(true);
    const res = await fetch("/api/costs/upload", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientId, csv }) });
    const json = await res.json();
    setBusy(false);
    setMsg(res.ok ? `Costs saved for ${json.matched} variants (of ${json.received} lines). Sync again to apply them.` : (json.error ?? "Upload failed"));
    if (res.ok) onClose();
  }

  return (
    <Modal title="Cost Settings" onClose={onClose}>
      <div className="text-sm">
        Product costs from Shopify:{" "}
        {stats ? (
          <>
            <span className="font-semibold">{stats.withCost}</span> of {stats.total} variants have a cost per item.
          </>
        ) : live ? (
          "loading…"
        ) : (
          "available with real data"
        )}
      </div>
      <p className="text-xs text-text-muted">Shopify keeps one cost per variant (Products → variant → Pricing → Cost per item). Where it is empty, upload costs by SKU below, or set a COGS % or flat rate under Edit → P&amp;L / CM Calculation.</p>
      <textarea className="h-28 w-full rounded-lg border border-border bg-surface px-3 py-2 text-xs outline-none focus:border-accent" placeholder={"One per line: SKU,cost\nSKU-123,8.50\nSKU-456,12.00"} value={csv} onChange={(e) => setCsv(e.target.value)} />
      <button disabled={!live || !csv.trim() || busy} onClick={upload} className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-black disabled:opacity-50">
        {busy ? "Saving…" : "Save costs"}
      </button>
    </Modal>
  );
}

function NewStoreDialog({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function create() {
    if (busy) return;
    setBusy(true);
    setErr(null);
    const res = await fetch("/api/clients", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
    if (!res.ok) {
      setBusy(false);
      return setErr((await res.json()).error ?? "Could not create store");
    }
    window.location.reload();
  }
  return (
    <Modal title="Add New Store" onClose={onClose}>
      <input className={inputCls} placeholder="Store / client name" value={name} onChange={(e) => setName(e.target.value)} />
      {err && <p className="text-xs text-bad">{err}</p>}
      <button disabled={!name.trim() || busy} onClick={create} className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-black disabled:opacity-50">
        {busy ? "Creating…" : "Create store"}
      </button>
    </Modal>
  );
}

function GoogleConnect({ clientId, isAdmin, onChanged, onClose, setMsg }: { clientId: string; isAdmin: boolean; onChanged: () => Promise<void>; onClose: () => void; setMsg: (m: string | null) => void }) {
  const [status, setStatus] = useState<{ configured: boolean; authorized: boolean } | null>(null);
  const [customer, setCustomer] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    fetch("/api/google/status")
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => setStatus({ configured: false, authorized: false }));
  }, []);

  async function connect() {
    setBusy(true);
    setErr(null);
    const res = await fetch("/api/google/connect", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientId, customerId: customer }) });
    const json = await res.json();
    setBusy(false);
    if (!res.ok) return setErr(json.error ?? "Could not connect");
    setMsg(`Connected ${json.name}. Click Edit, then Sync now.`);
    await onChanged();
    onClose();
  }

  return (
    <div className="space-y-2 rounded-xl border border-border p-4">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <BrandIcon provider="google_ads" title="Google Ads" />
        Google Ads
      </div>
      <p className="text-xs text-text-muted">Read-only spend and purchase conversions through the agency manager (MCC) account. Brand spend = campaign name contains the brand keyword in Settings.</p>
      {!status ? (
        <p className="text-xs text-text-muted">Checking…</p>
      ) : !status.configured ? (
        <p className="text-xs text-yellow-300">Google is not configured on the server yet (missing environment variables).</p>
      ) : !status.authorized ? (
        isAdmin ? (
          <a href="/api/google/install" className="inline-block rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-black">
            Authorize Google (one time, admins)
          </a>
        ) : (
          <p className="text-xs text-yellow-300">An admin must authorize Google once before accounts can be connected.</p>
        )
      ) : (
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void connect(); }}>
          <input className={inputCls} placeholder="Customer ID, e.g. 123-456-7890" value={customer} onChange={(e) => setCustomer(e.target.value)} />
          <button disabled={!customer.trim() || busy} className="rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-black disabled:opacity-50">
            {busy ? "…" : "Connect"}
          </button>
        </form>
      )}
      {err && <p className="text-xs text-bad">{err}</p>}
    </div>
  );
}

const ENDPOINT: Record<string, string> = { shopify: "shopify", meta: "meta", google_ads: "google" };
const CHUNK_DAYS: Record<string, number> = { shopify: 14, meta: 60, google_ads: 60 };

function chunksOf(from: string, to: string, size: number) {
  const out: { from: string; to: string }[] = [];
  let end = to;
  while (end >= from) {
    const start = addDays(end, -(size - 1)) < from ? from : addDays(end, -(size - 1));
    out.push({ from: start, to: end });
    end = addDays(start, -1);
  }
  return out; // newest first, so recent days appear on the dashboard first
}

/** Loads a longer history in chunks with a progress bar (so no single request runs long). */
function HistoryLoader({ row }: { row: Integration }) {
  const [months, setMonths] = useState(12);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; label: string } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [allOrders, setAllOrders] = useState<boolean | null>(row.provider === "shopify" ? null : true);
  const cancel = useRef(false);

  useEffect(() => {
    if (row.provider !== "shopify") return;
    fetch(`/api/sync/shopify?integrationId=${row.id}`)
      .then((r) => r.json())
      .then((j) => setAllOrders(Boolean(j.hasAllOrders)))
      .catch(() => setAllOrders(false));
  }, [row.id, row.provider]);

  const limited = row.provider === "shopify" && allOrders === false;

  async function post(body: Record<string, unknown>) {
    const res = await fetch(`/api/sync/${ENDPOINT[row.provider]}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ integrationId: row.id, ...body }) });
    // A timeout comes back as plain text, not JSON: read it safely.
    const text = await res.text();
    let json: { error?: string } = {};
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`Server stopped before finishing (${res.status}): ${text.slice(0, 60)}`);
    }
    if (!res.ok) throw new Error(json.error ?? "Request failed");
    return json;
  }

  /** Runs one date range; if it fails (usually a timeout on a busy period), splits it in half and retries. */
  async function runChunk(from: string, to: string, first: boolean, label: (s: string) => void): Promise<void> {
    if (cancel.current) throw new Error("Stopped. What was loaded so far is saved.");
    label(`${from} → ${to}`);
    try {
      await post({ from, to, first });
    } catch (e) {
      if (from >= to) throw e; // a single day still fails: report it
      const days = Math.round((new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86_400_000);
      const mid = addDays(from, Math.floor(days / 2));
      await runChunk(from, mid, first, label);
      await runChunk(addDays(mid, 1), to, false, label);
    }
  }

  async function start() {
    cancel.current = false;
    setRunning(true);
    setMsg(null);
    const yesterday = addDays(todayLocal(), -1);
    const begin = addDays(yesterday, -(months * 30));
    // Resume: days already loaded (coverage runs from its start date to yesterday) are skipped.
    const end = row.coverage_start && row.coverage_start > begin && row.coverage_start <= yesterday ? addDays(row.coverage_start, -1) : yesterday;
    const list = end >= begin ? chunksOf(begin, end, CHUNK_DAYS[row.provider] ?? 60) : [];
    try {
      for (let i = 0; i < list.length; i++) {
        await runChunk(list[i].from, list[i].to, i === 0, (label) => setProgress({ done: i, total: list.length, label }));
      }
      if (row.provider === "shopify") {
        setProgress({ done: list.length, total: list.length, label: "Classifying new vs returning customers…" });
        await post({ action: "finalize", from: begin, to: yesterday });
      }
      setProgress({ done: list.length, total: list.length, label: "Done" });
      setMsg(`Loaded ${months} months (${begin} → ${yesterday}). Open Home and compare with last year.`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Load failed");
    }
    setRunning(false);
  }

  return (
    <div className="space-y-2 rounded-xl border border-border p-4">
      <div className="text-sm font-semibold">Load history</div>
      {limited ? (
        <p className="text-xs text-yellow-300">
          Shopify only allows the last 60 days until this store approves the <code>read_all_orders</code> permission. Release the new app version in Shopify, then open the app&apos;s install link (Dev Dashboard → Apex Data → Distribution) as a store admin and approve the updated permissions. Then reopen this window. Meta and Google can load years today.
        </p>
      ) : (
        <>
          <p className="text-xs text-text-muted">Loads daily data in chunks (safe to stop and resume). Needed for year-over-year comparisons.</p>
          <div className="flex flex-wrap items-center gap-2">
            <select aria-label="History length" value={months} onChange={(e) => setMonths(Number(e.target.value))} disabled={running} className="rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent">
              {[3, 6, 12, 24, 36].map((m) => (
                <option key={m} value={m}>
                  Last {m} months
                </option>
              ))}
            </select>
            {!running ? (
              <button onClick={start} className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-black">
                Load history
              </button>
            ) : (
              <button onClick={() => (cancel.current = true)} className="rounded-lg border border-border px-4 py-2 text-sm text-text-muted hover:text-text">
                Stop
              </button>
            )}
          </div>
        </>
      )}
      {progress && (
        <div className="space-y-1">
          <div className="h-1.5 rounded-full bg-surface-raised">
            <div className="h-1.5 rounded-full bg-accent transition-all" style={{ width: `${Math.round((progress.done / Math.max(1, progress.total)) * 100)}%` }} />
          </div>
          <div className="text-xs text-text-muted">
            {progress.done}/{progress.total} · {progress.label}
          </div>
        </div>
      )}
      {msg && <p className="text-xs text-text-muted">{msg}</p>}
    </div>
  );
}
