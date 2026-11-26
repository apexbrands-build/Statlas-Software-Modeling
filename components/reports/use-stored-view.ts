"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";

/* A view remembered per browser, read straight from the browser's storage (no copy in component state, so nothing has to be
   restored in an effect). Storage can be blocked: the page then remembers the view for this visit only. */

const listeners = new Set<() => void>();
const memory = new Map<string, string>();

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key) ?? memory.get(key) ?? null;
  } catch {
    return memory.get(key) ?? null;
  }
}

function write(key: string, raw: string) {
  memory.set(key, raw);
  try {
    window.localStorage.setItem(key, raw);
  } catch {
    /* the view still works without being remembered */
  }
  for (const l of listeners) l();
}

const nothing = () => null;

/** The saved view under `key` (parsed by `parse`, which also gives the defaults) and a setter that saves it. */
export function useStoredView<T>(key: string | null, parse: (raw: string | null) => T): [T, (next: T) => void] {
  const raw = useSyncExternalStore(subscribe, () => (key ? read(key) : null), nothing);
  const value = useMemo(() => parse(raw), [raw, parse]);
  const set = useCallback(
    (next: T) => {
      if (key) write(key, JSON.stringify(next));
    },
    [key],
  );
  return [value, set];
}

const everyQuarterMinute = (onChange: () => void) => {
  const id = window.setInterval(onChange, 15_000);
  return () => window.clearInterval(id);
};
const thisMinute = () => Math.floor(Date.now() / 60_000);

/** The current minute (minutes since 1970), updated as time passes; null on the server and while the page is first drawn. */
export function useMinute(): number | null {
  return useSyncExternalStore(everyQuarterMinute, thisMinute, nothing);
}
