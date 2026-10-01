import { NextResponse } from "next/server";
import { getAdminClient, getServerClient } from "@/lib/supabase/server";

// Removes a connection and its saved credentials. Data already loaded (orders, spend) is kept.
export async function POST(request: Request) {
  const body = (await request.json()) as { integrationId?: string };
  if (!body.integrationId) return NextResponse.json({ error: "integrationId required" }, { status: 400 });

  const supabase = await getServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  // Row-level security: the user must have access to the client that owns this connection.
  const { data: integration } = await supabase.from("integrations").select("id").eq("id", body.integrationId).maybeSingle();
  if (!integration) return NextResponse.json({ error: "Connection not found" }, { status: 404 });

  const { error } = await getAdminClient().from("integrations").delete().eq("id", integration.id);
  if (error) return NextResponse.json({ error: "Could not remove the connection" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
