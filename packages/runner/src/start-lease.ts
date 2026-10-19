// runs.start_lease_until (db/006_start_lease.sql): one call at a time starts the Computers of a run.
//
// Up to three callers start Computers for one run: the background step of POST /api/runs
// (startRun), the drive loop (advanceRun) and the status route (startQueued in after()). Without
// the lease, two of them read the same free-slot count and both claim that many missions, which
// goes past the Pine limit and doubles the create rate. The Neon HTTP driver has no session, so an
// advisory lock does not work. A conditional update on the run row does.
//
// A database that predates db/006 has no such column. The first lease adds it, once per process.

import { alterOnce, sql, withAddedColumn } from "@pinepoint/core";
import { START_LEASE_SECONDS } from "./decide";

/** The same statement as db/006_start_lease.sql. */
export const ensureStartLeaseColumn = alterOnce(
  () => sql()`alter table runs add column if not exists start_lease_until timestamptz`,
);

/** The lease column is missing and cannot be added, so starts go on without a lease, as before db/006. */
export class LeaseUnavailableError extends Error {
  override name = "LeaseUnavailableError";
}

/**
 * Takes the start lease of the run for `seconds`. Returns the lease's expiry as Postgres text (it keeps
 * the microseconds, so dropStartLease can match it exactly), or null when another call holds the lease.
 * Throws LeaseUnavailableError when the column is missing and this database cannot add it.
 */
export async function takeStartLease(runId: string, seconds = START_LEASE_SECONDS): Promise<string | null> {
  const ensure = async () => {
    try {
      await ensureStartLeaseColumn();
    } catch (err) {
      // Only "this role or database cannot add the column" means no lease can ever exist here.
      // Anything else (a dropped connection, a lock or statement timeout) is passing: rethrow it,
      // so fillSlots starts nothing in this call and the next poll tries again.
      const code = (err as { code?: string })?.code;
      if (code === "42501" || code === "25006") throw new LeaseUnavailableError((err as Error).message);
      throw err;
    }
  };
  const rows = (await withAddedColumn(
    () => sql()`
      update runs set start_lease_until = now() + make_interval(secs => ${seconds})
      where id = ${runId} and (start_lease_until is null or start_lease_until < now())
      returning start_lease_until::text as until
    `,
    ensure,
  )) as Array<{ until: string }>;
  return rows[0]?.until ?? null;
}

/**
 * Gives the lease back, so the next caller does not wait for it to expire. Only while it is still this
 * call's lease: a call that ran past the lease must not clear the lease of the call that took it next.
 */
export async function dropStartLease(runId: string, until: string): Promise<void> {
  // Compare as timestamptz: exact (the text keeps the microseconds and the offset) and free of the
  // request's TimeZone and DateStyle.
  await sql()`update runs set start_lease_until = null where id = ${runId} and start_lease_until = ${until}::timestamptz`;
}
