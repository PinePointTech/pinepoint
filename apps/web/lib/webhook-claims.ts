// Dedupe for the GitHub webhook. Server code only.
//
// GitHub can send two deployment_status events for one commit at the same time. Planning takes
// tens of seconds, so a check for an existing run is not enough on its own: both deliveries would
// pass it. A claim row (db/003_webhook_claims.sql) is the gate. The insert either wins the key or
// gets nothing back, in one statement, so only one delivery plans the run.

import { sql } from "@pinepoint/core";

export interface ClaimTarget {
  owner: string;
  repo: string;
  number: number;
  headSha: string;
}

/** A claim with no run after this long belongs to a call that died. Another delivery may take it. */
const STALE_CLAIM = "15 minutes";

export function claimKey(t: ClaimTarget): string {
  return `${t.owner}/${t.repo}#${t.number}@${t.headSha}`;
}

/** A run for this PR head that is not failed and not no_preview, or null. */
export async function activeRunFor(t: ClaimTarget): Promise<{ id: string; status: string } | null> {
  const rows = (await sql()`
    select id, status from runs
    where owner = ${t.owner} and repo = ${t.repo} and pr_number = ${t.number} and head_sha = ${t.headSha}
      and status not in ('failed', 'no_preview')
    order by started_at desc nulls last
    limit 1
  `) as Array<{ id: string; status: string }>;
  return rows[0] ?? null;
}

function missingTable(err: unknown): boolean {
  return (err as { code?: string })?.code === "42P01";
}

/**
 * Takes the claim for this PR head. True when this call got it. An old claim is taken again when
 * its run failed or had no preview, or when it never got a run and is stale, and only while no
 * other live run exists for the same head.
 */
export async function claim(t: ClaimTarget): Promise<boolean> {
  const key = claimKey(t);
  try {
    const rows = await sql()`
      insert into webhook_claims (key) values (${key})
      on conflict (key) do update set claimed_at = now(), run_id = null
      where not exists (
              select 1 from runs r
              where r.owner = ${t.owner} and r.repo = ${t.repo} and r.pr_number = ${t.number}
                and r.head_sha = ${t.headSha} and r.status not in ('failed', 'no_preview')
            )
        and (webhook_claims.run_id is not null
             or webhook_claims.claimed_at < now() - ${STALE_CLAIM}::interval)
      returning key
    `;
    return rows.length > 0;
  } catch (err) {
    if (missingTable(err)) {
      throw new Error("The webhook_claims table is missing. Run: pnpm --filter @pinepoint/core db:migrate");
    }
    throw err;
  }
}

/** Records the run that this claim started. */
export async function attachRun(t: ClaimTarget, runId: string): Promise<void> {
  await sql()`update webhook_claims set run_id = ${runId} where key = ${claimKey(t)}`;
}

/** Gives the claim back when no run came of it, so a later delivery can try again. */
export async function releaseClaim(t: ClaimTarget): Promise<void> {
  await sql()`delete from webhook_claims where key = ${claimKey(t)} and run_id is null`;
}
