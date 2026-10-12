import { NextResponse } from "next/server";
import { connectProvider, parseConnectBody, redact } from "@/lib/connect";
import { saveApiKey } from "@/lib/integration-secrets";
import { getAdminClient, getServerClient } from "@/lib/supabase/server";
import { getVerifier } from "@/lib/sync/registry";

// Connects an account for a provider that uses a client API key (Klaviyo, Postscript, Omnisend) or the agency Google login (GA4).
// Meta and Google Ads keep their own routes. The key is encrypted server-side and never returned, not even in an error.
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const parsed = parseConnectBody(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const input = parsed.value;

  const supabase = await getServerClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  // Row-level security: the user must have access to this client.
  const { data: client } = await supabase.from("clients").select("id").eq("id", input.clientId).maybeSingle();
  if (!client) return NextResponse.json({ error: "No access to this client" }, { status: 403 });

  const verify = getVerifier(input.provider);
  if (!verify) return NextResponse.json({ error: "This provider cannot be verified yet" }, { status: 400 });

  const admin = getAdminClient();
  try {
    const result = await connectProvider(input, {
      verify,
      async upsertIntegration(row) {
        const { data, error } = await admin
          .from("integrations")
          .upsert({ client_id: row.clientId, provider: row.provider, account_id: row.accountId, account_name: row.accountName, status: "connected", last_error: null, consecutive_failures: 0 }, { onConflict: "client_id,provider,account_id" })
          .select("id")
          .single();
        if (error || !data) throw new Error("Could not save the connection");
        return { id: data.id as string };
      },
      saveApiKey,
      async markError(id, message) {
        await admin.from("integrations").update({ status: "error", last_error: message.slice(0, 300) }).eq("id", id);
      },
    });
    return NextResponse.json({ ok: true, name: result.accountName });
  } catch (e) {
    return NextResponse.json({ error: redact(e instanceof Error ? e.message : "Could not connect", input.apiKey) }, { status: 400 });
  }
}
