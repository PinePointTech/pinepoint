// Applies the SQL files in db/ in name order, one transaction per file.
// A schema_migrations table records each file, so running this twice is safe.
//
//   pnpm --filter @pinepoint/core db:migrate
//
// Uses the WebSocket client, not the HTTP driver, because one file holds many statements.
// Node.js 22 and later has a global WebSocket, so no extra package is needed.

import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { Client } from "@neondatabase/serverless";

const dbDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../../db");

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set. Put the Neon connection string in .env.local.");
  }

  const files = (await readdir(dbDir)).filter((f) => f.endsWith(".sql")).sort();
  const client = new Client(url);
  await client.connect();
  try {
    await client.query(
      "create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())",
    );
    const applied = new Set(
      (await client.query("select name from schema_migrations")).rows.map((r: { name: string }) => r.name),
    );

    for (const file of files) {
      if (applied.has(file)) {
        console.log(`skip  ${file} (already applied)`);
        continue;
      }
      const body = await readFile(resolve(dbDir, file), "utf8");
      await client.query("begin");
      try {
        await client.query(body);
        await client.query("insert into schema_migrations (name) values ($1)", [file]);
        await client.query("commit");
      } catch (err) {
        await client.query("rollback");
        throw err;
      }
      console.log(`apply ${file}`);
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
