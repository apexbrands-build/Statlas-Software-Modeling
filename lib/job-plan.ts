/** Pure decisions behind the background sync jobs (no database, no server imports) so they can be unit tested. `lib/jobs.ts` applies them. */

/** At most this many sync jobs run at once; the rest wait until a running job finishes. */
export const MAX_PARALLEL_JOBS = 10;

export interface JobRow {
  id: string;
  kind: "history" | "recent";
  from_date: string;
  to_date: string;
  cursor_end: string;
  chunk_days: number;
  total_days: number;
  done_days: number;
  attempts: number;
  /** What the job pulls: everything, campaign-level spend only, or ad-level data only. Missing = "all". */
  scope?: JobScope;
}

export type JobScope = "all" | "campaign" | "ads";

interface Window {
  from: string;
  to: string;
}

const addDays = (d: string, n: number) => new Date(new Date(`${d}T00:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);
/** Inclusive number of days from a to b. */
const daysBetween = (a: string, b: string) => Math.round((new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / 86_400_000) + 1;

/** The days one chunk covers: chunk_days ending at the cursor, never before the job's first day. */
export function chunkWindow(job: Pick<JobRow, "cursor_end" | "chunk_days" | "from_date">): Window {
  const to = job.cursor_end;
  const start = addDays(to, -(job.chunk_days - 1));
  return { from: start < job.from_date ? job.from_date : start, to };
}

/** Job state after a chunk loaded successfully. */
export function afterChunk(job: JobRow, window: Window): { finished: boolean; cursorEnd: string; doneDays: number; message: string } {
  const nextEnd = addDays(window.from, -1);
  const finished = nextEnd < job.from_date;
  return {
    finished,
    cursorEnd: finished ? job.from_date : nextEnd,
    doneDays: Math.min(job.total_days, job.done_days + daysBetween(window.from, window.to)),
    message: finished ? "Done" : `Loaded ${window.from} → ${window.to}`,
  };
}

/** A busy period (e.g. Black Friday) may not fit in one task: halve the chunk and retry the same days, up to 8 times. */
export function onChunkError(
  job: Pick<JobRow, "chunk_days" | "attempts">,
  message: string,
  window: Window,
): { retry: true; chunkDays: number; attempts: number; message: string } | { retry: false; message: string } {
  if (job.chunk_days > 1 && job.attempts < 8) {
    return {
      retry: true,
      chunkDays: Math.ceil(job.chunk_days / 2),
      attempts: job.attempts + 1,
      message: `Retrying ${window.from} → ${window.to} in smaller pieces (${message.slice(0, 80)})`,
    };
  }
  return { retry: false, message: message.slice(0, 300) };
}

/** New value of `integrations.consecutive_failures`: +1 on error, back to 0 on success. */
export function failureCount(previous: number | null | undefined, outcome: "ok" | "error"): number {
  return outcome === "ok" ? 0 : (previous ?? 0) + 1;
}

/** Only the daily "recent" sync counts toward "Needs attention"; a long history load failing does not. */
export function shouldCountFailure(kind: JobRow["kind"]): boolean {
  return kind === "recent";
}

/** Which waiting jobs to start now: only as many as there are free slots. */
export function selectToKick(waiting: string[], running: number, max: number = MAX_PARALLEL_JOBS): string[] {
  return waiting.slice(0, Math.max(0, max - running));
}

/** A chunk that finished in less than this share of its time budget leaves room for a bigger one next time. */
export const FAST_CHUNK_SHARE = 0.4;

/**
 * Chunk size for the next chunk. A chunk that had to be halved (timeout) used to stay small for the whole job; now a chunk that finished
 * without a retry and well inside its budget doubles the size again, up to the provider's maximum. A slow chunk keeps its size, so a heavy
 * period cannot flip between "too big" and "fits".
 */
export function nextChunkDays(current: number, max: number, elapsedMs: number, budgetMs: number, attempts = 0): number {
  if (current >= max) return max;
  if (attempts > 0 || elapsedMs > budgetMs * FAST_CHUNK_SHARE) return current;
  return Math.min(max, current * 2);
}

/** The ad-level load after a campaign-level history load covers at most this many days (13 months, as the creative model needs). */
export const ADS_HISTORY_DAYS = 395;

/** A queued job nobody has picked up for this long lost its start signal (the next-chunk call failed); it is started again. */
export const IDLE_QUEUED_MS = 2 * 60_000;
/** A running job whose last heartbeat is older than this was cut off (a task lasts at most 5 minutes). */
export const STALLED_RUNNING_MS = 7 * 60_000;
