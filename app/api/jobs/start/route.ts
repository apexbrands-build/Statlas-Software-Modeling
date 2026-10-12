import { after, NextResponse } from "next/server";
import { createJob, kickRunner, NothingToSyncError } from "@/lib/jobs";
import { getServerClient } from "@/lib/supabase/server";

export const maxDuration = 30;

// Starts a background job (history load or recent sync). The browser only watches its progress.
export async function POST(request: Request) {
  const body = (await request.json()) as { integrationId?: string; months?: number; kind?: "history" | "recent" };
  if (!body.integrationId) return NextResponse.json({ error: "integrationId required" }, { status: 400 });
  const supabase = await getServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { data: integration } = await supabase.from("integrations").select("id").eq("id", body.integrationId).maybeSingle();
  if (!integration) return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  try {
    const job = await createJob(integration.id, { months: body.months, kind: body.kind });
    if (!job.alreadyRunning) after(() => kickRunner(job.id));
    return NextResponse.json({ ok: true, ...job });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not start" }, { status: e instanceof NothingToSyncError ? 400 : 500 });
  }
}
