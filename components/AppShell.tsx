"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { theme } from "@/theme/theme";
import { AppProvider, useApp } from "@/lib/app-context";
import { getBrowserClient } from "@/lib/supabase/client";
import { authEnabled, dataMode } from "@/lib/supabase/env";

type IconName = "home" | "folder" | "target" | "calendar" | "trend" | "gear";

/** Small generic line icons (our own, 24px grid). */
const ICONS: Record<IconName, string> = {
  home: "M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10",
  folder: "M3 6a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2z",
  target: "M12 3a9 9 0 100 18 9 9 0 000-18zm0 5a4 4 0 100 8 4 4 0 000-8z",
  calendar: "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4",
  trend: "M3 17l6-6 4 4 8-8M15 7h6v6",
  gear: "M12 9a3 3 0 100 6 3 3 0 000-6zM4 12h2M18 12h2M12 4v2M12 18v2M6.3 6.3l1.4 1.4M16.3 16.3l1.4 1.4M6.3 17.7l1.4-1.4M16.3 7.7l1.4-1.4",
};

function Icon({ name }: { name: IconName }) {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={ICONS[name]} />
    </svg>
  );
}

const NAV_GROUPS: { title: string; items: { href: string; label: string; icon: IconName; enabled: boolean }[] }[] = [
  {
    title: "Data",
    items: [
      { href: "/", label: "Home", icon: "home", enabled: true },
      { href: "/reporting", label: "Reporting", icon: "folder", enabled: true },
    ],
  },
  {
    title: "Planning",
    items: [
      { href: "/planning", label: "Planning", icon: "target", enabled: true },
      { href: "#", label: "Calendar", icon: "calendar", enabled: false },
    ],
  },
  {
    title: "Tools & Settings",
    items: [
      { href: "#", label: "MMM", icon: "trend", enabled: false },
      { href: "/settings", label: "Store Settings", icon: "gear", enabled: true },
      { href: "/onboarding", label: "Onboarding", icon: "folder", enabled: true },
    ],
  },
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
        <nav className="flex flex-col gap-5 text-sm" aria-label="Main">
          {NAV_GROUPS.map((g) => (
            <div key={g.title} className="flex flex-col gap-1">
              <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-text-faint">{g.title}</p>
              {g.items.map((n) =>
                n.enabled ? (
                  <Link
                    key={n.label}
                    href={n.href}
                    className={`flex items-center gap-2.5 rounded-lg px-3 py-2 font-medium ${
                      (n.href === "/" ? path === "/" : path.startsWith(n.href)) ? "bg-surface-raised text-text" : "text-text-muted hover:text-text"
                    }`}
                  >
                    <Icon name={n.icon} />
                    {n.label}
                  </Link>
                ) : (
                  <span key={n.label} className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-text-faint">
                    <Icon name={n.icon} />
                    {n.label}
                    <span className="ml-auto rounded-full border border-border px-2 text-[10px] uppercase tracking-wide">Soon</span>
                  </span>
                ),
              )}
            </div>
          ))}
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

/** Pages merchants and Shopify reviewers open without an Apex account: no sidebar, no client loading. */
const PUBLIC_PATHS = ["/shopify", "/privacy", "/support"];

export function AppShell({ children }: { children: ReactNode }) {
  const path = usePathname();
  if (PUBLIC_PATHS.includes(path)) return <>{children}</>;
  return (
    <AppProvider>
      <Shell>{children}</Shell>
    </AppProvider>
  );
}
