import { NextResponse } from "next/server";
import { googleConfigured, hasRefreshToken } from "@/lib/google";
import { getServerClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await getServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  return NextResponse.json({ configured: googleConfigured(), authorized: googleConfigured() ? await hasRefreshToken() : false });
}
