"use client";

import { useEffect, useState } from "react";
import { endOfMonth } from "@/lib/dates";
import type { PlanChange, PlanMonth } from "@/lib/planning/types";
import { getRepository } from "@/lib/repository";
import type { PlanVersion } from "@/lib/types";
import { btn, btnPrimary, inputClass, Modal, monthKey, MONTHS } from "./ui";

/** Plan settings: name, description, default, month lock/status, change log and delete. */
export function PlanSettingsDialog({ plan, onClose, onChanged }: { plan: PlanVersion; onClose: () => void; onChanged: () => void }) {
  const repo = getRepository();
  const [name, setName] = useState(plan.name);
  const [description, setDescription] = useState(plan.description);
  const [months, setMonths] = useState<PlanMonth[] | null>(null);
  const [changes, setChanges] = useState<PlanChange[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    let cancel = false;
    Promise.all([repo.getPlanMonths(plan.id), repo.getPlanChanges(plan.id)]).then(([m, c]) => {
      if (cancel) return;
      const byMonth = new Map(m.map((x) => [x.month, x]));
      setMonths(Array.from({ length: 12 }, (_, i) => byMonth.get(monthKey(plan.year, i)) ?? { month: monthKey(plan.year, i), inputs: null, status: "in_progress", locked: false }));
      setChanges(c);
    });
    return () => {
      cancel = true;
    };
  }, [repo, plan.id, plan.year]);

  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      const notes: string[] = [];
      if (name !== plan.name) notes.push("renamed");
      if (description !== plan.description) notes.push("updated description");
      if (notes.length) await repo.updatePlan({ ...plan, name: name.trim() || plan.name, description }, notes.length ? `Plan ${notes.join(" and ")}` : undefined);
      const original = new Map((await repo.getPlanMonths(plan.id)).map((m) => [m.month, m]));
      const changed = (months ?? []).filter((m) => {
        const o = original.get(m.month);
        return m.locked !== (o?.locked ?? false) || m.status !== (o?.status ?? "in_progress");
      });
      if (changed.length) {
        const items = await Promise.all(
          changed.map(async (month) => ({ month, rows: await repo.getPlanTargets(plan.clientId, plan.id, month.month, endOfMonth(month.month)) })),
        );
        await repo.savePlanMonths(plan, items, `Updated month lock/status (${changed.map((m) => MONTHS[Number(m.month.slice(5, 7)) - 1]).join(", ")})`);
      }
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save");
      setBusy(false);
    }
  };

  return (
    <Modal title={`Plan settings · ${plan.year}`} onClose={onClose} wide>
      <div className="space-y-4 text-sm">
        <label className="block">
          <span className="text-xs text-text-muted">Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} className={`${inputClass} mt-1 w-full`} />
        </label>
        <label className="block">
          <span className="text-xs text-text-muted">Description</span>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className={`${inputClass} mt-1 w-full`} />
        </label>

        <div className="flex items-center gap-3">
          <span className="text-text-muted">{plan.isDefault ? "This is the default plan for the year (Home and reports compare against it)." : "This plan is not the default."}</span>
          {!plan.isDefault && (
            <button
              className={btn}
              onClick={async () => {
                await repo.setDefaultPlan(plan);
                onChanged();
              }}
            >
              Make default
            </button>
          )}
        </div>

        <div>
          <h3 className="mb-1 font-medium">Months</h3>
          <p className="mb-2 text-xs text-text-muted">A locked month cannot be edited, filled or actualized. Mark a month Final once it is agreed with the client.</p>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-3">
            {months?.map((m, i) => (
              <div key={m.month} className="flex items-center gap-2">
                <span className="w-9 text-text-muted">{MONTHS[i]}</span>
                <label className="flex items-center gap-1 text-xs">
                  <input type="checkbox" checked={m.locked} onChange={(e) => setMonths(months.map((x) => (x.month === m.month ? { ...x, locked: e.target.checked } : x)))} />
                  Locked
                </label>
                <select
                  value={m.status}
                  onChange={(e) => setMonths(months.map((x) => (x.month === m.month ? { ...x, status: e.target.value as PlanMonth["status"] } : x)))}
                  className={`${inputClass} text-xs`}
                  aria-label={`${MONTHS[i]} status`}
                >
                  <option value="in_progress">In progress</option>
                  <option value="final">Final</option>
                </select>
              </div>
            ))}
          </div>
        </div>

        <div>
          <h3 className="mb-1 font-medium">Recent changes</h3>
          <ul className="max-h-40 space-y-0.5 overflow-y-auto text-xs text-text-muted">
            {changes.length === 0 && <li>No changes yet.</li>}
            {changes.map((c, i) => (
              <li key={i}>
                {new Date(c.at).toLocaleDateString("en-GB")}: {c.by} · {c.summary}
              </li>
            ))}
          </ul>
        </div>

        {err && <p className="text-bad">{err}</p>}
        <div className="flex items-center justify-between gap-2">
          {confirmDelete ? (
            <span className="flex items-center gap-2">
              <span className="text-bad">Delete this plan and all its targets?</span>
              <button
                className="rounded-lg border border-bad px-3 py-1.5 text-sm text-bad"
                onClick={async () => {
                  await repo.deletePlan(plan);
                  onChanged();
                }}
              >
                Yes, delete
              </button>
              <button className={btn} onClick={() => setConfirmDelete(false)}>
                No
              </button>
            </span>
          ) : (
            <button className={btn} onClick={() => setConfirmDelete(true)}>
              Delete plan
            </button>
          )}
          <span className="flex gap-2">
            <button className={btn} onClick={onClose}>
              Exit without saving
            </button>
            <button className={btnPrimary} disabled={busy} onClick={save}>
              {busy ? "Saving…" : "Save"}
            </button>
          </span>
        </div>
      </div>
    </Modal>
  );
}
