import { createBrowserClient } from "@supabase/ssr";
import { SESSION_COOKIE_OPTIONS, supabaseKey, supabaseUrl } from "./env";

let client: ReturnType<typeof createBrowserClient> | null = null;

/** Browser client: uses the signed-in user's session, so row-level security applies. */
export function getBrowserClient() {
  if (!supabaseUrl || !supabaseKey) throw new Error("Supabase is not configured (missing NEXT_PUBLIC_SUPABASE_URL or key)");
  if (!client) client = createBrowserClient(supabaseUrl, supabaseKey, { cookieOptions: SESSION_COOKIE_OPTIONS });
  return client;
}
