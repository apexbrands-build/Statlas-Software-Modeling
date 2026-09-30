import { NextResponse } from "next/server";
import { getAdminClient, getServerClient } from "@/lib/supabase/server";

// Admins only: creates a client and its default settings row.
export async function POST(request: Request) {
  const supabase = await getServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", auth.user.id).maybeSingle();
  if (profile?.role !== "admin") return NextResponse.json({ error: "Admins only" }, { status: 403 });

  const body = (await request.json()) as { name?: string; currency?: string; timezone?: string };
  const name = body.name?.trim();
  if (!name) return NextResponse.json({ error: "Name required" }, { status: 400 });

  const admin = getAdminClient();
  const { data: client, error } = await admin
    .from("clients")
    .insert({ name, currency: body.currency || "USD", timezone: body.timezone || "UTC" })
    .select("id")
    .single();
  if (error || !client) return NextResponse.json({ error: "Could not create client" }, { status: 500 });
  await admin.from("client_settings").insert({ client_id: client.id });
  return NextResponse.json({ id: client.id });
}
