import { NextResponse } from "next/server";
import { fetchCustomerInfo, googleConfigured, normalizeCustomerId } from "@/lib/google";
import { getAdminClient, getServerClient } from "@/lib/supabase/server";

// Connects a Google Ads client account (under the agency MCC) to a client. Read-only.
export async function POST(request: Request) {
  const body = (await request.json()) as { clientId?: string; customerId?: string };
  const customerId = normalizeCustomerId(body.customerId ?? "");
  if (!body.clientId || !customerId) return NextResponse.json({ error: "Enter the 10-digit Google Ads customer ID (e.g. 123-456-7890)" }, { status: 400 });
  if (!googleConfigured()) return NextResponse.json({ error: "Google is not configured on the server" }, { status: 400 });

  const supabase = await getServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { data: client } = await supabase.from("clients").select("id").eq("id", body.clientId).maybeSingle();
  if (!client) return NextResponse.json({ error: "No access to this client" }, { status: 403 });

  let info;
  try {
    info = await fetchCustomerInfo(customerId);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Google rejected the request" }, { status: 400 });
  }
  const { error } = await getAdminClient()
    .from("integrations")
    .upsert({ client_id: body.clientId, provider: "google_ads", account_id: customerId, account_name: info.name, status: "connected", last_error: null, consecutive_failures: 0 }, { onConflict: "client_id,provider,account_id" });
  if (error) return NextResponse.json({ error: "Could not save connection" }, { status: 500 });
  return NextResponse.json({ ok: true, name: info.name, currency: info.currency });
}
