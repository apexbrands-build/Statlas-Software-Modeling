"use client";

import { useCallback, useEffect, useState } from "react";
import { DEFAULT_NEW_CUSTOMER, DEFAULT_RETURNING, type ModelKind, type NewCustomerResults, type NewCustomerSettings, type ReturningResults, type ReturningSettings } from "@/lib/planning/models";
import type { CohortStat } from "@/lib/planning/models";
import type { CohortRow } from "@/lib/planning/returning";
import { getRepository } from "@/lib/repository";
import type { DailyFact } from "@/lib/types";
import type { PlanCtx } from "../ctx";
import { btn, btnPrimary } from "../ui";
import { BulletGlyph, CreativeIllustration, EventIllustration, GrowthIllustration, RetentionIllustration, type BulletIcon } from "./icons";
import { CreativeModel } from "./CreativeModel";
import { NewCustomerModel } from "./NewCustomerModel";
import { EventModel } from "./EventModel";
import { ReturningModel } from "./ReturningModel";

export interface CohortData {
  available: boolean;
  stats: CohortStat[];
  cohorts: CohortRow[];
}

/** Everything the two model screens share: store history, cohorts, and the model settings being edited. */
export interface ModelCtx {
  ctx: PlanCtx;
  /** Whole store history (up to 6 years) up to the last data day. */
  facts: DailyFact[];
  lastData: string;
  cohort: CohortData;
  rebuildCohorts: () => Promise<string | null>;
  newSettings: NewCustomerSettings;
  setNewSettings: (fn: (s: NewCustomerSettings) => NewCustomerSettings) => void;
  newResults: NewCustomerResults | null;
  setNewResults: (r: NewCustomerResults | null) => void;
  retSettings: ReturningSettings;
  setRetSettings: (fn: (s: ReturningSettings) => ReturningSettings) => void;
  retResults: ReturningResults | null;
  setRetResults: (r: ReturningResults | null) => void;
  /** Saves the model (settings + results) for this plan. Returns an error message or null. */
  saveModel: (kind: ModelKind, settings: unknown, results: unknown, note: string) => Promise<string | null>;
  savedAt: Partial<Record<ModelKind, string | null>>;
}

type View = "info" | "new" | "returning" | "event" | "creative";

const SIDE: { id: View; label: string }[] = [
  { id: "info", label: "Info" },
  { id: "new", label: "New Customer Model" },
  { id: "returning", label: "Returning Customer Model" },
  { id: "event", label: "Event Model" },
  { id: "creative", label: "Creative Demand Model" },
];

function Card({ title, sub, art, bullets, onOpen, disabled }: { title: string; sub: string; art: React.ReactNode; bullets: { icon: BulletIcon; text: string }[]; onOpen?: () => void; disabled?: boolean }) {
  return (
    <div className="flex flex-col rounded-xl border border-border bg-surface p-5">
      <h3 className="text-lg font-semibold" style={{ fontFamily: "var(--apex-font-heading)" }}>
        {title}
      </h3>
      <p className="mb-2 text-xs text-text-muted">{sub}</p>
      <div className="mb-3 rounded-lg bg-bg px-4 py-3 text-text">{art}</div>
      <ul className="mb-4 flex-1 space-y-3 text-sm text-text-muted">
        {bullets.map((b) => (
          <li key={b.text} className="flex gap-3">
            <BulletGlyph name={b.icon} />
            <span>{b.text}</span>
          </li>
        ))}
      </ul>
      <button className={disabled ? btn : btnPrimary} disabled={disabled} onClick={onOpen}>
        {disabled ? "Coming next" : "See model"}
      </button>
    </div>
  );
}

