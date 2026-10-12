import { PROVIDERS, type ProviderId, type ProviderMeta } from "@/lib/providers";

// Connecting a provider that is not Shopify, Meta or Google Ads: a client API key (client-key) or an account on the agency Google login (agency-google).

export interface ConnectInput {
  clientId: string;
  provider: ProviderId;
  accountId: string;
  apiKey?: string;
  /** Replacing the key of an existing connection: the account it belongs to. A key from another account is refused. */
  expectedAccountId?: string;
}

const asText = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** Validates the request body for POST /api/integrations/connect. `providers` is injectable for tests. */
export function parseConnectBody(body: unknown, providers: Record<string, ProviderMeta> = PROVIDERS): { ok: true; value: ConnectInput } | { ok: false; error: string } {
  if (typeof body !== "object" || body === null) return { ok: false, error: "Invalid request" };
  const b = body as Record<string, unknown>;
  const clientId = asText(b.clientId);
  if (!clientId) return { ok: false, error: "Client is required" };

  const provider = typeof b.provider === "string" && Object.hasOwn(providers, b.provider) ? providers[b.provider] : undefined;
  if (!provider || !provider.available || (provider.auth !== "client-key" && provider.auth !== "agency-google")) return { ok: false, error: "Provider not supported here" };

  const accountId = asText(b.accountId);
  // A provider that tells its own account from the key (Klaviyo) does not need one typed.
  if (!accountId && !provider.accountFromKey) return { ok: false, error: "Account ID is required" };

  if (provider.auth === "client-key") {
    const apiKey = asText(b.apiKey);
    if (!apiKey) return { ok: false, error: "API key is required" };
    const expectedAccountId = asText(b.expectedAccountId);
    return { ok: true, value: { clientId, provider: provider.id, accountId, apiKey, ...(expectedAccountId ? { expectedAccountId } : {}) } };
  }
  return { ok: true, value: { clientId, provider: provider.id, accountId } };
}

/** Hides a secret inside a message that may come from an upstream API. */
export function redact(message: string, secret: string | undefined): string {
  return secret ? message.split(secret).join("***") : message;
}

export interface ConnectDeps {
  verify(input: { accountId: string; apiKey?: string }): Promise<{ accountName: string; accountId?: string }>;
  upsertIntegration(row: { clientId: string; provider: ProviderId; accountId: string; accountName: string }): Promise<{ id: string }>;
  saveApiKey(integrationId: string, apiKey: string): Promise<void>;
  markError(integrationId: string, message: string): Promise<void>;
}

/** Verify first (nothing is saved if the account is rejected), then save the connection, then the key. */
export async function connectProvider(input: ConnectInput, deps: ConnectDeps): Promise<{ id: string; accountName: string }> {
  let accountName: string;
  let accountId = input.accountId;
  try {
    const verified = await deps.verify({ accountId: input.accountId, apiKey: input.apiKey });
    accountName = verified.accountName;
    // When the platform names the account, that id wins: the same key always lands on the same connection.
    accountId = verified.accountId ?? input.accountId;
    if (input.expectedAccountId && verified.accountId && verified.accountId !== input.expectedAccountId) {
      throw new Error(`This key belongs to a different ${PROVIDERS[input.provider]?.label ?? "platform"} account (${accountName}). Disconnect this connection or add the key as a new connection.`);
    }
    if (!accountId) throw new Error("Could not identify the account for this key");
  } catch (e) {
    throw new Error(redact(e instanceof Error ? e.message : "Verification failed", input.apiKey));
  }
  const { id } = await deps.upsertIntegration({ clientId: input.clientId, provider: input.provider, accountId, accountName });
  if (input.apiKey !== undefined) {
    try {
      await deps.saveApiKey(id, input.apiKey);
    } catch (e) {
      const message = redact(e instanceof Error ? e.message : "Could not save the API key", input.apiKey);
      await deps.markError(id, message);
      throw new Error(message);
    }
  }
  return { id, accountName };
}
