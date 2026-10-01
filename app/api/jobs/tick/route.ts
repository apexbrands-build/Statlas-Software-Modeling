import { after, NextResponse } from "next/server";
import { createJob, kickRunner, requeueStalled } from "@/lib/jobs";
import { getAdminClient } from "@/lib/supabase/server";

export const maxDuration = 60;

// Daily cron (see vercel.json): restarts stalled jobs and queues a recent re-sync for every connection.
// Vercel sends "Authorization: Bearer $CRON_SECRET" when the CRON_SECRET variable is set.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const stalled = await requeueStalled();
  const { data: integrations } = await getAdminClient().from("integrations").select("id").in("provider", ["shopify", "meta", "google_ads"]).eq("status", "connected");
  const started: string[] = [];
  for (const i of integrations ?? []) {
    try {
      const job = await createJob(i.id as string, { kind: "recent" });
      if (!job.alreadyRunning) started.push(job.id);
    } catch {
      /* skip this connection */
    }
  }
  after(async () => {
    for (const id of [...stalled, ...started]) await kickRunner(id);
  });
  return NextResponse.json({ ok: true, resumed: stalled.length, started: started.length });
}
