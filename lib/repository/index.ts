import type { Repository } from "./types";
import { SeedRepository } from "./seed";

let repo: Repository | null = null;

/** Swap this for a Supabase-backed repository once connectors exist. */
export function getRepository(): Repository {
  if (!repo) repo = new SeedRepository();
  return repo;
}

export type { Repository };
