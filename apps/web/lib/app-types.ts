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
  // Set when Pine rate limited a Computer create. No start happens before this time.
  next_start_at?: string | null;
  // Why the run failed. Null otherwise.
  error?: string | null;
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
  // True when the mission has a Pine Computer handle (pine_enc is set). A running
  // mission with false is still waiting for its Computer to start.
  has_computer?: boolean;
  // True when the Computer stays on after the mission ends (a failed preview or needs_you).
  kept?: boolean;
  started_at: string | null;
  finished_at: string | null;
}

// One fix from the fix agent (plan section 8.3). The same shape as FixSchema in @pinepoint/ai.
export interface Fix {
  path: string;
  startLine: number;
  endLine: number;
  replacement: string;
  explanation: string;
  confidence: "high" | "medium" | "low";
}

// What findings.fix stores. `fix` is null when the agent gave a reason instead.
export interface StoredFix {
  fix: Fix | null;
  reason: string | null;
  model: string;
  attempts: number;
  createdAt: string;
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
  fix: StoredFix | null;
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

// POST /api/runs. The route answers in a few seconds: 202 with status "planning" for a new
// run, 200 with existing: true for a run of the same commit that is still going, 200 with
// status "no_preview" when the PR has no preview. Two shapes (docs/github-access-contract.md
// section 7): a PR URL alone is the public demo; repositoryId + prNumber is a private manual
// run on a connected repository and needs a session.
export type CreateRunRequest =
  | { prUrl: string; previewUrl?: string; force?: boolean }
  | { repositoryId: string; prNumber: number; expectedHeadSha?: string; force?: boolean };
export interface CreateRunResponse {
  runId: string;
  status: RunStatus;
  existing: boolean;
}

// ---------- sign-in and connected repositories (VI-30, VI-31, VI-35) ----------

export interface PublicUser {
  id: string;
  login: string;
  name: string | null;
  avatarUrl: string | null;
}

// GET /api/auth/me
export interface MeResponse {
  user: PublicUser | null;
  signInAvailable: boolean;
}

export type AccessLevel = "none" | "read" | "write" | "configure";
export type AccessState =
  | "ok"
  | "read_only"
  | "not_member"
  | "no_access"
  | "not_selected"
  | "installation_inactive"
  | "unknown"
  | "rate_limited"
  | "sso_required"
  | "reauthorize";

export interface AccessView {
  level: AccessLevel;
  state: AccessState | string;
  reason: string;
  canLaunch: boolean;
  canConfigure: boolean;
}

// GET /api/workspaces
export interface WorkspaceView {
  id: string;
  login: string;
  type: "Organization" | "User";
  installationStatus: "active" | "suspended" | "deleted" | "pending" | null;
  repositoryCount: number;
}
export interface WorkspacesResponse {
  connected: WorkspaceView[];
  unconnected: Array<{ installationId: number; login: string; type: "Organization" | "User" }>;
  installAvailable: boolean;
}

// GET /api/workspaces/[id]/repositories
export interface RepositoryView {
  id: string;
  fullName: string;
  name: string;
  owner: string;
  private: boolean;
  defaultBranch: string | null;
  access: AccessView;
}
export interface RepositoriesResponse {
  repositories: RepositoryView[];
}

// GET /api/repositories/[id]/pulls
export interface PullView {
  number: number;
  title: string;
  url: string;
  author: string;
  draft: boolean;
  headSha: string;
  headRef: string;
  isFork: boolean;
  updatedAt: string;
}
export interface PullsResponse {
  pulls: PullView[];
}

export type PreviewState = "ready" | "building" | "failed" | "missing" | "protected" | "unreachable" | "unsafe";

// POST /api/repositories/[id]/preflight
export interface PreflightResponse {
  ok: true;
  canRun: boolean;
  blockers: string[];
  access: AccessView;
  pr: { number: number; title: string; url: string; state: "open" | "closed"; draft: boolean; isFork: boolean; headSha: string; headRef: string; author: string };
  preview: { state: PreviewState; url: string | null; note: string };
  qaFile: { path: string; exists: boolean; note: string };
  quota: Array<{ scope: string; limit: number; used: number }>;
}

// GET and PUT /api/repositories/[id]/settings
export interface RepositorySettingsView {
  qaMdPath: string;
  previewProjectName: string | null;
  productionUrl: string | null;
  canConfigure: boolean;
  updatedAt: string | null;
}

export const TERMINAL_RUN_STATUSES: RunStatus[] = [
  "done",
  "failed",
  "no_preview",
];
