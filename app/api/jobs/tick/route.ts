import { after, NextResponse } from "next/server";
import { createJob, findIdleQueued, kickRunner, kickWaitingJobs, requeueStalled } from "@/lib/jobs";
import { FAILURE_ALERT_AT } from "@/lib/providers";
import { getAdminClient } from "@/lib/supabase/server";
import { syncableProviderIds } from "@/lib/sync/registry";
import { syncShopify } from "@/lib/sync/run-shopify";
import { dailySyncDue, validTimeZone, type RecentJob } from "@/lib/sync-schedule";
import { planTodayPulls, pullSummary, runPulls, TODAY_PULL_BUDGET_MS, TODAY_PULL_FETCH_MS, type PullConnection, type TodayPullPlan } from "@/lib/today-pull";

// The answer goes out in a second or two; the time is for the pulls of today's orders that run after it (they stop starting at TODAY_PULL_BUDGET_MS).
export const maxDuration = 300;

// Hourly tick (see vercel.json): restarts stalled jobs and starts each connection's daily sync when its store's day has rolled over.
// "Rolled over" is in the store's own time zone (clients.timezone): a store in New York gets its sync shortly after 00:00 New York time, one in
// Sydney shortly after 00:00 Sydney time, so no store waits for a fixed UTC hour and each day's data is loaded once its day is complete.
// Connections in "error" are retried (after RETRY_AFTER_HOURS): a transient failure heals itself, and a persistent one raises the failure count behind "Needs attention".
// Jobs are started at most MAX_PARALLEL_JOBS at a time; each finished job starts the next waiting one.
// Every tick also pulls today's orders for each Shopify store it keeps syncing that has no sync job queued or running (the Hourly report
// reads them); see lib/today-pull.ts. A pull is not a job: it never changes a connection's status or failure count, nor when its daily sync is due.
// Setting TODAY_ORDERS_PULL=off turns the pulls off without touching the daily syncs.
// Vercel sends "Authorization: Bearer $CRON_SECRET" when the CRON_SECRET variable is set.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = getAdminClient();
  const now = new Date();
  const tickStartedMs = Date.now();
  const stalled = [...new Set([...(await requeueStalled()), ...(await findIdleQueued())])];
  const { data: integrations } = await admin.from("integrations").select("id,client_id,provider,status").in("provider", syncableProviderIds()).in("status", ["connected", "error"]);
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
  // Planned after the daily jobs above were queued, so a store whose daily sync starts on this tick is left to that sync.
  const today = await todayPullPlan(now, (integrations ?? []).map((i) => ({ id: i.id as string, provider: i.provider as string, status: i.status as string })));
  after(async () => {
    try {
      for (const id of stalled) await kickRunner(id);
      await kickWaitingJobs();
    } finally {
      await pullTodayOrders(today.pull, tickStartedMs);
    }
  });
  return NextResponse.json({ ok: true, resumed: stalled.length, started: queued, notDue, failing: failing ?? 0, todayPulls: today.pull.length });
}

/**
 * Which stores get today's orders pulled on this tick (see `planTodayPulls`). When the jobs or the recent runs cannot be read the answer is
 * none: a pull must not run blind next to a sync job.
 */
async function todayPullPlan(now: Date, connections: PullConnection[]): Promise<TodayPullPlan> {
  const none: TodayPullPlan = { pull: [], busy: 0, inFlight: 0 };
  if (process.env.TODAY_ORDERS_PULL === "off") return none;
  try {
    const admin = getAdminClient();
    const [jobs, runs] = await Promise.all([
      admin.from("sync_jobs").select("integration_id").in("status", ["queued", "running"]),
      admin
        .from("sync_runs")
        .select("integration_id,status,started_at")
        .eq("provider", "shopify")
        .gte("started_at", new Date(now.getTime() - 6 * 3_600_000).toISOString())
        .order("started_at", { ascending: false })
        .limit(1000),
    ]);
    if (jobs.error || runs.error || !jobs.data || !runs.data) return none;
    return planTodayPulls({
      now,
      connections,
      busyIds: jobs.data.map((j) => j.integration_id as string),
      runs: runs.data.filter((r) => r.integration_id).map((r) => ({ integrationId: r.integration_id as string, status: r.status as string, startedAt: new Date(r.started_at as string) })),
    });
  } catch {
    return none;
  }
}

/** Pulls today's orders store by store, a few at a time, inside the tick's time budget. Never throws: one store failing leaves the others alone. */
async function pullTodayOrders(ids: string[], tickStartedMs: number): Promise<void> {
  if (ids.length === 0) return;
  try {
    const results = await runPulls(ids, {
      mayStart: () => Date.now() - tickStartedMs < TODAY_PULL_BUDGET_MS,
      pull: (id) => syncShopify(id, { body: {}, todayPull: true, deadline: Date.now() + TODAY_PULL_FETCH_MS }),
    });
    console.info(`[tick] ${pullSummary(results)}`);
  } catch (e) {
    console.error("[tick] today's orders: could not run the pulls", e);
  }
}
