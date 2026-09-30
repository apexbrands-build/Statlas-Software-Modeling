import { NextResponse } from "next/server";
import { fetchAdAccount, normalizeAdAccountId } from "@/lib/sync/meta";
import { getAdminClient, getServerClient } from "@/lib/supabase/server";

// Connects a Meta ad account to a client (read-only). The agency System User token lives in server env.
export async function POST(request: Request) {
  const body = (await request.json()) as { clientId?: string; adAccountId?: string };
  const account = normalizeAdAccountId(body.adAccountId ?? "");
  if (!body.clientId || !account) return NextResponse.json({ error: "Invalid client or ad account ID" }, { status: 400 });

  const supabase = await getServerClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { data: client } = await supabase.from("clients").select("id").eq("id", body.clientId).maybeSingle();
  if (!client) return NextResponse.json({ error: "No access to this client" }, { status: 403 });

  let info;
  try {
    info = await fetchAdAccount(account);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Meta rejected the request" }, { status: 400 });
  }
  const { error } = await getAdminClient()
    .from("integrations")
    .upsert({ client_id: body.clientId, provider: "meta", account_id: account, account_name: info.name, status: "connected", last_error: null }, { onConflict: "client_id,provider,account_id" });
  if (error) return NextResponse.json({ error: "Could not save connection" }, { status: 500 });
  return NextResponse.json({ ok: true, name: info.name, currency: info.currency });
}
