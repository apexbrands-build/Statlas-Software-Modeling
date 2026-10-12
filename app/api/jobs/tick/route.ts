import { after, NextResponse } from "next/server";
import { createJob, kickRunner, kickWaitingJobs, requeueStalled } from "@/lib/jobs";
import { FAILURE_ALERT_AT } from "@/lib/providers";
import { getAdminClient } from "@/lib/supabase/server";
import { syncableProviderIds } from "@/lib/sync/registry";

export const maxDuration = 60;

// Daily cron (see vercel.json): restarts stalled jobs and queues a recent re-sync for every connection whose provider has a sync.
// Connections in "error" are retried too: a transient failure heals itself, and a persistent one raises the failure count behind "Needs attention".
// Jobs are started at most MAX_PARALLEL_JOBS at a time; each finished job starts the next waiting one.
// Vercel sends "Authorization: Bearer $CRON_SECRET" when the CRON_SECRET variable is set.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = getAdminClient();
  const stalled = await requeueStalled();
  const { data: integrations } = await admin.from("integrations").select("id").in("provider", syncableProviderIds()).in("status", ["connected", "error"]);
  let queued = 0;
  for (const i of integrations ?? []) {
    try {
      const job = await createJob(i.id as string, { kind: "recent" });
      if (!job.alreadyRunning) queued++;
    } catch {
      /* skip this connection */
    }
  }
  const { count: failing } = await admin.from("integrations").select("id", { count: "exact", head: true }).gte("consecutive_failures", FAILURE_ALERT_AT);
  after(async () => {
    for (const id of stalled) await kickRunner(id);
    await kickWaitingJobs();
  });
  return NextResponse.json({ ok: true, resumed: stalled.length, started: queued, failing: failing ?? 0 });
}
