"use client";

import { useEffect, useState } from "react";
import { useApp } from "@/lib/app-context";
import { ONBOARDING_CHECKLIST } from "@/lib/onboarding-checklist";

/** Ticks are saved per client in this browser only (a convenience, not shared data). */
export function OnboardingChecklist() {
  const { client } = useApp();
  const key = `apex.onboarding.${client?.id ?? "none"}`;
  const [done, setDone] = useState<string[]>([]);

  useEffect(() => {
    Promise.resolve().then(() => {
      try {
        setDone(JSON.parse(window.localStorage.getItem(key) ?? "[]"));
      } catch {
        setDone([]);
      }
    });
  }, [key]);

  const toggle = (id: string) => {
    const next = done.includes(id) ? done.filter((d) => d !== id) : [...done, id];
    setDone(next);
    try {
      window.localStorage.setItem(key, JSON.stringify(next));
    } catch {
      /* storage unavailable */
    }
  };
  const total = ONBOARDING_CHECKLIST.reduce((s, sec) => s + sec.items.length, 0);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Client onboarding checklist</h1>
        <p className="mt-1 text-sm text-text-muted">
          {client ? client.name : "No client selected"} · {done.length} of {total} done. Ticks are saved in this browser only.
        </p>
      </div>
      {ONBOARDING_CHECKLIST.map((sec) => (
        <section key={sec.title} className="rounded-xl border border-border bg-surface p-4">
          <h2 className="mb-3 text-sm font-semibold">{sec.title}</h2>
          <ul className="space-y-2">
            {sec.items.map((it) => (
              <li key={it.id}>
                <label className="flex cursor-pointer items-start gap-3 text-sm">
                  <input type="checkbox" className="mt-1" checked={done.includes(it.id)} onChange={() => toggle(it.id)} />
                  <span>
                    <span className={done.includes(it.id) ? "text-text-muted line-through" : ""}>{it.text}</span>
                    {it.hint && <span className="block text-xs text-text-faint">{it.hint}</span>}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
