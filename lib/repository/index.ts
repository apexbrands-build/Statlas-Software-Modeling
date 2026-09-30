import { dataMode } from "../supabase/env";
import { SeedRepository } from "./seed";
import { SupabaseRepository } from "./supabase";
import type { Repository } from "./types";

let repo: Repository | null = null;

/** NEXT_PUBLIC_DATA_MODE=supabase reads real data; anything else uses the fictional seed data. */
export function getRepository(): Repository {
  if (!repo) repo = dataMode === "supabase" ? new SupabaseRepository() : new SeedRepository();
  return repo;
}

export type { Repository };
