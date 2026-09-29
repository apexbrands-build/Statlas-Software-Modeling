"use client";

import { useState } from "react";
import { useApp } from "@/lib/app-context";
import { CHANNEL_KEYS, CHANNEL_LABELS, type ChannelKey, type ClientSettings } from "@/lib/types";

const ALL_DTC = ["Online Store", "Shop", "Point of Sale", "Draft Orders", "TikTok", "Subscriptions", "Wholesale"];
const MULT_HELP: Record<ChannelKey, string> = {
  google_nonbrand: "Non-brand search/shopping campaigns",
  google_brand: "Campaigns whose name contains the brand keyword below",
  meta_acquisition: "Prospecting audiences",
  meta_returning: "Existing-customer audience segment",
  pinterest: "Pinterest ads",
};

const inputCls = "w-28 rounded-lg border border-border bg-surface px-3 py-1.5 text-right text-sm outline-none focus:border-accent";

export function SettingsForm() {
  const { client, settings, saveSettings, resetSettings } = useApp();
  const [version, setVersion] = useState(0);
  if (!client || !settings) return <div className="h-40 animate-pulse rounded-xl bg-surface" />;
  return (
    <Editor
      key={`${client.id}:${version}`}
      clientName={client.name}
      currency={client.currency}
      timezone={client.timezone}
      initial={settings}
      onSave={saveSettings}
      onReset={async () => {
        await resetSettings();
        setVersion((v) => v + 1);
      }}
    />
  );
}

