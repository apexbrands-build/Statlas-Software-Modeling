export const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
/** Login is enforced whenever Supabase is configured. */
export const authEnabled = Boolean(supabaseUrl && supabaseKey);
export const dataMode: "seed" | "supabase" = process.env.NEXT_PUBLIC_DATA_MODE === "supabase" && authEnabled ? "supabase" : "seed";
