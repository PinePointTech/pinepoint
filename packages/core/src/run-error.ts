// runs.error: why a run failed (db/005_run_error.sql). Server code only.
//
// A database that predates db/005 has no such column. The first write that needs it adds it,
// once per process, so no manual migration is needed (the same idea as shots.ts and webhook_claims).
// alterOnce and withAddedColumn are not tied to runs.error: runner/start-lease.ts uses them too.

import { sql } from "./db";

/** Postgres 42703 undefined_column. */
export function isUndefinedColumn(err: unknown): boolean {
  return (err as { code?: string })?.code === "42703";
}

/** Wraps an `alter table ... add column if not exists` so it runs once per process. A failed try runs again on the next call. */
export function alterOnce(alter: () => Promise<unknown>): () => Promise<void> {
  let done: Promise<void> | undefined;
  return () => {
    done ??= alter().then(
      () => undefined,
      (err: unknown) => {
        done = undefined;
        throw err;
      },
    );
    return done;
  };
}

/** The same statement as db/005_run_error.sql. */
export const ensureRunErrorColumn = alterOnce(() => sql()`alter table runs add column if not exists error text`);

/**
 * Runs `query`. When it fails with 42703 (a column is missing), adds the column with `ensure`
 * and runs `query` one more time. Every other error goes to the caller.
 */
export async function withAddedColumn<T>(query: () => Promise<T>, ensure: () => Promise<void>): Promise<T> {
  try {
    return await query();
  } catch (err) {
    if (!isUndefinedColumn(err)) throw err;
    await ensure();
    return query();
  }
}

/** withAddedColumn for runs.error. */
export function withRunErrorColumn<T>(
  query: () => Promise<T>,
  ensure: () => Promise<void> = ensureRunErrorColumn,
): Promise<T> {
  return withAddedColumn(query, ensure);
}
