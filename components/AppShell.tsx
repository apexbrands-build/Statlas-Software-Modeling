"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { theme } from "@/theme/theme";
import { AppProvider, useApp } from "@/lib/app-context";
import { getBrowserClient } from "@/lib/supabase/client";
import { authEnabled, dataMode } from "@/lib/supabase/env";

const NAV = [
  { href: "/", label: "Home", enabled: true },
  { href: "/settings", label: "Store Settings", enabled: true },
  { href: "#", label: "Reporting", enabled: false },
  { href: "#", label: "Planning", enabled: false },
  { href: "#", label: "Calendar", enabled: false },
];

function Shell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const { clients, client, setClientId } = useApp();
  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-56 shrink-0 flex-col border-r border-border bg-black px-4 py-5 md:flex">
        <Link href="/" className="mb-8 block">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={theme.brand.logoWordmark} alt={theme.brand.name} className="h-6 w-auto" />
        </Link>
        <nav className="flex flex-col gap-1 text-sm">
          {NAV.map((n) =>
            n.enabled ? (
              <Link
                key={n.label}
                href={n.href}
                className={`rounded-lg px-3 py-2 font-medium ${
                  path === n.href ? "bg-surface-raised text-text" : "text-text-muted hover:text-text"
                }`}
              >
                {n.label}
              </Link>
            ) : (
              <span key={n.label} className="flex items-center justify-between rounded-lg px-3 py-2 text-text-faint">
                {n.label}
                <span className="rounded-full border border-border px-2 text-[10px] uppercase tracking-wide">Soon</span>
              </span>
            ),
          )}
        </nav>
        <p className="mt-auto text-[11px] text-text-faint">{dataMode === "supabase" ? "Beta · live data" : "Beta · seed data only"}</p>
      </aside>
      <div className="min-w-0 flex-1">
        <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 md:px-8">
          <Link href="/" className="md:hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={theme.brand.logoIconAccent} alt={theme.brand.name} className="h-8 w-8 rounded" />
          </Link>
          <div className="ml-auto flex items-center gap-3">
            <label className="text-xs text-text-muted" htmlFor="client">
              Client
            </label>
            <select
              id="client"
              value={client?.id ?? ""}
              onChange={(e) => setClientId(e.target.value)}
              className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-text outline-none focus:border-accent"
            >
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            {authEnabled && (
              <button
                type="button"
                className="rounded-lg border border-border px-3 py-1.5 text-sm text-text-muted hover:text-text"
                onClick={async () => {
                  await getBrowserClient().auth.signOut();
                  window.location.href = "/login";
                }}
              >
                Sign out
              </button>
            )}
          </div>
        </header>
        <main className="px-4 py-6 md:px-8">{children}</main>
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <AppProvider>
      <Shell>{children}</Shell>
    </AppProvider>
  );
}
