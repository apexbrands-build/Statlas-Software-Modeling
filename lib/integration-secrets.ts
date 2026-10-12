import "server-only";
import { decrypt, encrypt } from "@/lib/crypto";
import { getAdminClient } from "@/lib/supabase/server";

// A client API key (Klaviyo, Postscript, Omnisend) lives only here, encrypted, readable by the server (service role). It is never sent to the browser.

export async function saveApiKey(integrationId: string, apiKey: string): Promise<void> {
  const { error } = await getAdminClient()
    .from("integration_secrets")
    .upsert({ integration_id: integrationId, ciphertext: encrypt(JSON.stringify({ apiKey })), updated_at: new Date().toISOString() }, { onConflict: "integration_id" });
  if (error) throw new Error("Could not save the API key");
}

export async function readApiKey(integrationId: string): Promise<string> {
  const { data } = await getAdminClient().from("integration_secrets").select("ciphertext").eq("integration_id", integrationId).single();
  if (!data) throw new Error("No saved key: reconnect the account");
  return (JSON.parse(decrypt(data.ciphertext as string)) as { apiKey: string }).apiKey;
}
