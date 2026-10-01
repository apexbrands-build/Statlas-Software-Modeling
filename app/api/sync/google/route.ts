import { NextResponse } from "next/server";
import { syncGoogle } from "@/lib/sync/run-google";
import { getServerClient } from "@/lib/supabase/server";

export const maxDuration = 60;

export async function POST(request: Request) {
  const body = (await request.json()) as { integrationId?: string; days?: number; from?: string; to?: string };
  if (!body.integrationId) return NextResponse.json({ error: "integrationId required" }, { status: 400 });
  const supabase = await getServerClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { data: integration } = await supabase.from("integrations").select("id,provider").eq("id", body.integrationId).maybeSingle();
  if (!integration || integration.provider !== "google_ads") return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  try {
    return NextResponse.json({ ok: true, ...(await syncGoogle(integration.id, body)) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Sync failed" }, { status: 500 });
  }
}
