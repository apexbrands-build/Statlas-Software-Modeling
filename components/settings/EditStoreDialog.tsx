"use client";

import { useState } from "react";
import { BrandIcon, channelProvider } from "@/components/BrandIcon";
import { Accordion, Check, Field, inputCls, Modal, NumberInput, Select, Switch } from "./ui";
import { PLATFORMS, platformOf } from "@/lib/channels";
import { channelOptions, type OrderChannel } from "@/lib/order-channels";
import { CHANNEL_KEYS, type ChannelKey, type ClientSettings, type ExtraSettings } from "@/lib/types";

const INDUSTRIES = ["Jewelry & Accessories", "Apparel", "Beauty & Personal Care", "Health & Wellness", "Home & Garden", "Food & Beverage", "Sports & Outdoors", "Electronics", "Pets", "Other"];

const REVENUE_DEFS: { name: string; description: string; ready: boolean }[] = [
  { name: "Order Revenue", description: "(default) Total Sales without Returns (gross - discounts + shipping + tax)", ready: true },
  { name: "Order Revenue before Taxes", description: "Order Revenue minus tax", ready: false },
  { name: "Order Revenue (no Shipping)", description: "Order Revenue minus shipping", ready: false },
  { name: "Gross Sales", description: "Sum of line item prices before discounts and returns", ready: false },
  { name: "Discounted Sales", description: "Gross sales minus discounts", ready: false },
  { name: "Net Sales", description: "Gross sales minus discounts minus returns", ready: false },
  { name: "Net Sales before Taxes", description: "Net Sales excluding tax", ready: false },
  { name: "Net Sales (no Shipping)", description: "Net Sales excluding shipping", ready: false },
  { name: "Total Sales", description: "Net sales plus shipping and taxes (after returns)", ready: false },
];

const ORGANIC_DEFS = ["Calculated: New Rev - Paid", "Calculated: Total Rev - Paid", "Calculated: New Rev - iPaid", "Calculated: Total Rev - iPaid", "Calculated: Total Rev - Paid - Email/SMS", "Calculated: Total Rev - iPaid - Email/SMS", "GA (medium=organic + Org Shopping)"];

interface Props {
  clientName: string;
  currency: string;
  timezone: string;
  initial: ClientSettings;
  /** Sales channels found on this store's orders (empty until the first sync). */
  channels: OrderChannel[];
  onSave: (s: ClientSettings) => Promise<void>;
  onRecalculate: (s: ClientSettings) => Promise<void>;
  onClose: () => void;
}

