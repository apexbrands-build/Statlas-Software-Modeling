import { NextResponse } from "next/server";
import { finalizeShopify, shopifyHistoryAccess, syncShopify } from "@/lib/sync/run-shopify";
import { getServerClient } from "@/lib/supabase/server";

export const maxDuration = 60;

async function authorize(integrationId: string | undefined) {
  if (!integrationId) return { error: NextResponse.json({ error: "integrationId required" }, { status: 400 }) };
  const supabase = await getServerClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return { error: NextResponse.json({ error: "Not signed in" }, { status: 401 }) };
  const { data: integration } = await supabase.from("integrations").select("id,provider").eq("id", integrationId).maybeSingle();
  if (!integration || integration.provider !== "shopify") return { error: NextResponse.json({ error: "Connection not found" }, { status: 404 }) };
  return { id: integration.id as string };
}

// Does this store allow reading orders older than 60 days (read_all_orders)?
export async function GET(request: Request) {
  const auth = await authorize(new URL(request.url).searchParams.get("integrationId") ?? undefined);
  if (auth.error) return auth.error;
  try {
    return NextResponse.json(await shopifyHistoryAccess(auth.id!));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Check failed" }, { status: 500 });
  }
}

// Sync a date range (or the last 60 days). action "finalize" re-classifies customers and rebuilds a loaded history range.
export async function POST(request: Request) {
  const body = (await request.json()) as { integrationId?: string; from?: string; to?: string; days?: number; first?: boolean; action?: string };
  const auth = await authorize(body.integrationId);
  if (auth.error) return auth.error;
  try {
    if (body.action === "finalize") return NextResponse.json({ ok: true, ...(await finalizeShopify(auth.id!, body)) });
    const ranged = Boolean(body.from && body.to);
    return NextResponse.json({ ok: true, ...(await syncShopify(auth.id!, { body, products: ranged ? Boolean(body.first) : true, includeUpdated: !ranged })) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Sync failed" }, { status: 500 });
  }
}
