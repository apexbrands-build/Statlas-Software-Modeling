import "server-only";
import type { ProviderId } from "@/lib/providers";
import type { SyncRange } from "./range";
import { syncGoogle } from "./run-google";
import { syncMeta } from "./run-meta";
import { finalizeShopify, syncShopify } from "./run-shopify";

/** What the job runner tells a sync about the chunk it is running. */
export interface SyncContext {
  kind: "history" | "recent";
  /** Epoch ms after which the sync should stop fetching so the runner can retry smaller. */
  deadline: number;
  firstChunk: boolean;
}

/** The server side of a provider. Browser-safe metadata lives in `lib/providers.ts`. */
export interface ProviderSync {
  chunkDays: number;
  sync(integrationId: string, range: SyncRange, ctx: SyncContext): Promise<void>;
  /** Runs once after the last chunk of a job, over the whole job range. */
  finalize?(integrationId: string, range: SyncRange): Promise<void>;
  /** Checks a new connection (account id, optional client API key) and returns the account's name. */
  verify?(input: { accountId: string; apiKey?: string }): Promise<{ accountName: string }>;
}

export const SYNCS: Partial<Record<ProviderId, ProviderSync>> = {
  shopify: {
    chunkDays: 14,
    async sync(integrationId, range, ctx) {
      await syncShopify(integrationId, { body: range, products: ctx.firstChunk || ctx.kind === "recent", includeUpdated: ctx.kind === "recent", deadline: ctx.deadline });
    },
    async finalize(integrationId, range) {
      await finalizeShopify(integrationId, range);
    },
  },
  meta: {
    chunkDays: 60,
    async sync(integrationId, range) {
      await syncMeta(integrationId, range);
    },
  },
  google_ads: {
    chunkDays: 60,
    async sync(integrationId, range) {
      await syncGoogle(integrationId, range);
    },
  },
};

export function getSync(provider: string): ProviderSync | undefined {
  return Object.hasOwn(SYNCS, provider) ? SYNCS[provider as ProviderId] : undefined;
}

/** Providers the daily tick can sync. A new connector joins the cron by registering here. */
export function syncableProviderIds(): ProviderId[] {
  return Object.keys(SYNCS) as ProviderId[];
}
