"use client";

import { useState } from "react";
import { theme } from "@/theme/theme";
import { getBrowserClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"in" | "up">("in");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const supabase = getBrowserClient();
    if (mode === "in") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setMsg(error.message);
      else window.location.href = "/";
    } else {
      if (!email.toLowerCase().endsWith("@apexbrands.io")) {
        setMsg("Use your @apexbrands.io email.");
      } else {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) setMsg(error.message);
        else if (data.session) window.location.href = "/";
        else setMsg("Check your email to confirm your account, then sign in.");
      }
    }
    setBusy(false);
  }

  const input = "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent";
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-2xl border border-border bg-surface p-6">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={theme.brand.logoWordmark} alt={theme.brand.name} className="mx-auto mb-2 h-6 w-auto" />
        <h1 className="text-center text-sm text-text-muted">{mode === "in" ? "Sign in" : "Create your account"}</h1>
        <input className={input} type="email" placeholder="you@apexbrands.io" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
        <input className={input} type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} autoComplete={mode === "in" ? "current-password" : "new-password"} />
        <button disabled={busy} className="w-full rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-black disabled:opacity-60">
          {mode === "in" ? "Sign in" : "Create account"}
        </button>
        {msg && <p className="text-center text-xs text-bad">{msg}</p>}
        <button type="button" className="w-full text-center text-xs text-text-muted hover:text-text" onClick={() => setMode(mode === "in" ? "up" : "in")}>
          {mode === "in" ? "First time? Create an account" : "Already have an account? Sign in"}
        </button>
      </form>
    </div>
  );
}