/** Step 1 of the editor: the models that feed Spend and Details. */
export function ModelsStep({ ctx }: { ctx: PlanCtx }) {
  const { client, plan, history } = ctx;
  const [view, setView] = useState<View>("info");
  const [cohort, setCohort] = useState<CohortData>({ available: false, stats: [], cohorts: [] });
  const [newSettings, setNewSettingsState] = useState<NewCustomerSettings>({ ...DEFAULT_NEW_CUSTOMER, months: {} });
  const [newResults, setNewResults] = useState<NewCustomerResults | null>(null);
  const [retSettings, setRetSettingsState] = useState<ReturningSettings>(DEFAULT_RETURNING);
  const [retResults, setRetResults] = useState<ReturningResults | null>(null);
  const [savedAt, setSavedAt] = useState<ModelCtx["savedAt"]>({});

  const lastData = history.lastData;

  useEffect(() => {
    if (!lastData) return;
    let cancel = false;
    (async () => {
      const repo = getRepository();
      const [c, nc, rt] = await Promise.all([
        repo.getCohortData(client.id),
        repo.getPlanModel(plan.id, "new_customer"),
        repo.getPlanModel(plan.id, "returning"),
      ]);
      if (cancel) return;
      setCohort(c);
      if (nc) {
        setNewSettingsState({ ...DEFAULT_NEW_CUSTOMER, months: {}, ...(nc.settings as Partial<NewCustomerSettings>) });
        setNewResults((nc.results as NewCustomerResults | null) ?? null);
      }
      if (rt) {
        setRetSettingsState({ ...DEFAULT_RETURNING, ...(rt.settings as Partial<ReturningSettings>) });
        setRetResults((rt.results as ReturningResults | null) ?? null);
      }
      setSavedAt({ new_customer: nc?.updatedAt ?? null, returning: rt?.updatedAt ?? null });
    })();
    return () => {
      cancel = true;
    };
  }, [client.id, plan.id, lastData]);

  const rebuildCohorts = useCallback(async (): Promise<string | null> => {
    try {
      const repo = getRepository();
      await repo.rebuildCohorts(client.id);
      setCohort(await repo.getCohortData(client.id));
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : "Could not rebuild cohorts";
    }
  }, [client.id]);

  const saveModel = useCallback(
    async (kind: ModelKind, settings: unknown, results: unknown, note: string): Promise<string | null> => {
      try {
        await getRepository().savePlanModel(plan, kind, settings, results, note);
        setSavedAt((s) => ({ ...s, [kind]: new Date().toISOString() }));
        return null;
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Could not save the model";
        return /plan_models|schema cache/i.test(msg) ? "The model could not be stored because database migration 0007 has not been applied yet (supabase/migrations/0007_cohorts_and_models.sql). Spend and aMER were still applied to the plan months; press Save plan to keep them." : msg;
      }
    },
    [plan],
  );

  // The models use everything since the store began (the editor already loaded it).
  const facts: DailyFact[] | null = history.loading ? null : history.facts;
  if (!facts) return <div className="h-64 animate-pulse rounded-xl bg-surface" />;

  const mc: ModelCtx = {
    ctx,
    facts,
    lastData,
    cohort,
    rebuildCohorts,
    newSettings,
    setNewSettings: (fn) => setNewSettingsState(fn),
    newResults,
    setNewResults,
    retSettings,
    setRetSettings: (fn) => setRetSettingsState(fn),
    retResults,
    setRetResults,
    saveModel,
    savedAt,
  };

  return (
    <div className="flex flex-col gap-4 md:flex-row">
      <nav className="flex shrink-0 gap-1 md:w-48 md:flex-col" aria-label="Models">
        {SIDE.map((s) => (
          <button key={s.id} onClick={() => setView(s.id)} className={`rounded-lg px-3 py-2 text-left text-sm ${view === s.id ? "bg-surface font-medium text-text" : "text-text-muted hover:text-text"}`}>
            {s.label}
            {s.id === "new" && newResults && <span className="ml-1 text-accent">✓</span>}
            {s.id === "returning" && retResults && <span className="ml-1 text-accent">✓</span>}
          </button>
        ))}
      </nav>
      <div className="min-w-0 flex-1">
        {view === "info" && (
          <div className="space-y-4">
            <p className="text-center text-sm text-text-muted">Models are the starting point and form the basis for the forecast. They only use the client&apos;s own history; you can then bet against them.</p>
            <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
              <Card
                title="New Revenue Model"
                sub="aMER / CAC"
                art={<GrowthIllustration />}
                bullets={[
                  { icon: "scatter", text: "Fits how revenue and aMER respond to spend from the client's daily history (weekday-adjusted, outliers removed), following the aMER_ModelV2 method." },
                  { icon: "target", text: "Shows the spend that maximises CM, 60-day CM, 1-year CM or break-even revenue, and fades returns beyond spend the client has never run. Create forecast fills the whole year." },
                ]}
                onOpen={() => setView("new")}
              />
              <Card
                title="Retention Model"
                sub="Returning customers"
                art={<RetentionIllustration />}
                bullets={[
                  { icon: "cohort", text: "Learns how each cohort of customers keeps buying over time, from every cohort since the store began." },
                  { icon: "layers", text: "Returning revenue = existing cohorts + the cohorts the plan will acquire. Create forecast fills Details; you can override or actualize it." },
                ]}
                onOpen={() => setView("returning")}
              />
              <Card
                title="Event Effect Model"
                sub="Historical event correlation to future events"
                art={<EventIllustration />}
                bullets={[
                  { icon: "calendar", text: "Compares past marketing events from the Calendar with ordinary days: how much more spend, new revenue and returning revenue each event type brings." },
                  { icon: "bolt", text: "Applies the pattern to upcoming events: event days run hotter and the others are compressed, so month totals stay what the models say." },
                ]}
                onOpen={() => setView("event")}
              />
              <Card
                title="Creative Demand Model"
                sub="New Meta ads per month"
                art={<CreativeIllustration />}
                bullets={[
                  { icon: "layers", text: "Works out how many new ads each month needs to carry the plan's Meta spend, after the spend that carries over from last month, split into moments and evergreen, videos and images." },
                  { icon: "target", text: "Scores the account's creative health from its own ad data (Creative Score). It never changes a revenue, spend or CM target." },
                ]}
                onOpen={() => setView("creative")}
              />
            </div>
          </div>
        )}
        {view === "new" && <NewCustomerModel mc={mc} />}
        {view === "returning" && <ReturningModel mc={mc} />}
        {view === "event" && <EventModel ctx={ctx} />}
        {view === "creative" && <CreativeModel mc={mc} />}
      </div>
    </div>
  );
}
