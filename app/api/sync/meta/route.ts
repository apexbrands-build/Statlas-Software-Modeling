import { NextResponse } from "next/server";
import { syncMeta } from "@/lib/sync/run-meta";
import { getServerClient } from "@/lib/supabase/server";

export const maxDuration = 60;

// Manual "Sync now" for a Meta connection. The user must have access to the client (row-level security).
export async function POST(request: Request) {
  const body = (await request.json()) as { integrationId?: string; days?: number; from?: string; to?: string };
  if (!body.integrationId) return NextResponse.json({ error: "integrationId required" }, { status: 400 });

  const supabase = await getServerClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { data: integration } = await supabase.from("integrations").select("id,provider").eq("id", body.integrationId).maybeSingle();
  if (!integration || integration.provider !== "meta") return NextResponse.json({ error: "Connection not found" }, { status: 404 });

  try {
    // The task is cut at maxDuration: stop reading ad-level pages a little earlier and say so instead of dying half way.
    const result = await syncMeta(integration.id, body, { deadline: Date.now() + 45_000 });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Sync failed" }, { status: 500 });
  }
}
