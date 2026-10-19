// Creates a run and its missions in the database.
//
// POST /api/runs and the GitHub webhook first insert the run with status `planning`
// (createPlanningRun), answer, and plan in the background. addMissions then saves the plan and
// moves the run to `running`. createRun does both in one call for scripts.
//
// A `planning` run older than PLANNING_TIMEOUT_MS belongs to a background step that died. It does
// not count as a live run, and expireStalePlanning moves it to failed.

import {
  ensureRunErrorColumn,
  isUndefinedColumn,
  sql,
  withRunErrorColumn,
  type Mission,
  type RunRow,
  type RunStatus,
} from "@pinepoint/core";
import { PLANNING_TIMEOUT_ERROR, PLANNING_TIMEOUT_MS } from "./decide";

/**
 * Who a run belongs to (db/008, docs/github-access-contract.md section 3). Omitted for a legacy
 * demo run. When set, all three ids are required: a private run cannot be half-owned.
 */
export interface RunOwner {
  workspaceId: string;
  repositoryId: string;
  initiatedByUserId: string;
}

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
  /** Null or omitted: a legacy run (trigger "legacy"). Set: a private manual run (trigger "manual"). */
  ownedBy?: RunOwner | null;
}

/** The ownership columns of an insert. Pure, so the test can check that a half owner is refused. */
export function ownershipColumns(ownedBy: RunOwner | null | undefined): {
  workspace_id: string | null;
  repository_id: string | null;
  initiated_by_user_id: string | null;
  trigger: "legacy" | "manual";
} {
  if (!ownedBy) return { workspace_id: null, repository_id: null, initiated_by_user_id: null, trigger: "legacy" };
  if (!ownedBy.workspaceId || !ownedBy.repositoryId || !ownedBy.initiatedByUserId) {
    throw new Error("A private run needs workspaceId, repositoryId and initiatedByUserId.");
  }
  return {
    workspace_id: ownedBy.workspaceId,
    repository_id: ownedBy.repositoryId,
    initiated_by_user_id: ownedBy.initiatedByUserId,
    trigger: "manual",
  };
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

/** PLANNING_TIMEOUT_MS in seconds, for make_interval in SQL. */
export const PLANNING_TIMEOUT_SECONDS = PLANNING_TIMEOUT_MS / 1000;

/**
 * The newest run for this PR head whose status is one of `statuses`, or null. A `planning` run
 * past the planning timeout does not count: its background step died.
 */
export async function activeRunFor(
  t: RunTarget,
  statuses: readonly RunStatus[] = EXISTING_RUN_STATUSES,
): Promise<{ id: string; status: RunStatus } | null> {
  const rows = (await sql().query(
    `select id, status from runs
     where owner = $1 and repo = $2 and pr_number = $3 and head_sha = $4 and status = any($5::text[])
       and not (status = 'planning' and started_at < now() - make_interval(secs => $6))
     order by started_at desc nulls last
     limit 1`,
    [t.owner, t.repo, t.number, t.headSha, [...statuses], PLANNING_TIMEOUT_SECONDS],
  )) as Array<{ id: string; status: RunStatus }>;
  return rows[0] ?? null;
}

/**
 * Moves every `planning` run past the planning timeout to failed, with PLANNING_TIMEOUT_ERROR.
 * With a target, only the runs of that PR head. advanceRun does the same for one run, but only a
 * status poll calls it, and nobody polls a run that the webhook started. Returns how many it failed.
 */
export async function expireStalePlanning(t?: RunTarget): Promise<number> {
  const owner = t?.owner ?? null;
  const rows = await withRunErrorColumn(
    () => sql()`
      update runs set status = 'failed', error = ${PLANNING_TIMEOUT_ERROR}, finished_at = now()
      where status = 'planning' and started_at < now() - make_interval(secs => ${PLANNING_TIMEOUT_SECONDS})
        and (${owner}::text is null
             or (owner = ${owner} and repo = ${t?.repo ?? null} and pr_number = ${t?.number ?? null}
                 and head_sha = ${t?.headSha ?? null}))
      returning id
    `,
  );
  return rows.length;
}

/** Inserts a run with status `no_preview`. Nothing else happens for it. */
export async function createNoPreviewRun(input: CreateRunInput): Promise<string> {
  const o = ownershipColumns(input.ownedBy);
  const rows = (await sql()`
    insert into runs (pr_url, owner, repo, pr_number, head_sha, author, preview_url, production_url, status, finished_at,
                      workspace_id, repository_id, initiated_by_user_id, trigger)
    values (${input.prUrl}, ${input.owner}, ${input.repo}, ${input.prNumber}, ${input.headSha}, ${input.author},
            null, ${input.productionUrl}, 'no_preview', now(),
            ${o.workspace_id}, ${o.repository_id}, ${o.initiated_by_user_id}, ${o.trigger})
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
  const o = ownershipColumns(input.ownedBy);
  const rows = (await sql()`
    insert into runs (pr_url, owner, repo, pr_number, head_sha, author, preview_url, production_url, qa_md, status,
                      workspace_id, repository_id, initiated_by_user_id, trigger)
    values (${input.prUrl}, ${input.owner}, ${input.repo}, ${input.prNumber}, ${input.headSha}, ${input.author},
            ${input.previewUrl}, ${input.productionUrl}, ${input.qaMd}, 'planning',
            ${o.workspace_id}, ${o.repository_id}, ${o.initiated_by_user_id}, ${o.trigger})
    returning id
  `) as Array<{ id: string }>;
  return rows[0]!.id;
}

/**
 * Deletes a run that is still `planning` and has no missions: one whose quota admission was
 * refused right after the insert. Nothing else references it yet. True when a row was deleted.
 */
export async function discardPlanningRun(runId: string): Promise<boolean> {
  const rows = await sql()`
    delete from runs where id = ${runId} and status = 'planning'
      and not exists (select 1 from missions m where m.run_id = runs.id)
    returning id
  `;
  return rows.length > 0;
}

/**
 * Moves the run from `planning` to `running` and inserts one queued preview mission per planned
 * mission, in one statement: a status poll sees the run with all its missions or with none, and a
 * failed insert leaves no missions behind. A run that is not planning any more (it timed out) gets
 * no missions. Returns true when the run is now running, false when it was not planning.
 * startRun(runId) then starts the first Computers.
 */
export async function addMissions(runId: string, missions: Mission[]): Promise<boolean> {
  // A running run with no missions never completes (runIsComplete), so an empty plan is an error.
  if (missions.length === 0) throw new Error("The plan has no missions.");
  const rowsJson = JSON.stringify(
    missions.map((m) => ({
      lens: m.lens,
      persona: m.persona,
      goal: m.goal,
      checks: m.checks,
      target_path: m.target?.path ?? null,
      target_line: m.target?.line ?? null,
      new_feature: m.newFeature,
    })),
  );
  const rows = await sql()`
    with r as (
      update runs set status = 'running' where id = ${runId} and status = 'planning' returning id, preview_url
    )
    insert into missions (run_id, kind, lens, persona, goal, checks, target_path, target_line, new_feature, url, status)
    select r.id, 'preview', m.lens, m.persona, m.goal, m.checks, m.target_path, m.target_line, m.new_feature,
           r.preview_url, 'queued'
    from r
    cross join jsonb_to_recordset(${rowsJson}::jsonb)
      as m(lens text, persona text, goal text, checks jsonb, target_path text, target_line int, new_feature boolean)
    returning id
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

export type RecentRun = Omit<RunRow, "qa_md">;

/**
 * Which runs a history list shows (docs/github-access-contract.md section 7).
 *   legacy:        runs with no workspace (the public demo). The list without a session.
 *   repositories:  runs of these repository ids only. The list with a session: the caller passes
 *                  the repositories the person may view, so an empty list shows nothing.
 */
export type RunListScope = { kind: "legacy" } | { kind: "repositories"; repositoryIds: string[] };

/**
 * The last `limit` runs in `scope`, newest first, for the history list (plan section 9.2). Every
 * column except qa_md, which the history list does not need. The list never depends on DDL: when
 * runs.error is missing and cannot be added, it reads error as null.
 */
export async function listRecentRuns(limit = 10, scope: RunListScope = { kind: "legacy" }): Promise<RecentRun[]> {
  if (scope.kind === "repositories" && scope.repositoryIds.length === 0) return [];
  // A dead plan would show as planning forever. Best effort: the list works without it.
  await expireStalePlanning().catch((err: Error) =>
    console.warn(`[runs] could not expire stale planning runs: ${err.message}`),
  );
  const where = scope.kind === "legacy" ? "workspace_id is null" : "repository_id = any($2::uuid[])";
  const params: unknown[] = scope.kind === "legacy" ? [limit] : [limit, scope.repositoryIds];
  const select = (errorColumn: string) =>
    sql().query(
      `select id, pr_url, owner, repo, pr_number, head_sha, author, preview_url, production_url, status,
              review_id, review_posted_at, cost_usd, started_at, finished_at, next_start_at, ${errorColumn},
              workspace_id, repository_id, initiated_by_user_id, trigger
       from runs where ${where} order by started_at desc nulls last limit $1`,
      params,
    );
  let ddlFailed = false;
  try {
    return (await withRunErrorColumn(
      () => select("error"),
      () =>
        ensureRunErrorColumn().catch((err: unknown) => {
          ddlFailed = true;
          throw err;
        }),
    )) as RecentRun[];
  } catch (err) {
    if (!ddlFailed && !isUndefinedColumn(err)) throw err;
    console.warn(`[runs] runs.error is not available, the history list sends null: ${(err as Error).message}`);
    return (await select("null::text as error")) as RecentRun[];
  }
}
