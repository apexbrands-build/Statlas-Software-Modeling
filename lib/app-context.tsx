"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { getRepository } from "./repository";
import type { Client, ClientSettings } from "./types";

interface AppState {
  clients: Client[];
  client: Client | null;
  settings: ClientSettings | null;
  setClientId: (id: string) => void;
  saveSettings: (s: ClientSettings) => Promise<void>;
  resetSettings: () => Promise<void>;
}

const Ctx = createContext<AppState | null>(null);
const CLIENT_KEY = "apex.client";

export function AppProvider({ children }: { children: ReactNode }) {
  const repo = useMemo(() => getRepository(), []);
  const [clients, setClients] = useState<Client[]>([]);
  const [clientId, setClientIdState] = useState<string | null>(null);
  const [settings, setSettings] = useState<ClientSettings | null>(null);

  useEffect(() => {
    let cancel = false;
    repo.listClients().then((cs) => {
      if (cancel) return;
      let saved: string | null = null;
      try {
        saved = window.localStorage.getItem(CLIENT_KEY);
      } catch {
        /* storage unavailable */
      }
      setClients(cs);
      setClientIdState(cs.find((c) => c.id === saved)?.id ?? cs[0]?.id ?? null);
    });
    return () => {
      cancel = true;
    };
  }, [repo]);

  useEffect(() => {
    if (!clientId) return;
    let cancel = false;
    repo.getSettings(clientId).then((s) => {
      if (!cancel) setSettings(s);
    });
    return () => {
      cancel = true;
    };
  }, [repo, clientId]);

  const setClientId = useCallback((id: string) => {
    setSettings(null);
    setClientIdState(id);
    try {
      window.localStorage.setItem(CLIENT_KEY, id);
    } catch {
      /* ignore */
    }
  }, []);

  const saveSettings = useCallback(
    async (s: ClientSettings) => {
      await repo.saveSettings(s);
      setSettings(s);
    },
    [repo],
  );

  const resetSettings = useCallback(async () => {
    if (!clientId) return;
    setSettings(await repo.resetSettings(clientId));
  }, [repo, clientId]);

  const client = clients.find((c) => c.id === clientId) ?? null;
  const value = useMemo(
    () => ({ clients, client, settings: client && settings?.clientId === client.id ? settings : null, setClientId, saveSettings, resetSettings }),
    [clients, client, settings, setClientId, saveSettings, resetSettings],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp must be used inside AppProvider");
  return v;
}
