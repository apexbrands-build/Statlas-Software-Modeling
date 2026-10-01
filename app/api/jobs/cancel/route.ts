import { NextResponse } from "next/server";
import { getAdminClient, getServerClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const { jobId } = (await request.json()) as { jobId?: string };
  if (!jobId) return NextResponse.json({ error: "jobId required" }, { status: 400 });
  const supabase = await getServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { data: job } = await supabase.from("sync_jobs").select("id").eq("id", jobId).maybeSingle();
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
  await getAdminClient().from("sync_jobs").update({ status: "cancelled", message: "Stopped. Data loaded so far is kept.", updated_at: new Date().toISOString() }).eq("id", jobId).in("status", ["queued", "running"]);
  return NextResponse.json({ ok: true });
}
