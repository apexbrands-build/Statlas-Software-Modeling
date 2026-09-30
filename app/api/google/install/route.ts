import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { GOOGLE_SCOPE, googleConfigured } from "@/lib/google";
import { getServerClient } from "@/lib/supabase/server";

// Admin only: starts the one-time Google authorization for the agency (read-only Ads scope).
export async function GET() {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!googleConfigured() || !appUrl) return NextResponse.json({ error: "Google is not configured on the server" }, { status: 400 });
  const supabase = await getServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", auth.user.id).maybeSingle();
  if (profile?.role !== "admin") return NextResponse.json({ error: "Admins only" }, { status: 403 });

  const state = randomBytes(16).toString("hex");
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", process.env.GOOGLE_CLIENT_ID!);
  url.searchParams.set("redirect_uri", `${appUrl}/api/google/callback`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_SCOPE);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", state);
  const res = NextResponse.redirect(url);
  res.cookies.set("google_oauth", state, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: 600, path: "/api/google" });
  return res;
}
