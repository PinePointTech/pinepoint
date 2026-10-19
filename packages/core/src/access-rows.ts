// Row types for the sign-in and organization access tables (db/008_github_access.sql) and the
// policy constants from docs/github-access-contract.md. Server code only.

export interface UserRow {
  id: string;
  github_user_id: number | string;
  login: string;
  name: string | null;
  avatar_url: string | null;
  created_at: string;
  last_seen_at: string;
}

/** What the browser may know about the signed-in person. Never a token. */
export interface PublicUser {
  id: string;
  login: string;
  name: string | null;
  avatarUrl: string | null;
}

export function toPublicUser(row: Pick<UserRow, "id" | "login" | "name" | "avatar_url">): PublicUser {
  return { id: row.id, login: row.login, name: row.name, avatarUrl: row.avatar_url };
}

export interface UserCredentialRow {
  user_id: string;
  access_enc: string;
  access_expires_at: string | null;
  refresh_enc: string | null;
  refresh_expires_at: string | null;
  token_type: string;
  scope: string | null;
  updated_at: string;
  revoked_at: string | null;
}

export interface SessionRow {
  id: string;
  user_id: string;
  token_hash: string;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
  revoked_at: string | null;
}

export type AccountType = "Organization" | "User";

export interface WorkspaceRow {
  id: string;
  github_account_id: number | string;
  account_login: string;
  account_type: AccountType;
  created_at: string;
  updated_at: string;
}

export const INSTALLATION_STATUSES = ["active", "suspended", "deleted"] as const;
export type InstallationStatus = (typeof INSTALLATION_STATUSES)[number];

export interface InstallationRow {
  id: string;
  github_installation_id: number | string;
  workspace_id: string;
  status: InstallationStatus;
  repository_selection: "selected" | "all";
  permissions: Record<string, string> | null;
  installed_by_github_user_id: number | string | null;
  created_at: string;
  updated_at: string;
  suspended_at: string | null;
  deleted_at: string | null;
}

export interface RepositoryRow {
  id: string;
  github_repo_id: number | string;
  workspace_id: string;
  installation_id: string | null;
  full_name: string;
  name: string;
  owner_login: string;
  private: boolean;
  default_branch: string | null;
  selected: boolean;
  created_at: string;
  updated_at: string;
  deselected_at: string | null;
}

export interface RepositorySettingsRow {
  repository_id: string;
  qa_md_path: string;
  preview_project_name: string | null;
  production_url: string | null;
  updated_by_user_id: string | null;
  updated_at: string;
}

/** The settings a repository has before anyone saved any. */
export const DEFAULT_REPOSITORY_SETTINGS: Pick<RepositorySettingsRow, "qa_md_path" | "preview_project_name" | "production_url"> = {
  qa_md_path: "qa.md",
  preview_project_name: null,
  production_url: null,
};

/** runs.trigger. legacy: a run from before ownership existed, or a demo run without a session. */
export const RUN_TRIGGERS = ["legacy", "manual"] as const;
export type RunTrigger = (typeof RUN_TRIGGERS)[number];

/** The ownership columns that db/008 adds to runs. */
export interface RunOwnership {
  workspace_id: string | null;
  repository_id: string | null;
  initiated_by_user_id: string | null;
  trigger: RunTrigger;
}

export const RUN_ACTIONS = [
  "launch",
  "decision",
  "fix_request",
  "fix_post",
  "review_post",
  "access_lost",
  "settings_update",
  "workspace_connect",
  "sign_in",
] as const;
export type RunAction = (typeof RUN_ACTIONS)[number];

export interface RunActionRow {
  id: string;
  run_id: string | null;
  finding_id: string | null;
  user_id: string | null;
  action: RunAction;
  detail: Record<string, unknown> | null;
  created_at: string;
}

// ---------- policy (contract section 5) ----------

/**
 * What a person may do with a repository, from least to most. `unknown` is not access: a check that
 * failed (rate limit, 5xx, a missing app permission) lands here, and every write path denies it.
 */
export const ACCESS_LEVELS = ["none", "read", "write", "configure"] as const;
export type AccessLevel = (typeof ACCESS_LEVELS)[number];

export function levelAtLeast(level: AccessLevel, required: AccessLevel): boolean {
  return ACCESS_LEVELS.indexOf(level) >= ACCESS_LEVELS.indexOf(required);
}

/** Viewing a private run, its findings, pictures and desktops. Writer-only in v1 (decision 2). */
export const VIEW_LEVEL: AccessLevel = "write";
/** Launching, controlling, deciding, requesting and posting fixes. */
export const LAUNCH_LEVEL: AccessLevel = "write";
/** Changing repository settings (decision 5). */
export const CONFIGURE_LEVEL: AccessLevel = "configure";
/** Outside collaborators are not eligible in v1 (decision 1). */
export const MEMBERSHIP_POLICY: "members_only" | "any_collaborator" = "members_only";

// ---------- limits (contract section 8) ----------

export const LIMITS = {
  /** Live runs (planning, running, reporting) one person may have at once. */
  userConcurrent: 2,
  /** Live runs one repository may have at once. */
  repositoryConcurrent: 2,
  /** Live runs one workspace may have at once. */
  workspaceConcurrent: 4,
  /** Runs one workspace may start in one UTC day. */
  workspaceDaily: 20,
} as const;

/** Days a workspace with a deleted installation keeps its data before it is purgeable (decision 8). */
export const DISCONNECTED_RETENTION_DAYS = 30;