export function EditStoreDialog({ clientName, currency, timezone, initial, channels, onSave, onRecalculate, onClose }: Props) {
  const [d, setD] = useState<ClientSettings>({ ...initial, multipliers: { ...initial.multipliers }, dtcChannels: [...initial.dtcChannels], excludedOrderTags: [...initial.excludedOrderTags], extra: { ...initial.extra } });
  const [tag, setTag] = useState("");
  const [newPublisher, setNewPublisher] = useState("YouTube");
  const [newAcq, setNewAcq] = useState(true);
  const [newFactor, setNewFactor] = useState(0.3);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof ClientSettings>(k: K, v: ClientSettings[K]) => setD((p) => ({ ...p, [k]: v }));
  const ex = <K extends keyof ExtraSettings>(k: K, v: ExtraSettings[K]) => setD((p) => ({ ...p, extra: { ...p.extra, [k]: v } }));
  const x = d.extra;
  const revDef = REVENUE_DEFS[0];

  async function run(fn: (s: ClientSettings) => Promise<void>, done: string) {
    setBusy(true);
    setMsg(null);
    try {
      await fn(d);
      setMsg(done);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Something went wrong");
    }
    setBusy(false);
  }

  return (
    <Modal
      wide
      title={`${clientName} Settings`}
      onClose={onClose}
      footer={
        <>
          {msg && <span className="mr-auto text-xs text-text-muted">{msg}</span>}
          <button onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-sm text-text-muted hover:text-text">
            Close
          </button>
          <button disabled={busy} onClick={() => run(onSave, "Saved. The dashboard uses these values.")} className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-black disabled:opacity-60">
            Submit
          </button>
          <button disabled={busy} onClick={() => run(onRecalculate, "Saved and re-synced.")} className="rounded-lg border border-bad px-4 py-2 text-sm font-semibold text-bad disabled:opacity-60">
            Recalculate
          </button>
        </>
      }
    >
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Logo URL" hint="URL to the logo of the store">
          <input className={inputCls} value={x.logoUrl} onChange={(e) => ex("logoUrl", e.target.value)} />
        </Field>
        <Field label="Industry">
          <Select label="Industry" value={x.industry || INDUSTRIES[0]} options={INDUSTRIES} onChange={(v) => ex("industry", v)} />
        </Field>
        <Field label="Currency">
          <div className={`${inputCls} text-text-muted`}>{currency}</div>
        </Field>
        <Field label="Time Zone">
          <div className={`${inputCls} text-text-muted`}>{timezone}</div>
        </Field>
        <Field label="Revenue Definition">
          <Select label="Revenue Definition" value={revDef.name} options={REVENUE_DEFS.map((r) => r.name)} disabledOptions={REVENUE_DEFS.filter((r) => !r.ready).map((r) => r.name)} onChange={() => {}} />
        </Field>
        <div className="text-sm">
          <div className="font-semibold">{revDef.name}</div>
          <div className="text-xs text-text-muted">{revDef.description}</div>
        </div>
      </div>

      <h3 className="pt-2 text-sm font-semibold">Other Settings</h3>

      <Accordion title="Starting Day of the Week" subtitle="Select Day of Week Weekly Reporting Should Start On" notApplied>
        <Field label="Day">
          <Select label="Day" value={x.weekStartDay} options={["Monday", "Sunday", "Saturday"]} onChange={(v) => ex("weekStartDay", v)} />
        </Field>
        <p className="text-xs text-text-muted">Weekly reporting will start on {x.weekStartDay}s.</p>
      </Accordion>

      <Accordion title="Facebook Settings" subtitle="Select revenue window">
        <Check checked={x.fbUseIncrementalDefault} onChange={(v) => ex("fbUseIncrementalDefault", v)} label="Use Incremental by default" />
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Click Window">
            <Select label="Click Window" value={x.fbAttrClick} options={["1 Day", "7 Day", "28 Day"]} onChange={(v) => ex("fbAttrClick", v)} />
          </Field>
          <Field label="View Window">
            <Select label="View Window" value={x.fbAttrView} options={["Disabled", "1 Day", "7 Day"]} onChange={(v) => ex("fbAttrView", v)} />
          </Field>
        </div>
        <Field label="Click Type">
          <Select label="Click Type" value={x.fbClickType} options={["Unique Outbound Clicks", "All Clicks", "Link Clicks"]} onChange={(v) => ex("fbClickType", v)} />
        </Field>
        <Field label="Catalog campaign keywords" hint='Ads in a Meta campaign whose name contains one of these words (comma separated, any case) are catalog ads. They are left out of the creative score and the creative demand model. Default: "catalog, dpa, daba". Applies from the next Meta sync.'>
          <input className={inputCls} value={x.catalogKeywords ?? ""} placeholder="catalog, dpa, daba" onChange={(e) => ex("catalogKeywords", e.target.value)} />
        </Field>
        <Check checked={x.fbExcludeOnsite} onChange={(v) => ex("fbExcludeOnsite", v)} label="Exclude FB Onsite Conversions" hint="Onsite conversions should be excluded if you don't have an Onsite/SHOP channel" />
        <p className="text-xs text-text-faint">Click and view windows apply to Meta purchases from the next Meta sync (re-run the history load to restate older days). Agency standard is 7 Day click, view Disabled. Click type and onsite exclusion are not applied yet.</p>
      </Accordion>

      <Accordion title="Google Settings" subtitle="Revenue Timing" notApplied>
        <Field label="Revenue Timing">
          <Select label="Revenue Timing" value={x.googleRevenueTiming} options={["Conversion by Revenue Date", "Conversion by Click Date"]} onChange={(v) => ex("googleRevenueTiming", v)} />
        </Field>
      </Accordion>

      <Accordion title="Pinterest Attribution" subtitle="Select revenue window" notApplied>
        <Field label="Attribution">
          <Select label="Pinterest Attribution" value={x.pinterestAttribution} options={["Unset", "1 Day Click", "7 Day Click", "30 Day Click"]} onChange={(v) => ex("pinterestAttribution", v)} />
        </Field>
      </Accordion>

      <Accordion title="Incrementality (iROAS)" subtitle="Used to normalize ROAS among different publishers" defaultOpen>
        <Check checked={x.showIncrementalByDefault} onChange={(v) => ex("showIncrementalByDefault", v)} label="Show Incremental ROAS (iROAS) Instead of ROAS by Default" />
        <div className="space-y-2">
          {CHANNEL_KEYS.filter((k) => d.multipliers[k] !== undefined)
            .sort((a, b) => Number(platformOf(a).kind === "NON-Acquisition") - Number(platformOf(b).kind === "NON-Acquisition") || PLATFORMS.indexOf(platformOf(a).platform) - PLATFORMS.indexOf(platformOf(b).platform))
            .map((key: ChannelKey) => {
              const { platform, kind } = platformOf(key);
              return (
                <div key={key} className={`flex items-center justify-between gap-4 rounded-xl border px-4 py-3 ${kind === "Acquisition" ? "border-good/30 bg-good/5" : "border-yellow-400/30 bg-yellow-400/5"}`}>
                  <div className="text-sm">
                    <span className="inline-flex items-center gap-2 font-medium">
                      <BrandIcon provider={platform.icon} title={platform.publisher} />
                      {platform.publisher}
                    </span>
                    <span className="ml-3 text-text-muted">{kind}</span>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="w-28">
                      <NumberInput label={`${platform.publisher} ${kind} factor`} step={0.05} value={d.multipliers[key] ?? 1} onChange={(v) => set("multipliers", { ...d.multipliers, [key]: v })} />
                    </div>
                    <button
                      type="button"
                      aria-label={`Delete ${platform.publisher} ${kind}`}
                      onClick={() => {
                        const next = { ...d.multipliers };
                        delete next[key];
                        set("multipliers", next);
                      }}
                      className="text-xs font-semibold text-bad hover:underline"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              );
            })}
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-accent/50 px-4 py-3">
            <div className="flex flex-wrap items-center gap-4">
              <div className="w-40">
                <Select label="Publisher" value={newPublisher} options={PLATFORMS.map((p) => p.publisher)} onChange={setNewPublisher} />
              </div>
              <span className="flex items-center gap-2 text-sm">
                {newAcq ? "Acquisition" : "NON-Acquisition"}
                <Switch label="Acquisition" checked={newAcq} onChange={setNewAcq} />
              </span>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-24">
                <NumberInput label="New factor" step={0.05} value={newFactor} onChange={setNewFactor} />
              </div>
              <button
                type="button"
                onClick={() => {
                  const p = PLATFORMS.find((x) => x.publisher === newPublisher);
                  if (p) set("multipliers", { ...d.multipliers, [newAcq ? p.acquisition : p.nonAcquisition]: newFactor });
                }}
                className="rounded-lg border border-border px-4 py-2 text-sm text-text-muted hover:text-text"
              >
                Add
              </button>
            </div>
          </div>
        </div>
        <p className="text-xs text-text-faint">Platform-reported revenue × factor = incremental revenue. Set per client (for example from a geo-holdout or a third-party incrementality study).</p>
      </Accordion>

      <Accordion title="aMER/CAC Calculation" subtitle="Exclude campaigns from aMER/CAC calculation">
        <Check checked={d.excludeBrandFromAmer} onChange={(v) => set("excludeBrandFromAmer", v)} label="Exclude Search Brand Spend from aMER formulas" />
        <Check checked={d.excludeMetaReturningFromAmer} onChange={(v) => set("excludeMetaReturningFromAmer", v)} label="Exclude Social Non-Acquisition Spend from aMER formulas" />
        <Field label="Google brand keyword" hint="Google campaigns whose name contains this text are treated as Brand.">
          <input className={inputCls} value={d.brandCampaignKeyword} onChange={(e) => set("brandCampaignKeyword", e.target.value)} />
        </Field>
        <Field label="Non-brand tag" hint='A campaign with this tag as its own word in the name (e.g. "AB | NB | Sales") is never counted as brand, even if it also contains the brand keyword.'>
          <input className={inputCls} value={x.nonBrandTag} onChange={(e) => ex("nonBrandTag", e.target.value)} />
        </Field>
        <Check checked={x.dontSeparateBrand} onChange={(v) => ex("dontSeparateBrand", v)} label={'Don\'t Separate "Brand" Campaigns from Search'} hint="Checking this will make all paid search spend count as Acquisition (saved, not applied yet)" />
        <Check checked={x.dontSeparateRetention} onChange={(v) => ex("dontSeparateRetention", v)} label={'Don\'t Separate Campaigns with "Retention" from Acquisition'} hint="Saved, not applied yet" />
        <Check checked={x.dontSeparateReactivation} onChange={(v) => ex("dontSeparateReactivation", v)} label={'Don\'t Separate Campaigns with "Reactivation" (also: Reengagement) from Acquisition'} hint="Saved, not applied yet" />
        <Check checked={x.excludeTestCampaigns} onChange={(v) => ex("excludeTestCampaigns", v)} label="Exclude Test Campaigns" hint="Saved, not applied yet" />
        {x.excludeTestCampaigns && (
          <Field label="Exclude Keyword">
            <input className={inputCls} value={x.testKeyword} onChange={(e) => ex("testKeyword", e.target.value)} />
          </Field>
        )}
      </Accordion>

      <Accordion title="P&L / CM Calculation" subtitle="Contribution Margin Options" defaultOpen>
        <Check checked disabled onChange={() => {}} label="Reduce Contribution Margin by Ad Spend (CAC)" hint="Always on in this app" />
        <Check checked disabled onChange={() => {}} label="Include Shipping Fees Collected as Profits" hint="Always on: CM = Net Sales + Shipping − COGS − Ad spend − Cost of delivery" />
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Cost of delivery (% of net sales + shipping)">
            <NumberInput label="Cost percent of sales" step={0.5} suffix="%" value={d.otherVariablePct} onChange={(v) => set("otherVariablePct", v)} />
          </Field>
          <Field label="Cost per order">
            <NumberInput label="Cost per order" step={0.1} value={d.deliveryCostPerOrder} onChange={(v) => set("deliveryCostPerOrder", v)} />
          </Field>
          <Field label="COGS % of sales (estimate or flat rate)" hint="Used for products with no cost per item, or for everything if flat rate is on">
            <NumberInput label="COGS percent" step={0.5} suffix="%" value={d.cogsFallbackPct} onChange={(v) => set("cogsFallbackPct", v)} />
          </Field>
          <Field label="Monthly fixed cost" hint="P&L only, not part of contribution margin">
            <NumberInput label="Monthly fixed cost" step={100} value={d.monthlyFixedCosts} onChange={(v) => set("monthlyFixedCosts", v)} />
          </Field>
        </div>
        <Check checked={d.cogsFlatRate} onChange={(v) => set("cogsFlatRate", v)} label="Use flat rate for COGS (ignore other COGS calculations)" hint="COGS = the COGS % above × net sales, ignoring Shopify product costs" />
        <Check checked={x.cogsAccrueReturnsByRate} onChange={(v) => ex("cogsAccrueReturnsByRate", v)} label="Use rate to accrue returns & ignore E-Commerce return data" hint="Saved, not applied yet" />
        <Check checked={x.dontUseShopifyCogs} onChange={(v) => ex("dontUseShopifyCogs", v)} label="Don't use Shopify to calculate COGS" hint="Saved, not applied yet. Turn on the flat rate above to ignore Shopify costs today" />
        <p className="text-xs text-text-faint">Dashboards take up to a day to rerun when definition changes are made.</p>
      </Accordion>

      <Accordion title="Define Test Campaigns" subtitle="Test campaigns are categorized in their own campaign category" notApplied>
        <Field label="Exclude Text Tests Campaigns starts with">
          <input className={inputCls} value={x.testStartsWith} onChange={(e) => ex("testStartsWith", e.target.value)} />
        </Field>
        <Field label="Exclude Text Tests Campaigns contains">
          <input className={inputCls} value={x.testKeyword} onChange={(e) => ex("testKeyword", e.target.value)} />
        </Field>
        <Field label="Exclude Text Tests Campaigns ends with">
          <input className={inputCls} value={x.testEndsWith} onChange={(e) => ex("testEndsWith", e.target.value)} />
        </Field>
        <Check checked={x.excludeTestFromRoas} onChange={(v) => ex("excludeTestFromRoas", v)} label="Exclude test campaigns from all ROAS calculations" hint="(revenue may still be included if comparing ad spend against GA/Shopify revenue)" />
      </Accordion>

      <Accordion title="Channels" subtitle="Select channels to include in sales reporting (Shopify)" defaultOpen>
        <div className="space-y-2">
          {channelOptions(channels, d.dtcChannels).map(({ channel: c, orders }) => {
            const on = d.dtcChannels.some((x) => x.toLowerCase() === c.toLowerCase());
            return (
              <div key={c} className="flex items-center justify-between rounded-xl border border-border px-4 py-3">
                <span className="flex items-center gap-3 text-sm">
                  <BrandIcon provider={channelProvider(c)} title={c} size={22} />
                  {c}
                  <span className="text-xs text-text-faint">{orders > 0 ? `${orders.toLocaleString("en-US")} ${orders === 1 ? "order" : "orders"}` : "no orders yet"}</span>
                </span>
                <Switch label={c} checked={on} onChange={(v) => set("dtcChannels", v ? [...d.dtcChannels, c] : d.dtcChannels.filter((x) => x.toLowerCase() !== c.toLowerCase()))} />
              </div>
            );
          })}
        </div>
        <p className="text-xs text-text-faint">These are the channels found on this store&apos;s orders; new ones appear after a sync. Orders from a channel that is off are left out of every total. Changes apply at the next Recalculate (sync), which re-reads the last 60 days.</p>
      </Accordion>

      <Accordion title="Exclude Order Tags" subtitle="Exclude Shopify orders that contain these tags">
        <div className="flex gap-2">
          <input className={inputCls} placeholder="Enter a Tag to Exclude" value={tag} onChange={(e) => setTag(e.target.value)} />
          <button
            type="button"
            disabled={!tag.trim()}
            onClick={() => {
              set("excludedOrderTags", [...new Set([...d.excludedOrderTags, tag.trim()])]);
              setTag("");
            }}
            className="rounded-lg border border-border px-4 text-sm text-text-muted hover:text-text disabled:opacity-50"
          >
            Add Tag
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          {d.excludedOrderTags.map((t) => (
            <button key={t} type="button" onClick={() => set("excludedOrderTags", d.excludedOrderTags.filter((x) => x !== t))} className="rounded-full border border-border px-3 py-1 text-xs text-text-muted hover:text-bad">
              {t} ✕
            </button>
          ))}
        </div>
        <p className="text-xs text-text-faint">Orders containing any of these tags are excluded from reporting at the next Recalculate (sync).</p>
      </Accordion>

      <Accordion title="Gift Card" subtitle="Select how to handle gift card orders (Shopify)" notApplied>
        <Field label="Separate Gift Card Orders By">
          <Select label="Gift card handling" value={x.giftCardMode} options={["Do not separate (default)", "Separate by product type"]} onChange={(v) => ex("giftCardMode", v)} />
        </Field>
      </Accordion>

      <Accordion title="Email/Organic Settings" subtitle="Define email and organic definitions for the dashboard" notApplied>
        <Field label="Email/SMS Revenue Defined By" hint="Klaviyo and GA4 connectors are not built yet.">
          <Select label="Email revenue source" value={x.emailRevenueSource === "ga4" ? "GA" : "Klaviyo"} options={["Klaviyo", "GA"]} onChange={(v) => ex("emailRevenueSource", v === "GA" ? "ga4" : "klaviyo")} />
        </Field>
        <Field label="Organic Definition">
          <Select label="Organic definition" value={x.organicDefinition} options={ORGANIC_DEFS} onChange={(v) => ex("organicDefinition", v)} />
        </Field>
      </Accordion>

      <Accordion title="Customer Churn Calculation" subtitle="Define your customer churn thresholds" notApplied>
        <p className="text-xs text-text-muted">The distribution of days between orders will appear here once customer history is synced (the reference tool derives it from new customers over the last 2 years).</p>
        <Field label="Days Until Customer is At Risk of Churn">
          <NumberInput label="At risk days" value={x.churnAtRiskDays} onChange={(v) => ex("churnAtRiskDays", v)} />
        </Field>
        <Field label="Days Until Customer is Considered Churn">
          <NumberInput label="Churn days" value={x.churnDays} onChange={(v) => ex("churnDays", v)} />
        </Field>
      </Accordion>

      <Accordion title="Cash Conversion Cycle" subtitle="Enter your DIO, DSO, and DPO values" notApplied>
        <div className="grid gap-4 md:grid-cols-3">
          <Field label="Days Inventory Outstanding">
            <NumberInput label="DIO" value={x.dio} onChange={(v) => ex("dio", v)} />
          </Field>
          <Field label="Days Sales Outstanding">
            <NumberInput label="DSO" value={x.dso} onChange={(v) => ex("dso", v)} />
          </Field>
          <Field label="Days Payable Outstanding">
            <NumberInput label="DPO" value={x.dpo} onChange={(v) => ex("dpo", v)} />
          </Field>
        </div>
        <p className="text-xs text-text-muted">CCC = DIO + DSO − DPO = <span className="text-text">{x.dio + x.dso - x.dpo}</span> days. These values are used in financial planning calculations.</p>
      </Accordion>

      <Accordion title="TikTok Shop Settings" subtitle="Configure TikTok Shop fee structure and GMV share" notApplied>
        <div className="grid gap-4 md:grid-cols-3">
          <Field label="Platform Referral Fee">
            <NumberInput label="Referral fee" step={0.5} suffix="%" value={x.tiktokReferralFeePct} onChange={(v) => ex("tiktokReferralFeePct", v)} />
          </Field>
          <Field label="GMV Share">
            <NumberInput label="GMV share" step={0.5} suffix="%" value={x.tiktokGmvSharePct} onChange={(v) => ex("tiktokGmvSharePct", v)} />
          </Field>
          <Field label="GMV Share Commission">
            <NumberInput label="GMV commission" step={0.5} suffix="%" value={x.tiktokGmvCommissionPct} onChange={(v) => ex("tiktokGmvCommissionPct", v)} />
          </Field>
        </div>
      </Accordion>
    </Modal>
  );
}
