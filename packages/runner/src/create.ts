// Creates a run and its missions in the database.
//
// POST /api/runs and the GitHub webhook first insert the run with status `planning`
// (createPlanningRun), answer, and plan in the background. addMissions then saves the plan and
// moves the run to `running`. createRun does both in one call for scripts.

import { sql, withRunErrorColumn, type Mission, type RunStatus } from "@pinepoint/core";

export interface CreateRunInput {
  prUrl: string;
  owner: string;
  repo: string;
  prNumber: number;
  headSha: string | null;
  author: string | null;
  previewUrl: string | null;
  productionUrl: string | null;
  qaMd: string;
}

/** One PR head. The same field names as the webhook's claim target. */
export interface RunTarget {
  owner: string;
  repo: string;
  number: number;
  headSha: string;
}

/** A run in one of these states is still at work. POST /api/runs does not start a second one for the same head. */
export const LIVE_RUN_STATUSES: readonly RunStatus[] = ["planning", "running", "reporting"];

/** Every status except failed and no_preview: the webhook starts no run when one of these exists for the head. */
export const EXISTING_RUN_STATUSES: readonly RunStatus[] = ["planning", "running", "reporting", "done"];

/** The newest run for this PR head whose status is one of `statuses`, or null. */
export async function activeRunFor(
  t: RunTarget,
  statuses: readonly RunStatus[] = EXISTING_RUN_STATUSES,
): Promise<{ id: string; status: RunStatus } | null> {
  const rows = (await sql().query(
    `select id, status from runs
     where owner = $1 and repo = $2 and pr_number = $3 and head_sha = $4 and status = any($5::text[])
     order by started_at desc nulls last
     limit 1`,
    [t.owner, t.repo, t.number, t.headSha, [...statuses]],
  )) as Array<{ id: string; status: RunStatus }>;
  return rows[0] ?? null;
}

/** Inserts a run with status `no_preview`. Nothing else happens for it. */
export async function createNoPreviewRun(input: CreateRunInput): Promise<string> {
  const rows = (await sql()`
    insert into runs (pr_url, owner, repo, pr_number, head_sha, author, preview_url, production_url, status, finished_at)
    values (${input.prUrl}, ${input.owner}, ${input.repo}, ${input.prNumber}, ${input.headSha}, ${input.author},
            null, ${input.productionUrl}, 'no_preview', now())
    returning id
  `) as Array<{ id: string }>;
  return rows[0]!.id;
}

/**
 * Inserts the run with status `planning` and no missions. Returns the run id.
 * addMissions saves the plan later. advanceRun fails the run when the plan does not come in 6 minutes.
 */
export async function createPlanningRun(input: CreateRunInput): Promise<string> {
  if (!input.previewUrl) {
    throw new Error("createPlanningRun needs a preview URL. Use createNoPreviewRun when there is none.");
  }
  const rows = (await sql()`
    insert into runs (pr_url, owner, repo, pr_number, head_sha, author, preview_url, production_url, qa_md, status)
    values (${input.prUrl}, ${input.owner}, ${input.repo}, ${input.prNumber}, ${input.headSha}, ${input.author},
            ${input.previewUrl}, ${input.productionUrl}, ${input.qaMd}, 'planning')
    returning id
  `) as Array<{ id: string }>;
  return rows[0]!.id;
}

/**
 * Inserts one queued preview mission per planned mission, then moves the run from `planning` to
 * `running`. Each insert runs only while the run is still planning, so a run that timed out gets
 * no new missions. Returns true when the run is now running, false when it was not planning any more.
 * startRun(runId) then starts the first Computers.
 */
export async function addMissions(runId: string, missions: Mission[]): Promise<boolean> {
  // One insert per mission keeps each statement simple for the HTTP driver. Ten rows is fast.
  for (const m of missions) {
    const checks = JSON.stringify(m.checks);
    const rows = await sql()`
      insert into missions (run_id, kind, lens, persona, goal, checks, target_path, target_line, new_feature, url, status)
      select r.id, 'preview', ${m.lens}, ${m.persona}, ${m.goal}, ${checks}::jsonb,
             ${m.target?.path ?? null}, ${m.target?.line ?? null}, ${m.newFeature}, r.preview_url, 'queued'
      from runs r
      where r.id = ${runId} and r.status = 'planning'
      returning id
    `;
    if (rows.length === 0) return false;
  }
  const rows = await sql()`
    update runs set status = 'running' where id = ${runId} and status = 'planning' returning id
  `;
  return rows.length > 0;
}

/**
 * Inserts the run and one queued preview mission per planned mission, with status `running`.
 * Returns the run id. startRun(runId) then starts the first Computers.
 */
export async function createRun(input: CreateRunInput, missions: Mission[]): Promise<string> {
  const runId = await createPlanningRun(input);
  if (!(await addMissions(runId, missions))) {
    throw new Error(`Run ${runId} left planning before its missions were saved.`);
  }
  return runId;
}

/** The last `limit` runs, newest first, for the history list (plan section 9.2). */
export async function listRecentRuns(limit = 10) {
  // Every column except qa_md, which the history list does not need.
  return withRunErrorColumn(
    () => sql()`
      select id, pr_url, owner, repo, pr_number, head_sha, author, preview_url, production_url, status,
             review_id, review_posted_at, cost_usd, started_at, finished_at, next_start_at, error
      from runs order by started_at desc nulls last limit ${limit}
    `,
  );
}
