// Response types for the /app dashboard. Field names match db/001_init.sql.

export type RunStatus =
  | "planning"
  | "running"
  | "reporting"
  | "done"
  | "failed"
  | "no_preview";

export type MissionStatus =
  | "queued"
  | "running"
  | "passed"
  | "failed"
  | "blocked"
  | "needs_you"
  | "error";

export type FindingLevel = "bug" | "possible" | "old_bug";

export interface Run {
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
  // Postgres numeric can arrive as a string.
  cost_usd: number | string | null;
  started_at: string | null;
  finished_at: string | null;
}

// A missions row without pine_enc. The API never sends pine_enc.
export interface Mission {
  id: string;
  run_id: string;
  kind: "preview" | "flake" | "production" | "rerun";
  parent_id: string | null;
  lens: string | null;
  persona: string | null;
  goal: string | null;
  checks: unknown;
  target_path: string | null;
  target_line: number | null;
  new_feature: boolean | null;
  url: string | null;
  status: MissionStatus;
  result: unknown;
  screenshot_url: string | null;
  usage: unknown;
  started_at: string | null;
  finished_at: string | null;
}

export interface Finding {
  id: string;
  run_id: string;
  mission_ids: string[] | null;
  level: FindingLevel | null;
  title: string | null;
  steps: string[] | null;
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

// GET /api/runs/[id]/status
export interface StatusResponse {
  run: Run;
  missions: Mission[];
  findings: Finding[];
}

// GET /api/runs (last 10 runs, newest first)
export interface RunsResponse {
  runs: Run[];
}

// POST /api/runs with { prUrl }
export interface CreateRunRequest {
  prUrl: string;
}
export interface CreateRunResponse {
  runId: string;
}

export const TERMINAL_RUN_STATUSES: RunStatus[] = [
  "done",
  "failed",
  "no_preview",
];
