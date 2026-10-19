// Pictures of a mission's screen, kept in Postgres (db/004_mission_shots.sql) and served by GET /api/shots/[id].
// Server code only.

import { sql } from "./db";
import { alterOnce } from "./run-error";

export interface ShotInput {
  missionId: string;
  /** 0 for fail.png or a last screenshot; 1, 2, ... for step pictures. */
  idx: number;
  mediaType: string;
  data: Uint8Array;
  title?: string;
  /** ISO time of the picture. */
  observedAt?: string | null;
}

export interface StoredShot {
  mediaType: string;
  data: Buffer;
}

/** The path that serves a stored picture. Relative, so it works on every deployment. */
export function shotPath(id: string): string {
  return `/api/shots/${id}`;
}

const SHOT_PATH = /^\/api\/shots\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i;

/** The picture id of a shotPath ("/api/shots/<uuid>"), or null for any other value. */
export function shotIdFromPath(path: string | null | undefined): string | null {
  return path ? (SHOT_PATH.exec(path)?.[1] ?? null) : null;
}

function missingTable(err: unknown): boolean {
  return (err as { code?: string })?.code === "42P01";
}

/** The same statements as db/004_mission_shots.sql (with the cascade from db/007), so the first save needs no manual migration. */
const createShotsTable = () => sql()`
  create table if not exists mission_shots (
    id uuid primary key default gen_random_uuid(),
    mission_id uuid not null references missions(id) on delete cascade,
    idx int not null default 0,
    media_type text not null,
    title text not null default '',
    observed_at timestamptz,
    data_b64 text not null,
    created_at timestamptz not null default now()
  )
`;
const createShotsIndex = () => sql()`create index if not exists mission_shots_mission_idx on mission_shots (mission_id, idx)`;

/** Postgres "if not exists" is not safe under concurrency: a caller that loses the race gets one of these. */
function lostCreateRace(err: unknown): boolean {
  const code = (err as { code?: string })?.code;
  return code === "23505" || code === "42P07";
}

/**
 * Creates the table and its index once per process. The runner saves up to 12 pictures at once, so on
 * a database without the table many saves ask for it at the same moment; the ones that lose the race
 * carry on. Each statement tolerates the race on its own, so a lost table race still makes the index.
 */
const ensureShotsTable = alterOnce(async () => {
  for (const step of [createShotsTable, createShotsIndex]) {
    try {
      await step();
    } catch (err) {
      if (!lostCreateRace(err)) throw err;
    }
  }
});

/** Saves one picture and returns its path (shotPath). */
export async function saveShot(input: ShotInput, retried = false): Promise<string> {
  const b64 = Buffer.from(input.data).toString("base64");
  try {
    const rows = (await sql()`
      insert into mission_shots (mission_id, idx, media_type, title, observed_at, data_b64)
      values (${input.missionId}, ${input.idx}, ${input.mediaType}, ${input.title ?? ""}, ${input.observedAt ?? null}, ${b64})
      returning id
    `) as Array<{ id: string }>;
    return shotPath(rows[0]!.id);
  } catch (err) {
    if (missingTable(err) && !retried) {
      await ensureShotsTable();
      return saveShot(input, true);
    }
    throw err;
  }
}

/**
 * The picture path of each mission that has one, for a mission whose screenshot_url is not written
 * yet. The choice is the one the runner makes: fail.png (idx 0) first, else the last step picture
 * (the highest idx). It orders by idx, not by insert time: the runner saves the step pictures in
 * parallel, so created_at does not follow step order. An empty map when the table does not exist yet.
 */
export async function latestShotPaths(missionIds: string[]): Promise<Map<string, string>> {
  const paths = new Map<string, string>();
  if (missionIds.length === 0) return paths;
  try {
    const rows = (await sql().query(
      `select distinct on (mission_id) mission_id, id from mission_shots
       where mission_id = any($1::uuid[])
       order by mission_id, (idx = 0) desc, idx desc, created_at desc`,
      [missionIds],
    )) as Array<{ mission_id: string; id: string }>;
    for (const row of rows) paths.set(row.mission_id, shotPath(row.id));
    return paths;
  } catch (err) {
    if (missingTable(err)) return paths;
    throw err;
  }
}

/** Loads one picture, or null when the id is unknown or the table does not exist yet. */
export async function loadShot(id: string): Promise<StoredShot | null> {
  try {
    const rows = (await sql()`
      select media_type, data_b64 from mission_shots where id = ${id}
    `) as Array<{ media_type: string; data_b64: string }>;
    const row = rows[0];
    return row ? { mediaType: row.media_type, data: Buffer.from(row.data_b64, "base64") } : null;
  } catch (err) {
    if (missingTable(err)) return null;
    throw err;
  }
}

/** Step pictures are kept this many days. The picture a finding or a mission links to is kept for good. */
export const SHOT_RETENTION_DAYS = 14;

/**
 * Deletes step pictures of runs that ended more than `days` ago, except the ones a finding (and so a
 * PR review comment) or a mission card links to. Keeps mission_shots from filling the Neon quota.
 * Returns how many rows went. 0 when the table does not exist yet.
 */
export async function pruneShots(days = SHOT_RETENTION_DAYS): Promise<number> {
  try {
    const rows = (await sql()`
      delete from mission_shots s
      using missions m, runs r
      where s.mission_id = m.id and m.run_id = r.id
        and r.finished_at < now() - make_interval(days => ${days})
        and coalesce(m.screenshot_url, '') <> '/api/shots/' || s.id::text
        and not exists (select 1 from findings f where f.screenshot_url = '/api/shots/' || s.id::text)
      returning s.id
    `) as Array<{ id: string }>;
    return rows.length;
  } catch (err) {
    if (missingTable(err)) return 0;
    throw err;
  }
}
