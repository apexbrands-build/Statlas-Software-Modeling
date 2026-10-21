import { after, NextResponse } from "next/server";
import { createJob, findIdleQueued, kickRunner, kickWaitingJobs, requeueStalled } from "@/lib/jobs";
import { FAILURE_ALERT_AT } from "@/lib/providers";
import { getAdminClient } from "@/lib/supabase/server";
import { syncableProviderIds } from "@/lib/sync/registry";
import { dailySyncDue, validTimeZone, type RecentJob } from "@/lib/sync-schedule";

export const maxDuration = 60;

// Hourly tick (see vercel.json): restarts stalled jobs and starts each connection's daily sync when its store's day has rolled over.
// "Rolled over" is in the store's own time zone (clients.timezone): a store in New York gets its sync shortly after 00:00 New York time, one in
// Sydney shortly after 00:00 Sydney time, so no store waits for a fixed UTC hour and each day's data is loaded once its day is complete.
// Connections in "error" are retried (after RETRY_AFTER_HOURS): a transient failure heals itself, and a persistent one raises the failure count behind "Needs attention".
// Jobs are started at most MAX_PARALLEL_JOBS at a time; each finished job starts the next waiting one.
// Vercel sends "Authorization: Bearer $CRON_SECRET" when the CRON_SECRET variable is set.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = getAdminClient();
  const now = new Date();
  const stalled = [...new Set([...(await requeueStalled()), ...(await findIdleQueued())])];
  const { data: integrations } = await admin.from("integrations").select("id,client_id").in("provider", syncableProviderIds()).in("status", ["connected", "error"]);
  const { data: clients } = await admin.from("clients").select("id,timezone");
  const tzOf = new Map((clients ?? []).map((c) => [c.id as string, c.timezone as string | null]));
  const { data: recent } = await admin
    .from("sync_jobs")
    .select("integration_id,status,created_at")
    .eq("kind", "recent")
    .gte("created_at", new Date(now.getTime() - 48 * 3_600_000).toISOString());
  const jobsOf = new Map<string, RecentJob[]>();
  for (const j of recent ?? []) {
    const list = jobsOf.get(j.integration_id as string) ?? [];
    list.push({ createdAt: new Date(j.created_at as string), status: j.status as RecentJob["status"] });
    jobsOf.set(j.integration_id as string, list);
  }
  let queued = 0;
  let notDue = 0;
  for (const i of integrations ?? []) {
    if (!dailySyncDue(now, validTimeZone(tzOf.get(i.client_id as string)), jobsOf.get(i.id as string) ?? [])) {
      notDue++;
      continue;
    }
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
  return NextResponse.json({ ok: true, resumed: stalled.length, started: queued, notDue, failing: failing ?? 0 });
}
