import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { afterChunk, chunkWindow, failureCount, MAX_PARALLEL_JOBS, onChunkError, selectToKick, shouldCountFailure, type JobRow } from "@/lib/job-plan";
import { getAdminClient } from "@/lib/supabase/server";
import { getSync } from "@/lib/sync/registry";
import { yesterdayLocal } from "@/lib/sync-schedule";

const addDays = (d: string, n: number) => new Date(new Date(`${d}T00:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / 86_400_000) + 1;
/** Each chunk must finish inside one 60-second server task; stop fetching a little before that. */
const CHUNK_BUDGET_MS = 45_000;

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

/** Starts the next chunk as a separate server task (fire and forget). */
export async function kickRunner(jobId: string): Promise<void> {
  const base = process.env.NEXT_PUBLIC_APP_URL;
  if (!base) return;
  try {
    await fetch(`${base}/api/jobs/run`, { method: "POST", headers: { "Content-Type": "application/json", "x-job-sig": signJob(jobId) }, body: JSON.stringify({ jobId }), signal: AbortSignal.timeout(15_000) });
  } catch {
    /* the stalled-job check (daily cron or Resume button) restarts it */
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

export async function createJob(integrationId: string, opts: { months?: number; kind?: "history" | "recent"; reload?: boolean }): Promise<{ id: string; alreadyRunning: boolean }> {
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
      chunk_days: sync.chunkDays,
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
export async function processNextChunk(jobId: string): Promise<{ more: boolean }> {
  const admin = getAdminClient();
  const { data: claimed } = await admin
    .from("sync_jobs")
    .update({ status: "running", heartbeat_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", jobId)
    .eq("status", "queued")
    .select("*")
    .maybeSingle();
  if (!claimed) return { more: false }; // already running elsewhere, finished or cancelled

  const job = claimed as JobRow & { integration_id: string; provider: string; first_chunk: boolean };
  const window = chunkWindow(job);

  try {
    const sync = getSync(job.provider);
    if (!sync) throw new Error(`No sync for ${job.provider}`);
    await sync.sync(job.integration_id, window, { kind: job.kind, deadline: Date.now() + CHUNK_BUDGET_MS, firstChunk: job.first_chunk });

    const next = afterChunk(job, window);
    if (next.finished) await sync.finalize?.(job.integration_id, { from: job.from_date, to: job.to_date });
    await admin
      .from("sync_jobs")
      .update({
        status: next.finished ? "done" : "queued",
        cursor_end: next.cursorEnd,
        done_days: next.doneDays,
        first_chunk: false,
        attempts: 0,
        message: next.message,
        heartbeat_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", job.id);
    if (next.finished) await recordOutcome(job.integration_id, job.kind, "ok");
    return { more: !next.finished };
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

/** Jobs marked running whose last heartbeat is old (a task was cut off): put them back in the queue. */
export async function requeueStalled(): Promise<string[]> {
  const admin = getAdminClient();
  const cutoff = new Date(Date.now() - 3 * 60_000).toISOString();
  const { data } = await admin.from("sync_jobs").update({ status: "queued", updated_at: new Date().toISOString() }).eq("status", "running").lt("heartbeat_at", cutoff).select("id");
  return (data ?? []).map((j) => j.id as string);
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
