import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { getAdminClient } from "@/lib/supabase/server";
import { syncGoogle } from "@/lib/sync/run-google";
import { syncMeta } from "@/lib/sync/run-meta";
import { finalizeShopify, syncShopify } from "@/lib/sync/run-shopify";

const addDays = (d: string, n: number) => new Date(new Date(`${d}T00:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / 86_400_000) + 1;
const CHUNK_DAYS: Record<string, number> = { shopify: 14, meta: 60, google_ads: 60 };
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

export async function createJob(integrationId: string, opts: { months?: number; kind?: "history" | "recent" }): Promise<{ id: string; alreadyRunning: boolean }> {
  const admin = getAdminClient();
  const { data: integration } = await admin.from("integrations").select("id,client_id,provider,coverage_start").eq("id", integrationId).single();
  if (!integration) throw new Error("Connection not found");

  const { data: active } = await admin.from("sync_jobs").select("id").eq("integration_id", integrationId).in("status", ["queued", "running"]).limit(1);
  if (active && active.length > 0) return { id: active[0].id as string, alreadyRunning: true };

  const yesterday = addDays(new Date().toISOString().slice(0, 10), -1);
  const kind = opts.kind ?? "history";
  const from = kind === "recent" ? addDays(yesterday, -13) : addDays(yesterday, -(Math.min(Math.max(opts.months ?? 12, 1), 48) * 30));
  // Resume: history already loaded (coverage runs from its start date to yesterday) is skipped.
  const cursorEnd = kind === "history" && integration.coverage_start && integration.coverage_start > from && integration.coverage_start <= yesterday ? addDays(integration.coverage_start, -1) : yesterday;
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
      chunk_days: CHUNK_DAYS[integration.provider as string] ?? 30,
      total_days: daysBetween(from, yesterday),
      done_days: daysBetween(from, yesterday) - (done ? 0 : daysBetween(from, cursorEnd)),
      message: done ? "Already loaded" : null,
    })
    .select("id")
    .single();
  if (error || !job) throw new Error("Could not create job");
  return { id: job.id as string, alreadyRunning: false };
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

  const job = claimed as {
    id: string; integration_id: string; provider: string; kind: string; from_date: string; to_date: string;
    cursor_end: string; chunk_days: number; first_chunk: boolean; total_days: number; done_days: number; attempts: number;
  };
  const chunkTo = job.cursor_end;
  const chunkFrom = addDays(chunkTo, -(job.chunk_days - 1)) < job.from_date ? job.from_date : addDays(chunkTo, -(job.chunk_days - 1));

  try {
    const body = { from: chunkFrom, to: chunkTo };
    if (job.provider === "shopify") {
      await syncShopify(job.integration_id, { body, products: job.first_chunk || job.kind === "recent", includeUpdated: job.kind === "recent", deadline: Date.now() + CHUNK_BUDGET_MS });
    } else if (job.provider === "meta") {
      await syncMeta(job.integration_id, body);
    } else if (job.provider === "google_ads") {
      await syncGoogle(job.integration_id, body);
    } else {
      throw new Error(`No sync for ${job.provider}`);
    }

    const nextEnd = addDays(chunkFrom, -1);
    const finished = nextEnd < job.from_date;
    if (finished && job.provider === "shopify") await finalizeShopify(job.integration_id, { from: job.from_date, to: job.to_date });
    await admin
      .from("sync_jobs")
      .update({
        status: finished ? "done" : "queued",
        cursor_end: finished ? job.from_date : nextEnd,
        done_days: Math.min(job.total_days, job.done_days + daysBetween(chunkFrom, chunkTo)),
        first_chunk: false,
        attempts: 0,
        message: finished ? "Done" : `Loaded ${chunkFrom} → ${chunkTo}`,
        heartbeat_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", job.id);
    return { more: !finished };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Sync failed";
    // A busy period (e.g. Black Friday) may not fit in one task: halve the chunk and try the same days again.
    if (job.chunk_days > 1 && job.attempts < 8) {
      await admin.from("sync_jobs").update({ status: "queued", chunk_days: Math.ceil(job.chunk_days / 2), attempts: job.attempts + 1, message: `Retrying ${chunkFrom} → ${chunkTo} in smaller pieces (${message.slice(0, 80)})`, heartbeat_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", job.id);
      return { more: true };
    }
    await admin.from("sync_jobs").update({ status: "error", message: message.slice(0, 300), updated_at: new Date().toISOString() }).eq("id", job.id);
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
