// Row types for the runs, missions and findings tables (plan section 4.3, db/001_init.sql, db/002_run_state.sql,
// db/005_run_error.sql).
// The Neon HTTP driver returns plain objects. These types name their columns.

/** runs.status */
export const RUN_STATUSES = ["planning", "running", "reporting", "done", "failed", "no_preview"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

/** missions.status. queued and running change; the rest are end states. */
export const MISSION_STATUSES = ["queued", "running", "passed", "failed", "blocked", "needs_you", "error"] as const;
export type MissionStatus = (typeof MISSION_STATUSES)[number];

/** The end states. A mission in one of these never changes again. */
export const MISSION_END_STATUSES: readonly MissionStatus[] = ["passed", "failed", "blocked", "needs_you", "error"];

/** missions.kind */
export const MISSION_KINDS = ["preview", "flake", "production", "rerun"] as const;
export type MissionKind = (typeof MISSION_KINDS)[number];

export interface RunRow {
  id: string;
  pr_url: string;
  owner: string;
  repo: string;
  pr_number: number;
  head_sha: string | null;
  author: string | null;
  preview_url: string | null;
  production_url: string | null;
  status: RunStatus;
  review_id: number | null;
  review_posted_at: string | null;
  cost_usd: string | number | null;
  started_at: string | null;
  finished_at: string | null;
  next_start_at: string | null;
  qa_md: string | null;
  /** Why the run failed, for example "Planning failed: ...". null for every other status. */
  error: string | null;
  /** Ownership (db/008). Null workspace_id marks a legacy run: public demo data with no tenant. */
  workspace_id: string | null;
  repository_id: string | null;
  initiated_by_user_id: string | null;
  /** How the run started. "legacy" for old rows and demo runs without a session, "manual" for Run QA. */
  trigger: "legacy" | "manual";
}

/** True for a run that belongs to a workspace, so every read and write of it needs repository access. */
export function isPrivateRun(run: Pick<RunRow, "workspace_id">): boolean {
  return run.workspace_id !== null && run.workspace_id !== undefined;
}

export interface MissionRow {
  id: string;
  run_id: string;
  kind: MissionKind;
  parent_id: string | null;
  lens: string | null;
  persona: string | null;
  goal: string | null;
  /** The planner's checks: [{ name, expected }]. */
  checks: Array<{ name: string; expected: string }> | null;
  target_path: string | null;
  target_line: number | null;
  new_feature: boolean;
  url: string | null;
  status: MissionStatus;
  /** result.json, plus `question` or `reason` when the runner adds them. */
  result: Record<string, unknown> | null;
  screenshot_url: string | null;
  usage: Record<string, unknown> | null;
  /** Never sent to the browser. Routes drop it before they respond. */
  pine_enc: string | null;
  kept: boolean;
  started_at: string | null;
  finished_at: string | null;
}

export interface FindingRow {
  id: string;
  run_id: string;
  mission_ids: string[] | null;
  level: "bug" | "possible" | "old_bug" | null;
  title: string | null;
  steps: unknown;
  expected: string | null;
  saw: string | null;
  production_saw: string | null;
  screenshot_url: string | null;
  path: string | null;
  line: number | null;
  comment_id: number | null;
  decision: "bug" | "not_bug" | null;
  decided_at: string | null;
  fix: unknown;
  fix_comment_id: number | null;
  rerun_status: string | null;
}

/**
 * A mission row without the encrypted Pine handle. This is what the API returns.
 * has_computer tells the browser that a Computer was started for the mission (pine_enc is set).
 */
export type PublicMissionRow = Omit<MissionRow, "pine_enc"> & { has_computer: boolean };

export function toPublicMission(row: MissionRow): PublicMissionRow {
  const { pine_enc: pineEnc, ...rest } = row;
  return { ...rest, has_computer: pineEnc !== null && pineEnc !== undefined };
}
