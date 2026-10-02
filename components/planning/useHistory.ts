"use client";

import { useEffect, useState } from "react";
import { getRepository } from "@/lib/repository";
import type { DailyFact } from "@/lib/types";

/** Actuals from the start of the store's history (models need every year) up to the last day with data. */
export function usePlanHistory(clientId: string | undefined, year: number) {
  const [state, setState] = useState<{ key: string; facts: DailyFact[]; lastData: string } | null>(null);
  const key = clientId ? `${clientId}|${year}` : null;
  useEffect(() => {
    if (!clientId || !key) return;
    let cancel = false;
    (async () => {
      const repo = getRepository();
      const lastData = await repo.getLastDataDate(clientId);
      // Everything since inception: days before the first order simply do not exist, so an early start date is safe.
      const facts = await repo.getFacts(clientId, "2010-01-01", lastData);
      if (!cancel) setState({ key, facts, lastData });
    })();
    return () => {
      cancel = true;
    };
  }, [clientId, year, key]);
  const ready = state && state.key === key ? state : null;
  return { facts: ready?.facts ?? [], lastData: ready?.lastData ?? "", loading: !ready };
}
