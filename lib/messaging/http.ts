import { redact } from "../connect";

/** Why a call to a messaging platform failed, in terms the strategist can act on. */
export type PlatformErrorKind = "rejected" | "forbidden" | "rate_limited" | "unavailable" | "bad_response";

export class PlatformError extends Error {
  constructor(
    public kind: PlatformErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "PlatformError";
  }
}

export interface RequestOptions {
  /** Shown in messages: "Klaviyo". */
  platform: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** Extra attempts after the first for 429, 5xx and network failures. Default 2. */
  retries?: number;
  sleep?: (ms: number) => Promise<void>;
  /** The API key: removed from any message. */
  secret?: string;
}

const BACKOFF_MS = [1000, 3000];
const MAX_WAIT_MS = 30000;
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * One JSON request to a platform. A wrong key or a missing permission fails at once; rate limits (honouring Retry-After), server errors,
 * timeouts and network failures are retried a couple of times. Every error is a PlatformError whose message names the platform and never holds the key.
 */
export async function requestJson(url: string, init: { headers: Record<string, string>; method?: string; body?: string }, o: RequestOptions): Promise<{ status: number; json: unknown }> {
  const { platform, secret } = o;
  const fetchImpl = o.fetchImpl ?? fetch;
  const sleep = o.sleep ?? wait;
  const retries = o.retries ?? 2;
  const safe = (text: string) => redact(text, secret);

  let last: PlatformError | null = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), o.timeoutMs ?? 15000);
    let res: Response;
    try {
      res = await fetchImpl(url, { ...init, signal: controller.signal });
    } catch (e) {
      const why = controller.signal.aborted ? "took too long to answer" : safe(e instanceof Error ? e.message : "no answer");
      last = new PlatformError("unavailable", `${platform} did not answer (${why}). Try again in a few minutes.`);
      if (attempt < retries) await sleep(BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)]);
      continue;
    } finally {
      clearTimeout(timer);
    }

    if (res.status === 401) throw new PlatformError("rejected", `${platform} rejected the API key.`);
    if (res.status === 403) throw new PlatformError("forbidden", `${platform} refused the request: the key is missing a permission.`);
    if (res.status === 429) {
      last = new PlatformError("rate_limited", `${platform} is limiting requests right now. Try again in a minute.`);
      if (attempt < retries) {
        const seconds = Number(res.headers.get("Retry-After"));
        await sleep(Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds * 1000, MAX_WAIT_MS) : BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)]);
      }
      continue;
    }
    if (res.status >= 500) {
      last = new PlatformError("unavailable", `${platform} is having problems (HTTP ${res.status}). Try again in a few minutes.`);
      if (attempt < retries) await sleep(BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)]);
      continue;
    }
    if (res.status < 200 || res.status >= 300) throw new PlatformError("bad_response", `${platform} returned an unexpected answer (HTTP ${res.status}).`);
    try {
      return { status: res.status, json: await res.json() };
    } catch {
      throw new PlatformError("bad_response", `${platform} returned an answer that is not readable (HTTP ${res.status}).`);
    }
  }
  throw last ?? new PlatformError("unavailable", `${platform} did not answer.`);
}