function Editor(props: {
  clientName: string;
  currency: string;
  timezone: string;
  initial: ClientSettings;
  onSave: (s: ClientSettings) => Promise<void>;
  onReset: () => Promise<void>;
}) {
  const { clientName, currency, timezone, initial, onSave, onReset } = props;
  const [draft, setDraft] = useState<ClientSettings>({
    ...initial,
    multipliers: { ...initial.multipliers },
    dtcChannels: [...initial.dtcChannels],
  });
  const [saved, setSaved] = useState(false);

  const set = <K extends keyof ClientSettings>(k: K, v: ClientSettings[K]) => {
    setDraft({ ...draft, [k]: v });
    setSaved(false);
  };
  const num = (v: string) => (v === "" || Number.isNaN(Number(v)) ? 0 : Number(v));

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold" style={{ fontFamily: "var(--apex-font-heading)" }}>
          Store Settings · {clientName}
        </h1>
        <p className="mt-1 text-sm text-text-muted">
          Stored in this browser for the seed-data beta. They move to the database when Supabase is connected.
        </p>
      </div>

      <Card title="Store">
        <Row label="Currency" note="Set per client">
          <span className="text-sm text-text-muted">{currency}</span>
        </Row>
        <Row label="Timezone">
          <span className="text-sm text-text-muted">{timezone}</span>
        </Row>
        <Row label="Revenue definition" note="Order Revenue = gross − discounts + shipping + tax, refunds not deducted. Used for MER, AOV, iROAS.">
          <span className="text-sm text-text-muted">Order Revenue</span>
        </Row>
        <Row label="Attribution" note="Meta and Google, 7-day click only">
          <span className="text-sm text-text-muted">7-day click</span>
        </Row>
      </Card>

      <Card title="Incrementality (iROAS) factors" subtitle="Platform-reported revenue × factor = incremental revenue. Adjust per client (e.g. from geo-holdout or third-party incrementality results). Defaults are public-domain benchmarks.">
        {CHANNEL_KEYS.map((k) => (
          <Row key={k} label={CHANNEL_LABELS[k]} note={MULT_HELP[k]}>
            <input
              aria-label={`${CHANNEL_LABELS[k]} multiplier`}
              type="number"
              step="0.05"
              min="0"
              className={inputCls}
              value={draft.multipliers[k]}
              onChange={(e) => set("multipliers", { ...draft.multipliers, [k]: num(e.target.value) })}
            />
          </Row>
        ))}
        <Row label="Google brand keyword" note="Campaign names containing this text are treated as Brand">
          <input className={`${inputCls} w-40 text-left`} value={draft.brandCampaignKeyword} onChange={(e) => set("brandCampaignKeyword", e.target.value)} />
        </Row>
        <Row label="Exclude Google Brand from aMER">
          <Toggle checked={draft.excludeBrandFromAmer} onChange={(v) => set("excludeBrandFromAmer", v)} label="Exclude Google Brand from aMER" />
        </Row>
        <Row label="Exclude Meta returning from aMER">
          <Toggle checked={draft.excludeMetaReturningFromAmer} onChange={(v) => set("excludeMetaReturningFromAmer", v)} label="Exclude Meta returning from aMER" />
        </Row>
      </Card>

      <Card title="Contribution margin costs" subtitle="CM = Net Sales − Refunds − Shipping costs − COGS − Other variable − Ad spend.">
        <Row label="COGS" note="Pulled from Shopify variant cost when connected (seed values for now)">
          <span className="text-sm text-text-muted">Shopify</span>
        </Row>
        <Row label="Shipping cost per order" note="What the brand pays to ship one order">
          <input aria-label="Shipping cost per order" type="number" step="0.1" min="0" className={inputCls} value={draft.shippingCostPerOrder} onChange={(e) => set("shippingCostPerOrder", num(e.target.value))} />
        </Row>
        <Row label="Other variable costs (% of net sales)" note="Payment fees, packaging, etc.">
          <input aria-label="Other variable costs percent" type="number" step="0.5" min="0" className={inputCls} value={draft.otherVariablePct} onChange={(e) => set("otherVariablePct", num(e.target.value))} />
        </Row>
        <Row label="Monthly fixed costs" note="Shown as CM after fixed costs; not part of headline CM">
          <input aria-label="Monthly fixed costs" type="number" step="100" min="0" className={inputCls} value={draft.monthlyFixedCosts} onChange={(e) => set("monthlyFixedCosts", num(e.target.value))} />
        </Row>
      </Card>

      <Card title="DTC sales channels" subtitle="Shopify sales channels counted as direct-to-consumer.">
        <div className="flex flex-wrap gap-2 p-4">
          {ALL_DTC.map((c) => {
            const on = draft.dtcChannels.includes(c);
            return (
              <button
                key={c}
                type="button"
                aria-pressed={on}
                onClick={() => set("dtcChannels", on ? draft.dtcChannels.filter((x) => x !== c) : [...draft.dtcChannels, c])}
                className={`rounded-full border px-3 py-1 text-sm ${on ? "border-accent text-accent" : "border-border text-text-muted"}`}
              >
                {c}
              </button>
            );
          })}
        </div>
        <p className="px-4 pb-4 text-xs text-text-faint">Recorded only for now: seed data does not vary by channel.</p>
      </Card>

      <div className="flex items-center gap-3">
        <button
          type="button"
          className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-black"
          onClick={async () => {
            await onSave(draft);
            setSaved(true);
          }}
        >
          Save settings
        </button>
        <button type="button" className="rounded-lg border border-border px-4 py-2 text-sm text-text-muted hover:text-text" onClick={() => onReset()}>
          Reset to defaults
        </button>
        {saved && <span className="text-sm text-good">Saved. The dashboard uses these values.</span>}
      </div>
    </div>
  );
}

function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-surface">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        {subtitle && <p className="mt-0.5 text-xs text-text-muted">{subtitle}</p>}
      </div>
      <div className="divide-y divide-border">{children}</div>
    </section>
  );
}

function Row({ label, note, children }: { label: string; note?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <div>
        <div className="text-sm">{label}</div>
        {note && <div className="text-xs text-text-muted">{note}</div>}
      </div>
      {children}
    </div>
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`h-6 w-11 rounded-full border border-border p-0.5 transition-colors ${checked ? "bg-accent" : "bg-surface-raised"}`}
    >
      <span className={`block h-4.5 w-4.5 rounded-full bg-white transition-transform ${checked ? "translate-x-5 bg-black" : ""}`} style={{ width: 18, height: 18 }} />
    </button>
  );
}
