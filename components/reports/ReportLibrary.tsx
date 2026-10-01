"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { CATEGORIES, REPORTS, type ReportCategory } from "@/lib/reports/registry";

const FAV_KEY = "apex.report.favourites";
const TABS = ["Report List", "Saved Reports", "History"] as const;

export function ReportLibrary() {
  const [tab, setTab] = useState<(typeof TABS)[number]>("Report List");
  const [cat, setCat] = useState<ReportCategory | "All">("Recommended");
  const [q, setQ] = useState("");
  const [favs, setFavs] = useState<string[]>([]);

  useEffect(() => {
    // Read after mount (storage is not available while rendering on the server).
    Promise.resolve().then(() => {
      try {
        setFavs(JSON.parse(window.localStorage.getItem(FAV_KEY) ?? "[]"));
      } catch {
        /* storage unavailable */
      }
    });
  }, []);
  const toggleFav = (slug: string) => {
    const next = favs.includes(slug) ? favs.filter((s) => s !== slug) : [...favs, slug];
    setFavs(next);
    try {
      window.localStorage.setItem(FAV_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };

  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    return REPORTS.filter((r) => (cat === "All" || r.categories.includes(cat)) && (!term || `${r.title} ${r.description}`.toLowerCase().includes(term))).sort(
      (a, b) => Number(favs.includes(b.slug)) - Number(favs.includes(a.slug)),
    );
  }, [cat, q, favs]);

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <h1 className="text-xl font-semibold" style={{ fontFamily: "var(--apex-font-heading)" }}>
        Reporting
      </h1>
      <div className="flex gap-1 border-b border-border" role="tablist">
        {TABS.map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`px-4 py-2 text-sm font-medium ${tab === t ? "border-b-2 border-accent text-text" : "text-text-muted hover:text-text"}`}>
            {t}
          </button>
        ))}
      </div>

      {tab !== "Report List" ? (
        <div className="rounded-xl border border-border bg-surface p-8 text-center text-text-muted">
          {tab === "Saved Reports" ? "Saved report views will appear here (saving is not built yet)." : "Recently opened reports will appear here."}
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {CATEGORIES.map((c) => (
              <button key={c} onClick={() => setCat(c)} className={`rounded-full border px-3 py-1 text-xs font-medium ${cat === c ? "border-accent bg-accent text-black" : "border-border text-text-muted hover:text-text"}`}>
                {c}
              </button>
            ))}
            <input aria-label="Search reports" placeholder="Search reports" value={q} onChange={(e) => setQ(e.target.value)} className="ml-auto w-56 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-text outline-none focus:border-accent" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {shown.map((r) => (
              <div key={r.slug} className="flex flex-col rounded-[12px] border border-border bg-surface p-4">
                <div className="flex items-start gap-2">
                  <h2 className="mr-auto text-sm font-semibold">{r.title}</h2>
                  <button type="button" aria-label={favs.includes(r.slug) ? "Remove favourite" : "Add favourite"} onClick={() => toggleFav(r.slug)} className={favs.includes(r.slug) ? "text-accent" : "text-text-faint hover:text-text"}>
                    {favs.includes(r.slug) ? "★" : "☆"}
                  </button>
                </div>
                <p className="mt-1 flex-1 text-xs text-text-muted">{r.description}</p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Link href={`/reporting/${r.slug}`} className="rounded-lg bg-accent px-4 py-1.5 text-xs font-semibold text-black">
                    Go
                  </Link>
                  {r.categories.filter((c) => c !== "Recommended").map((c) => (
                    <span key={c} className="rounded-full border border-border px-2 py-0.5 text-[10px] text-text-muted">
                      {c}
                    </span>
                  ))}
                  {r.status === "waiting" && <span className="ml-auto rounded-full border border-accent px-2 py-0.5 text-[10px] text-accent">Waiting for data</span>}
                </div>
              </div>
            ))}
            {shown.length === 0 && <p className="text-sm text-text-muted">No reports match.</p>}
          </div>
        </>
      )}
    </div>
  );
}
