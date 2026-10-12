import { PlatformError, requestJson, type RequestOptions } from "./http";

type Extra = Pick<RequestOptions, "retries" | "sleep" | "timeoutMs">;

/**
 * Checks an Omnisend API key with one read-only call (the first contact). Omnisend has no account-info endpoint,
 * so the connection is named with the brand name the strategist typed.
 */
export async function verifyOmnisend(input: { accountId: string; apiKey?: string }, fetchImpl?: typeof fetch, extra: Extra = {}): Promise<{ accountName: string }> {
  const apiKey = input.apiKey?.trim();
  if (!apiKey) throw new Error("API key is required");
  try {
    await requestJson("https://api.omnisend.com/v5/contacts?limit=1", { headers: { "X-API-KEY": apiKey, accept: "application/json" } }, { platform: "Omnisend", secret: apiKey, fetchImpl, ...extra });
    return { accountName: input.accountId.trim() };
  } catch (e) {
    if (e instanceof PlatformError && (e.kind === "rejected" || e.kind === "forbidden")) throw new Error("Omnisend rejected the API key. Create one under Store settings, Integrations and API, API keys.");
    throw e;
  }
}
