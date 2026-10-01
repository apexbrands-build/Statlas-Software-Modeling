"use client";

import { useEffect, useState } from "react";
import { addYears } from "@/lib/dates";
import { getRepository } from "@/lib/repository";
import type { DailyFact } from "@/lib/types";

/** Actuals from the start of last year (relative to the plan year) up to the last day with data. */
export function usePlanHistory(clientId: string | undefined, year: number) {
  const [state, setState] = useState<{ key: string; facts: DailyFact[]; lastData: string } | null>(null);
  const key = clientId ? `${clientId}|${year}` : null;
  useEffect(() => {
    if (!clientId || !key) return;
    let cancel = false;
    (async () => {
      const repo = getRepository();
      const lastData = await repo.getLastDataDate(clientId);
      const from = `${year - 1}-01-01`;
      const facts = lastData >= from ? await repo.getFacts(clientId, from, lastData) : [];
      // Also load the 12 months before the last data day so the weekday pattern always has a full year.
      const need = addYears(lastData, -1);
      const extra = need < from ? await repo.getFacts(clientId, need, from) : [];
      if (!cancel) setState({ key, facts: [...extra.filter((f) => f.date < from), ...facts], lastData });
    })();
    return () => {
      cancel = true;
    };
  }, [clientId, year, key]);
  const ready = state && state.key === key ? state : null;
  return { facts: ready?.facts ?? [], lastData: ready?.lastData ?? "", loading: !ready };
}
