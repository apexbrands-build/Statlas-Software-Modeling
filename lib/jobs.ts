import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { ADS_HISTORY_DAYS, afterChunk, chunkWindow, failureCount, IDLE_QUEUED_MS, MAX_PARALLEL_JOBS, nextChunkDays, onChunkError, selectToKick, shouldCountFailure, STALLED_RUNNING_MS, type JobRow, type JobScope } from "@/lib/job-plan";
import { getAdminClient } from "@/lib/supabase/server";
import { getSync } from "@/lib/sync/registry";
import { yesterdayLocal } from "@/lib/sync-schedule";

const addDays = (d: string, n: number) => new Date(new Date(`${d}T00:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / 86_400_000) + 1;
/** Each chunk must finish inside one server task (`maxDuration` 300 s on Vercel with Fluid compute); stop fetching a minute before that. */
const CHUNK_BUDGET_MS = 240_000;

/* ---------- signing: the runner calls itself with a signature, so no extra secret is needed ---------- */

function secret(): string {
  const s = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!s) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
  return s;
}
export const signJob = (jobId: string) => createHmac("sha256", secret()).update(`job:${jobId}`).digest("hex");
export function verifyJobSignature(jobId: string, sig: string | null): boolean {
  if (!sig) return false;
  const a = Buffer.from(signJob(jobId));
  const b = Buffer.from(sig);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Starts the next chunk as a separate server task. The call is tried up to three times (waiting 1 s, then 3 s): a lost start signal used to leave the
 * job queued until the hourly check or the Resume button, which is why long loads ran in bursts. If all three fail the idle-job check still restarts it.
 */
export async function kickRunner(jobId: string): Promise<void> {
  const base = process.env.NEXT_PUBLIC_APP_URL;
  if (!base) return;
  const waits = [1000, 3000];
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(`${base}/api/jobs/run`, { method: "POST", headers: { "Content-Type": "application/json", "x-job-sig": signJob(jobId) }, body: JSON.stringify({ jobId }), signal: AbortSignal.timeout(15_000) });
      if (res.ok) return;
    } catch {
      /* try again */
    }
    if (attempt >= waits.length) return;
    await new Promise((r) => setTimeout(r, waits[attempt]));
  }
}

/* ---------- creating jobs ---------- */

/** A connection whose provider only checks and saves its key has no data to pull, so no job may be queued for it. */
export class NothingToSyncError extends Error {
  constructor() {
    super("This connection has nothing to sync yet");
    this.name = "NothingToSyncError";
  }
}

export async function createJob(integrationId: string, opts: { months?: number; kind?: "history" | "recent"; reload?: boolean; scope?: JobScope }): Promise<{ id: string; alreadyRunning: boolean }> {
  const admin = getAdminClient();
  const { data: integration } = await admin.from("integrations").select("id,client_id,provider,coverage_start").eq("id", integrationId).single();
  if (!integration) throw new Error("Connection not found");
  const sync = getSync(integration.provider as string);
  if (!sync) throw new NothingToSyncError();

  const { data: active } = await admin.from("sync_jobs").select("id").eq("integration_id", integrationId).in("status", ["queued", "running"]).limit(1);
  if (active && active.length > 0) {
    // A reload replaces whatever is still queued or running (a stuck job would otherwise swallow the click and nothing would start).
    if (!opts.reload) return { id: active[0].id as string, alreadyRunning: true };
    await admin.from("sync_jobs").update({ status: "cancelled", message: "Stopped. Replaced by a full reload.", updated_at: new Date().toISOString() }).in("id", active.map((j) => j.id as string));
  }

  // "Yesterday" is the store's last complete day in its own time zone (clients.timezone), not UTC's.
  const { data: client } = await admin.from("clients").select("timezone").eq("id", integration.client_id).single();
  const yesterday = yesterdayLocal(new Date(), (client?.timezone as string | undefined) ?? "UTC");
  const kind = opts.kind ?? "history";
  // A history load of a provider with heavy ad-level data runs campaign-level first and queues the ad-level load itself when that ends.
  const scope: JobScope = opts.scope ?? (kind === "history" && sync.adsAfterCampaign ? "campaign" : "all");
  const from = kind === "recent" ? addDays(yesterday, -13) : addDays(yesterday, -(Math.min(Math.max(opts.months ?? 12, 1), 48) * 30));
  // Resume: history already loaded (coverage runs from its start date to yesterday) is skipped, unless `reload` asks for the whole range again
  // (needed when something besides the covered days changed, e.g. ad-level Meta data that failed while the campaign rows loaded fine).
  const cursorEnd = kind === "history" && !opts.reload && integration.coverage_start && integration.coverage_start > from && integration.coverage_start <= yesterday ? addDays(integration.coverage_start, -1) : yesterday;
  const done = cursorEnd < from;

  const { data: job, error } = await admin
    .from("sync_jobs")
    .insert({
      client_id: integration.client_id,
      integration_id: integrationId,
      provider: integration.provider,
      kind,
      status: done ? "done" : "queued",
      from_date: from,
      to_date: yesterday,
      cursor_end: done ? from : cursorEnd,
      chunk_days: scope === "ads" ? (sync.adsChunkDays ?? sync.chunkDays) : sync.chunkDays,
      scope,
      total_days: daysBetween(from, yesterday),
      done_days: daysBetween(from, yesterday) - (done ? 0 : daysBetween(from, cursorEnd)),
      message: done ? "Already loaded" : null,
    })
    .select("id")
    .single();
  if (error || !job) throw new Error("Could not create job");
  return { id: job.id as string, alreadyRunning: false };
}

/* ---------- connection health ---------- */

/** Updates `integrations.consecutive_failures` after a daily "recent" job ends. Best effort: it runs inside the chunk's try block, so it must never throw. */
async function recordOutcome(integrationId: string, kind: JobRow["kind"], outcome: "ok" | "error"): Promise<void> {
  if (!shouldCountFailure(kind)) return;
  try {
    const admin = getAdminClient();
    const { data } = await admin.from("integrations").select("consecutive_failures").eq("id", integrationId).maybeSingle();
    if (!data) return; // connection removed while the job ran
    await admin.from("integrations").update({ consecutive_failures: failureCount(data.consecutive_failures as number | null, outcome) }).eq("id", integrationId);
  } catch {
    /* a counter problem must not fail or re-queue a sync job */
  }
}

/* ---------- running one chunk ---------- */

/** Claims a queued job, processes ONE chunk, and reports whether more work remains. */
export async function processNextChunk(jobId: string): Promise<{ more: boolean; nextJobId?: string }> {
  const admin = getAdminClient();
  const { data: claimed } = await admin
    .from("sync_jobs")
    .update({ status: "running", heartbeat_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", jobId)
    .eq("status", "queued")
    .select("*")
    .maybeSingle();
  if (!claimed) return { more: false }; // already running elsewhere, finished or cancelled

  const job = claimed as JobRow & { integration_id: string; client_id: string; provider: string; first_chunk: boolean };
  const window = chunkWindow(job);
  const scope: JobScope = job.scope ?? "all";

  try {
    const sync = getSync(job.provider);
    if (!sync) throw new Error(`No sync for ${job.provider}`);
    const startedAt = Date.now();
    await sync.sync(job.integration_id, window, { kind: job.kind, deadline: startedAt + CHUNK_BUDGET_MS, firstChunk: job.first_chunk, scope });
    const elapsed = Date.now() - startedAt;

    const next = afterChunk(job, window);
    if (next.finished) await sync.finalize?.(job.integration_id, { from: job.from_date, to: job.to_date });
    const maxChunk = scope === "ads" ? (sync.adsChunkDays ?? sync.chunkDays) : sync.chunkDays;
    await admin
      .from("sync_jobs")
      .update({
        status: next.finished ? "done" : "queued",
        cursor_end: next.cursorEnd,
        done_days: next.doneDays,
        chunk_days: nextChunkDays(job.chunk_days, maxChunk, elapsed, CHUNK_BUDGET_MS, job.attempts),
        first_chunk: false,
        attempts: 0,
        message: scope === "ads" ? `Ad-level data: ${next.message}` : next.message,
        heartbeat_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", job.id);
    if (next.finished) await recordOutcome(job.integration_id, job.kind, "ok");
    // The campaign-level history load is over: queue the ad-level load (creative data, the heavy part) as its own job.
    let nextJobId: string | undefined;
    if (next.finished && scope === "campaign" && sync.adsAfterCampaign) nextJobId = await queueAdsJob(job, sync.adsChunkDays ?? sync.chunkDays);
    return { more: !next.finished, nextJobId };
  } catch (e) {
    const failure = onChunkError(job, e instanceof Error ? e.message : "Sync failed", window);
    if (failure.retry) {
      await admin.from("sync_jobs").update({ status: "queued", chunk_days: failure.chunkDays, attempts: failure.attempts, message: failure.message, heartbeat_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", job.id);
      return { more: true };
    }
    await admin.from("sync_jobs").update({ status: "error", message: failure.message, updated_at: new Date().toISOString() }).eq("id", job.id);
    await recordOutcome(job.integration_id, job.kind, "error");
    return { more: false };
  }
}

/** Queues the ad-level load that follows a campaign-level history load: the same dates, capped at the last 13 months, unless one is already waiting or running. */
async function queueAdsJob(job: JobRow & { integration_id: string; client_id: string; provider: string }, chunkDays: number): Promise<string | undefined> {
  const admin = getAdminClient();
  const { data: active } = await admin.from("sync_jobs").select("id").eq("integration_id", job.integration_id).eq("scope", "ads").in("status", ["queued", "running"]).limit(1);
  if (active && active.length > 0) return undefined;
  const earliest = addDays(job.to_date, -(ADS_HISTORY_DAYS - 1));
  const from = job.from_date > earliest ? job.from_date : earliest;
  const total = daysBetween(from, job.to_date);
  const { data, error } = await admin
    .from("sync_jobs")
    .insert({ client_id: job.client_id, integration_id: job.integration_id, provider: job.provider, kind: "history", scope: "ads", status: "queued", from_date: from, to_date: job.to_date, cursor_end: job.to_date, chunk_days: chunkDays, total_days: total, done_days: 0, message: "Ad-level data queued" })
    .select("id")
    .single();
  return error || !data ? undefined : (data.id as string);
}

/** Jobs marked running whose last heartbeat is old (a task was cut off): put them back in the queue. */
export async function requeueStalled(): Promise<string[]> {
  const admin = getAdminClient();
  const cutoff = new Date(Date.now() - STALLED_RUNNING_MS).toISOString();
  const { data } = await admin.from("sync_jobs").update({ status: "queued", updated_at: new Date().toISOString() }).eq("status", "running").lt("heartbeat_at", cutoff).select("id");
  return (data ?? []).map((j) => j.id as string);
}

/** Queued jobs, already begun, that nobody has touched for a couple of minutes: their start signal was lost. */
export async function findIdleQueued(): Promise<string[]> {
  const admin = getAdminClient();
  const cutoff = new Date(Date.now() - IDLE_QUEUED_MS).toISOString();
  const { data } = await admin.from("sync_jobs").select("id").eq("status", "queued").eq("first_chunk", false).lt("updated_at", cutoff).limit(20);
  return (data ?? []).map((j) => j.id as string);
}

/** Restarts every job whose chain broke (stalled while running, or queued with no start signal). Safe to call often: a chunk is claimed by one task only. */
export async function healJobs(): Promise<string[]> {
  const ids = [...new Set([...(await requeueStalled()), ...(await findIdleQueued())])];
  await Promise.all(ids.map((id) => kickRunner(id)));
  return ids;
}

/** Starts the oldest jobs that have not begun yet, up to the free slots (MAX_PARALLEL_JOBS minus the jobs running now). Returns the ids it started. */
export async function kickWaitingJobs(): Promise<string[]> {
  const admin = getAdminClient();
  const { count } = await admin.from("sync_jobs").select("id", { count: "exact", head: true }).eq("status", "running");
  const { data } = await admin.from("sync_jobs").select("id").eq("status", "queued").eq("first_chunk", true).order("created_at", { ascending: true }).limit(MAX_PARALLEL_JOBS);
  const ids = selectToKick((data ?? []).map((j) => j.id as string), count ?? 0);
  await Promise.all(ids.map((id) => kickRunner(id)));
  return ids;
}
