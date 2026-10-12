/** The columns Store Settings reads for each connection (no `consecutive_failures`; see below). */
export const INTEGRATION_COLUMNS = "id,provider,account_id,account_name,status,coverage_start,coverage_end,last_synced_at,last_error";

type Result = { data: unknown[] | null; error: unknown };

/**
 * Reads a client's connections including the failure counter. If the database does not have that column yet
 * (migration 0009 not applied), reads again without it so the connections table never goes blank.
 */
export async function selectIntegrations(run: (columns: string) => PromiseLike<Result>): Promise<unknown[]> {
  const first = await run(`${INTEGRATION_COLUMNS},consecutive_failures`);
  if (!first.error) return first.data ?? [];
  return (await run(INTEGRATION_COLUMNS)).data ?? [];
}
