import "server-only";
import { decrypt, encrypt } from "@/lib/crypto";
import { getAdminClient } from "@/lib/supabase/server";

// Google Ads API (read-only). One agency OAuth authorization + the manager (MCC) account reaches every client account.
export const GOOGLE_ADS_VERSION = process.env.GOOGLE_ADS_API_VERSION ?? "v25";
export const GOOGLE_SCOPE = "https://www.googleapis.com/auth/adwords";

export function googleConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_ADS_DEVELOPER_TOKEN && process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID);
}

export const digits = (s: string) => s.replace(/\D/g, "");

export function normalizeCustomerId(input: string): string | null {
  const d = digits(input);
  return /^\d{10}$/.test(d) ? d : null;
}

export async function saveRefreshToken(refreshToken: string) {
  await getAdminClient().from("agency_secrets").upsert({ provider: "google", ciphertext: encrypt(JSON.stringify({ refreshToken })), updated_at: new Date().toISOString() });
}

export async function hasRefreshToken(): Promise<boolean> {
  const { data } = await getAdminClient().from("agency_secrets").select("provider").eq("provider", "google").maybeSingle();
  return Boolean(data);
}

async function accessToken(): Promise<string> {
  const { data } = await getAdminClient().from("agency_secrets").select("ciphertext").eq("provider", "google").maybeSingle();
  if (!data) throw new Error("Google is not authorized yet: an admin must click Authorize Google");
  const { refreshToken } = JSON.parse(decrypt(data.ciphertext)) as { refreshToken: string };
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET!, refresh_token: refreshToken, grant_type: "refresh_token" }),
  });
  const json = (await res.json()) as { access_token?: string; error_description?: string };
  if (!res.ok || !json.access_token) throw new Error(`Google sign-in failed: ${json.error_description ?? res.status}`);
  return json.access_token;
}

interface SearchResponse {
  results?: Record<string, Record<string, string | number>>[];
  nextPageToken?: string;
  error?: { message: string };
}

/** Runs a GAQL query against one client account, following pages. */
export async function adsSearch(customerId: string, query: string): Promise<Record<string, Record<string, string | number>>[]> {
  const token = await accessToken();
  const rows: Record<string, Record<string, string | number>>[] = [];
  let pageToken: string | undefined;
  do {
    const res = await fetch(`https://googleads.googleapis.com/${GOOGLE_ADS_VERSION}/customers/${customerId}/googleAds:search`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "developer-token": process.env.GOOGLE_ADS_DEVELOPER_TOKEN!,
        "login-customer-id": digits(process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID!),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, pageSize: 10000, ...(pageToken ? { pageToken } : {}) }),
    });
    const json = (await res.json()) as SearchResponse;
    if (!res.ok || json.error) throw new Error(`Google Ads: ${json.error?.message ?? res.status}`);
    rows.push(...(json.results ?? []));
    pageToken = json.nextPageToken;
  } while (pageToken);
  return rows;
}

export async function fetchCustomerInfo(customerId: string) {
  const rows = await adsSearch(customerId, "SELECT customer.descriptive_name, customer.currency_code, customer.time_zone FROM customer LIMIT 1");
  const c = rows[0]?.customer ?? {};
  return { name: String(c.descriptiveName ?? customerId), currency: String(c.currencyCode ?? ""), timezone: String(c.timeZone ?? "") };
}
