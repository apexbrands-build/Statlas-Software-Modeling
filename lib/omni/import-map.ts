/**
 * Column mappings a person made by hand when loading a file ("this column is that number"), remembered in the browser that made them,
 * per store, channel and kind of file. A convenience only: the page works without it, and another browser starts from the app's own
 * reading of the columns.
 */

type Store = { getItem(key: string): string | null; setItem(key: string, value: string): void };
export type ColumnMap = Record<string, string | null>;

const keyOf = (clientId: string, channel: string, kind: string) => `apex.importmap.${clientId}.${channel}.${kind}`;

function browserStorage(): Store | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readMap(clientId: string, channel: string, kind: string, storage: Store | null = browserStorage()): ColumnMap {
  try {
    const raw = storage?.getItem(keyOf(clientId, channel, kind));
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: ColumnMap = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) if (typeof v === "string" || v === null) out[k] = v;
    return out;
  } catch {
    return {};
  }
}

export function writeMap(clientId: string, channel: string, kind: string, map: ColumnMap, storage: Store | null = browserStorage()): void {
  try {
    storage?.setItem(keyOf(clientId, channel, kind), JSON.stringify(map));
  } catch {
    /* storage can be blocked or full: the mapping is then only kept for this upload */
  }
}
