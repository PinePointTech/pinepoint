// Creates a run and its missions in the database. POST /api/runs calls this after the planner.

import { sql, type Mission } from "@pinepoint/core";

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
 * Inserts the run with status `running` and one queued preview mission per planned mission.
 * Returns the run id. startRun(runId) then starts the first Computers.
 */
export async function createRun(input: CreateRunInput, missions: Mission[]): Promise<string> {
  if (!input.previewUrl) {
    throw new Error("createRun needs a preview URL. Use createNoPreviewRun when there is none.");
  }
  const rows = (await sql()`
    insert into runs (pr_url, owner, repo, pr_number, head_sha, author, preview_url, production_url, qa_md, status)
    values (${input.prUrl}, ${input.owner}, ${input.repo}, ${input.prNumber}, ${input.headSha}, ${input.author},
            ${input.previewUrl}, ${input.productionUrl}, ${input.qaMd}, 'running')
    returning id
  `) as Array<{ id: string }>;
  const runId = rows[0]!.id;

  // One insert per mission keeps each statement simple for the HTTP driver. Ten rows is fast.
  for (const m of missions) {
    const checks = JSON.stringify(m.checks);
    await sql()`
      insert into missions (run_id, kind, lens, persona, goal, checks, target_path, target_line, new_feature, url, status)
      values (${runId}, 'preview', ${m.lens}, ${m.persona}, ${m.goal}, ${checks}::jsonb,
              ${m.target?.path ?? null}, ${m.target?.line ?? null}, ${m.newFeature}, ${input.previewUrl}, 'queued')
    `;
  }
  return runId;
}

/** The last `limit` runs, newest first, for the history list (plan section 9.2). */
export async function listRecentRuns(limit = 10) {
  // Every column except qa_md, which the history list does not need.
  return sql()`
    select id, pr_url, owner, repo, pr_number, head_sha, author, preview_url, production_url, status,
           review_id, review_posted_at, cost_usd, started_at, finished_at, next_start_at
    from runs order by started_at desc nulls last limit ${limit}
  `;
}
