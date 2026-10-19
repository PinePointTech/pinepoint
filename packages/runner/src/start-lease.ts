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

/** Takes the start lease of the run for `seconds`. True when this call got it, false when another call holds it. */
export async function takeStartLease(runId: string, seconds = START_LEASE_SECONDS): Promise<boolean> {
  const rows = await withAddedColumn(
    () => sql()`
      update runs set start_lease_until = now() + make_interval(secs => ${seconds})
      where id = ${runId} and (start_lease_until is null or start_lease_until < now())
      returning id
    `,
    ensureStartLeaseColumn,
  );
  return rows.length > 0;
}

/** Gives the lease back, so the next caller does not wait for it to expire. */
export async function dropStartLease(runId: string): Promise<void> {
  await sql()`update runs set start_lease_until = null where id = ${runId}`;
}
