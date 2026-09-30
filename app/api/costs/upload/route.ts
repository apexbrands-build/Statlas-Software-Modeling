import { NextResponse } from "next/server";
import { getAdminClient, getServerClient } from "@/lib/supabase/server";

// Upload product costs by SKU ("sku,cost" per line). Used when Shopify has no "Cost per item" for a product.
export async function POST(request: Request) {
  const body = (await request.json()) as { clientId?: string; csv?: string };
  if (!body.clientId || !body.csv) return NextResponse.json({ error: "clientId and csv required" }, { status: 400 });

  const supabase = await getServerClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { data: client } = await supabase.from("clients").select("id").eq("id", body.clientId).maybeSingle();
  if (!client) return NextResponse.json({ error: "No access to this client" }, { status: 403 });

  const costs = new Map<string, number>();
  for (const line of body.csv.split(/\r?\n/)) {
    const [skuRaw, costRaw] = line.split(/[,;\t]/).map((x) => x?.trim().replace(/^"|"$/g, ""));
    const cost = Number(costRaw);
    if (skuRaw && Number.isFinite(cost) && cost > 0) costs.set(skuRaw.toLowerCase(), cost);
  }
  if (costs.size === 0) return NextResponse.json({ error: "No valid 'sku,cost' lines found" }, { status: 400 });

  const admin = getAdminClient();
  const { data: products } = await admin.from("products").select("variant_id,sku").eq("client_id", body.clientId).not("sku", "is", null);
  const updates = (products ?? []).filter((p) => costs.has(String(p.sku).toLowerCase()));
  for (const p of updates) {
    await admin.from("products").update({ unit_cost: costs.get(String(p.sku).toLowerCase()), cost_source: "csv" }).eq("client_id", body.clientId).eq("variant_id", p.variant_id);
  }
  return NextResponse.json({ ok: true, matched: updates.length, received: costs.size });
}
