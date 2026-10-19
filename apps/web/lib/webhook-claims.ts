// Claims that let only one caller start a run for a PR head. Server code only.
//
// GitHub can send two deployment_status events for one commit at the same time, and two POST
// /api/runs calls can come in together (a double click, a retry, or the webhook while a person
// starts a run on /app). A check for an existing run is not enough on its own: reading the PR takes
// seconds, so both callers would pass it. A claim row (db/003_webhook_claims.sql) is the gate. The
// insert either wins the key or gets nothing back, in one statement, so only one caller goes on.
//
// Two kinds of claim share the table:
//   claim / attachRun / releaseClaim               one per head for the webhook ("owner/repo#pr@sha").
//                                                  A head with a done run gets no automatic second run.
//   claimLiveHead / attachLiveRun / releaseLiveClaim  one live run per head ("live:owner/repo#pr@sha").
//                                                  prepareRun in lib/start-run.ts takes it for both callers.
//
// The check for an existing run (activeRunFor) lives in @pinepoint/runner, so both paths use it too.
// A `planning` run past the planning timeout counts as dead in every check here.

import { sql, type RunStatus } from "@pinepoint/core";
import { EXISTING_RUN_STATUSES, LIVE_RUN_STATUSES, PLANNING_TIMEOUT_SECONDS } from "@pinepoint/runner";

export interface ClaimTarget {
  owner: string;
  repo: string;
  number: number;
  headSha: string;
}

/** A webhook claim with no run after this long belongs to a call that died. Another delivery may take it. */
const STALE_CLAIM = "15 minutes";

/**
 * A live claim with no run after this long belongs to a call that died between the claim and the
 * run insert. prepareRun inserts the run right after it takes the claim, so this can be short.
 */
const STALE_LIVE_CLAIM = "2 minutes";

export function claimKey(t: ClaimTarget): string {
  return `${t.owner}/${t.repo}#${t.number}@${t.headSha}`;
}

export function liveClaimKey(t: ClaimTarget): string {
  return `live:${claimKey(t)}`;
}

function missingTable(err: unknown): boolean {
  return (err as { code?: string })?.code === "42P01";
}

/** The same statement as db/003_webhook_claims.sql. The first claim creates the table, so no manual migration is needed. */
async function createClaimsTable(): Promise<void> {
  await sql()`
    create table if not exists webhook_claims (
      key text primary key,
      run_id uuid references runs(id),
      claimed_at timestamptz not null default now()
    )
  `;
}

/**
 * Takes the claim `key` for this PR head. True when this call got it. No claim is taken, new or
 * old, while a run for the head has one of the `blocking` statuses. An old claim is taken again
 * only when it has its run (that run ended) or is older than `stale` (its caller died).
 */
async function takeClaim(
  key: string,
  t: ClaimTarget,
  blocking: readonly RunStatus[],
  stale: string,
  retried = false,
): Promise<boolean> {
  try {
    const rows = await sql()`
      insert into webhook_claims (key)
      select ${key}
      where not exists (
        select 1 from runs r
        where r.owner = ${t.owner} and r.repo = ${t.repo} and r.pr_number = ${t.number}
          and r.head_sha = ${t.headSha} and r.status = any(${[...blocking]}::text[])
          and not (r.status = 'planning' and r.started_at < now() - make_interval(secs => ${PLANNING_TIMEOUT_SECONDS}))
      )
      on conflict (key) do update set claimed_at = now(), run_id = null
      where webhook_claims.run_id is not null
         or webhook_claims.claimed_at < now() - ${stale}::interval
      returning key
    `;
    return rows.length > 0;
  } catch (err) {
    if (missingTable(err) && !retried) {
      await createClaimsTable();
      return takeClaim(key, t, blocking, stale, true);
    }
    throw err;
  }
}

/**
 * Takes the webhook claim for this PR head. True when this call got it. An old claim is taken
 * again when its run failed or had no preview, or when it never got a run and is stale, and only
 * while no other run that is planning, running, reporting or done exists for the same head.
 */
export function claim(t: ClaimTarget): Promise<boolean> {
  return takeClaim(claimKey(t), t, EXISTING_RUN_STATUSES, STALE_CLAIM);
}

/** Records the run that this claim started. */
export async function attachRun(t: ClaimTarget, runId: string): Promise<void> {
  await sql()`update webhook_claims set run_id = ${runId} where key = ${claimKey(t)}`;
}

/** Gives the claim back when no run came of it, so a later delivery can try again. */
export async function releaseClaim(t: ClaimTarget): Promise<void> {
  await sql()`delete from webhook_claims where key = ${claimKey(t)} and run_id is null`;
}

/**
 * Takes the live-run claim for this PR head. True when this call may insert a new run for it:
 * no run for the head is planning, running or reporting, and no other caller is between its
 * claim and its insert. A caller that loses finds the other run with activeRunFor.
 */
export function claimLiveHead(t: ClaimTarget): Promise<boolean> {
  return takeClaim(liveClaimKey(t), t, LIVE_RUN_STATUSES, STALE_LIVE_CLAIM);
}

/** Records the run that the live claim started. From then on, the run's status decides who may claim. */
export async function attachLiveRun(t: ClaimTarget, runId: string): Promise<void> {
  await sql()`update webhook_claims set run_id = ${runId} where key = ${liveClaimKey(t)}`;
}

/** Gives the live claim back when the run insert failed, so the next caller does not wait for it to go stale. */
export async function releaseLiveClaim(t: ClaimTarget): Promise<void> {
  await sql()`delete from webhook_claims where key = ${liveClaimKey(t)} and run_id is null`;
}
