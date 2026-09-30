import { createBrowserClient } from "@supabase/ssr";
import { supabaseKey, supabaseUrl } from "./env";

let client: ReturnType<typeof createBrowserClient> | null = null;

/** Browser client: uses the signed-in user's session, so row-level security applies. */
export function getBrowserClient() {
  if (!client) client = createBrowserClient(supabaseUrl, supabaseKey);
  return client;
}
