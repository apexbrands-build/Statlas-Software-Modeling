"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * Checks Shopify for new orders once when the store page opens, then reloads the numbers. While the order history is still loading
 * it reloads every few seconds so the page fills in by itself.
 */
export function StoreRefresher({ shop, exp, sig, importing }: { shop: string; exp: string; sig: string; importing: boolean }) {
  const router = useRouter();
  const [state, setState] = useState<"checking" | "done" | "error">("checking");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/shopify/store/refresh", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ shop, exp, sig }) })
      .then(async (res) => {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        if (cancelled) return;
        if (!res.ok) {
          setState("error");
          setMessage(json.error ?? "Could not check Shopify for new orders.");
          return;
        }
        setState("done");
        router.refresh();
      })
      .catch(() => {
        if (!cancelled) {
          setState("error");
          setMessage("Could not check Shopify for new orders.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [shop, exp, sig, router]);

  useEffect(() => {
    if (!importing) return;
    const id = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(id);
  }, [importing, router]);

  if (state === "checking") return <span className="text-text-muted">Checking Shopify for new orders…</span>;
  if (state === "error") return <span className="text-bad">{message}</span>;
  return <span className="text-text-muted">Up to date with Shopify.</span>;
}
