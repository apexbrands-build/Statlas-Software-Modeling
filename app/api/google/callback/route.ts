import { NextResponse } from "next/server";
import { saveRefreshToken } from "@/lib/google";
import { getServerClient } from "@/lib/supabase/server";

function back(request: Request, query: string) {
  return NextResponse.redirect(new URL(`/settings?${query}`, request.url));
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookie = request.headers.get("cookie")?.split("; ").find((c) => c.startsWith("google_oauth="))?.slice("google_oauth=".length);
  if (!code || !state || cookie !== state) return back(request, "error=google_state_mismatch");

  const supabase = await getServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return back(request, "error=not_signed_in");
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", auth.user.id).maybeSingle();
  if (profile?.role !== "admin") return back(request, "error=admins_only");

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: `${process.env.NEXT_PUBLIC_APP_URL}/api/google/callback`,
      grant_type: "authorization_code",
    }),
  });
  const json = (await res.json()) as { refresh_token?: string };
  if (!res.ok || !json.refresh_token) return back(request, "error=google_no_refresh_token");
  await saveRefreshToken(json.refresh_token);
  const out = back(request, "connected=google_authorization");
  out.cookies.delete({ name: "google_oauth", path: "/api/google" });
  return out;
}
