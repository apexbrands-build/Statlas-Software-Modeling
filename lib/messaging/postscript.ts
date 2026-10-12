import { PlatformError, requestJson, type RequestOptions } from "./http";

type Extra = Pick<RequestOptions, "retries" | "sleep" | "timeoutMs">;

/**
 * Checks a Postscript Private API key with one read-only call (the first subscriber). Postscript has no account-info endpoint,
 * so the connection is named with the shop name the strategist typed.
 */
export async function verifyPostscript(input: { accountId: string; apiKey?: string }, fetchImpl?: typeof fetch, extra: Extra = {}): Promise<{ accountName: string }> {
  const apiKey = input.apiKey?.trim();
  if (!apiKey) throw new Error("API key is required");
  try {
    await requestJson("https://api.postscript.io/api/v2/subscribers?limit=1", { headers: { Authorization: `Bearer ${apiKey}`, accept: "application/json" } }, { platform: "Postscript", secret: apiKey, fetchImpl, ...extra });
    return { accountName: input.accountId.trim() };
  } catch (e) {
    if (e instanceof PlatformError && (e.kind === "rejected" || e.kind === "forbidden")) throw new Error("Postscript rejected the API key. Use the Private API key from Account, API (app.postscript.io/account/api), not the Public one.");
    throw e;
  }
}
