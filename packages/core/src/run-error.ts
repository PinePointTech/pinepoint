// runs.error: why a run failed (db/005_run_error.sql). Server code only.
//
// A database that predates db/005 has no such column. The first write that needs it adds it,
// once per process, so no manual migration is needed (the same idea as shots.ts and webhook_claims).

import { sql } from "./db";

/** Postgres 42703 undefined_column. */
export function isUndefinedColumn(err: unknown): boolean {
  return (err as { code?: string })?.code === "42703";
}

let ensured: Promise<void> | undefined;

/** The same statement as db/005_run_error.sql. Runs once per process; a failed try runs again on the next call. */
export function ensureRunErrorColumn(): Promise<void> {
  ensured ??= sql()`alter table runs add column if not exists error text`.then(
    () => undefined,
    (err: unknown) => {
      ensured = undefined;
      throw err;
    },
  );
  return ensured;
}

/**
 * Runs `query`. When it fails with 42703 (runs.error is missing), adds the column with `ensure`
 * and runs `query` one more time. Every other error goes to the caller.
 */
export async function withRunErrorColumn<T>(
  query: () => Promise<T>,
  ensure: () => Promise<void> = ensureRunErrorColumn,
): Promise<T> {
  try {
    return await query();
  } catch (err) {
    if (!isUndefinedColumn(err)) throw err;
    await ensure();
    return query();
  }
}
