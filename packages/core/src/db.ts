// Database access over the Neon HTTP driver.
// Each call is one stateless HTTP request, which fits Vercel functions (plan 4.2).

import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

export type Sql = NeonQueryFunction<false, false>;

let cached: Sql | undefined;

/** The connection string from DATABASE_URL. Throws a clear error when it is missing. */
export function databaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set. Put the Neon connection string in .env.local.");
  }
  return url;
}

/**
 * Returns the shared query function. Use it as a tagged template:
 *
 *   const rows = await sql()`select id from runs where id = ${runId}`;
 *
 * Or with placeholders: `sql().query("select 1 where $1 = 1", [1])`.
 * The client is created on first use so that importing this module never needs the env.
 */
export function sql(): Sql {
  if (!cached) {
    cached = neon(databaseUrl());
  }
  return cached;
}
