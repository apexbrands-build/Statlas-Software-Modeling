import { CONNECT_LIMITS, PlatformError, requestJson, type RequestOptions } from "./http";

/** Klaviyo API revision sent with every call (a date; Klaviyo keeps each revision working for about two years). */
export const KLAVIYO_REVISION = "2026-07-15";

type Extra = Pick<RequestOptions, "retries" | "sleep" | "timeoutMs" | "maxWaitMs">;

/**
 * Checks a Klaviyo Private API key with one read-only call (GET /api/accounts, scope accounts:read) and returns the account the key belongs to.
 * The account id comes from Klaviyo, so the strategist only pastes the key.
 */
export async function verifyKlaviyo(input: { accountId: string; apiKey?: string }, fetchImpl?: typeof fetch, extra: Extra = {}): Promise<{ accountName: string; accountId?: string }> {
  const apiKey = input.apiKey?.trim();
  if (!apiKey) throw new Error("API key is required");
  try {
    const { json } = await requestJson("https://a.klaviyo.com/api/accounts", { headers: { Authorization: `Klaviyo-API-Key ${apiKey}`, revision: KLAVIYO_REVISION, accept: "application/vnd.api+json" } }, { platform: "Klaviyo", secret: apiKey, fetchImpl, ...CONNECT_LIMITS, ...extra });
    const account = (json as { data?: { id?: string; attributes?: { contact_information?: { organization_name?: string } } }[] } | null)?.data?.[0];
    if (!account) throw new Error("Klaviyo returned no account for this key");
    return { accountName: account.attributes?.contact_information?.organization_name?.trim() || "Klaviyo account", accountId: account.id };
  } catch (e) {
    if (e instanceof PlatformError && e.kind === "rejected") throw new Error("Klaviyo rejected the API key. Create a new Private API key in Klaviyo (Settings, API keys) and paste it here.");
    if (e instanceof PlatformError && e.kind === "forbidden") throw new Error("This Klaviyo key cannot read the account. Give the key the Accounts, Campaigns, Flows, Metrics and Events read scopes, or use Read-Only access.");
    throw e;
  }
}
