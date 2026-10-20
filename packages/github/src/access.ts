// Who may see, launch and configure a connected repository (docs/github-access-contract.md section 5).
//
// accessFromFacts is the policy and is pure. resolveRepositoryAccess gathers the facts: the
// repository and installation rows, GET /repos/{o}/{r} as the person (their effective permission and
// the repository's current id), and the organization membership check. A failed or ambiguous check
// is state "unknown", never access. Server code only.

import type { Octokit } from "@octokit/rest";
import {
  CONFIGURE_LEVEL,
  LAUNCH_LEVEL,
  MEMBERSHIP_POLICY,
  VIEW_LEVEL,
  levelAtLeast,
  sql,
  type AccessLevel,
  type AccountType,
  type InstallationStatus,
  type RepositoryRow,
  type UserRow,
} from "@pinepoint/core";
import { isBadCredentials, isRateLimited, isSsoRequired, octokitForUser, ReauthorizeError } from "./user-tokens";

/** GitHub's effective permission names, from GET /repos/{o}/{r}.permissions. */
export type GithubPermission = "admin" | "maintain" | "push" | "triage" | "pull" | "none";

export interface AccessFacts {
  /** repositories.selected */
  repoSelected: boolean;
  /** installations.status, or null when the repository has no installation row. */
  installationStatus: InstallationStatus | null;
  /** The person's effective permission on GitHub. "none" when GitHub answers 404. */
  permission: GithubPermission;
  /** True when the person is a member of the owning organization (or is the owning user account). */
  member: boolean | "unknown";
  accountType: AccountType;
  /** False when GET /repos returned a different repository id than the one stored (a rename reused the name). */
  repoIdMatches: boolean;
}

export type AccessState =
  | "ok"
  | "not_selected"
  | "installation_suspended"
  | "installation_deleted"
  | "no_github_access"
  | "read_only"
  | "not_member"
  | "repo_mismatch"
  | "sso_required"
  | "rate_limited"
  | "reauthorize"
  | "unknown";

export interface AccessResult {
  level: AccessLevel;
  state: AccessState;
  /** One sentence for the person. Never names a token or an internal id. */
  reason: string;
  canView: boolean;
  canLaunch: boolean;
  canConfigure: boolean;
}

function result(level: AccessLevel, state: AccessState, reason: string): AccessResult {
  return {
    level,
    state,
    reason,
    canView: levelAtLeast(level, VIEW_LEVEL),
    canLaunch: levelAtLeast(level, LAUNCH_LEVEL),
    canConfigure: levelAtLeast(level, CONFIGURE_LEVEL),
  };
}

/** Maps the `permissions` object of GET /repos to one effective permission. Custom roles map by capability. */
export function permissionFromRepo(p: Partial<Record<"admin" | "maintain" | "push" | "triage" | "pull", boolean>> | null | undefined): GithubPermission {
  if (!p) return "none";
  if (p.admin) return "admin";
  if (p.maintain) return "maintain";
  if (p.push) return "push";
  if (p.triage) return "triage";
  if (p.pull) return "pull";
  return "none";
}

export const NONE: AccessResult = result("none", "no_github_access", "You do not have access to this repository.");

/** The policy. Pure. */
export function accessFromFacts(f: AccessFacts): AccessResult {
  if (!f.repoIdMatches) return result("none", "repo_mismatch", "This repository changed on GitHub. Reconnect it from the organization page.");
  if (f.installationStatus === "deleted" || f.installationStatus === null) {
    return result("none", "installation_deleted", "PinePoint is not installed on this repository any more.");
  }
  if (f.installationStatus === "suspended") return result("none", "installation_suspended", "The PinePoint installation is suspended.");
  if (!f.repoSelected) return result("none", "not_selected", "This repository is not selected in the PinePoint installation.");
  if (f.permission === "none") return NONE;
  const writes = f.permission === "push" || f.permission === "maintain" || f.permission === "admin";
  if (!writes) return result("read", "read_only", "You can read this repository, but launching QA needs write access.");
  if (MEMBERSHIP_POLICY === "members_only") {
    if (f.member === "unknown") return result("read", "unknown", "PinePoint could not confirm your organization membership.");
    if (!f.member) {
      return result(
        "read",
        "not_member",
        f.accountType === "Organization"
          ? "Only organization members can launch QA. Outside collaborators cannot."
          : "Only the owner of this account can launch QA on its repositories.",
      );
    }
  }
  const level: AccessLevel = f.permission === "maintain" || f.permission === "admin" ? "configure" : "write";
  return result(level, "ok", "");
}

// ---------- gathering facts ----------

export interface RepositoryWithContext extends RepositoryRow {
  installation_status: InstallationStatus | null;
  account_login: string;
  account_type: AccountType;
  github_account_id: number | string;
}

export async function loadRepositoryWithContext(repositoryId: string): Promise<RepositoryWithContext | null> {
  const rows = (await sql()`
    select r.*, i.status as installation_status, w.account_login, w.account_type, w.github_account_id
    from repositories r
    join workspaces w on w.id = r.workspace_id
    left join installations i on i.id = r.installation_id
    where r.id = ${repositoryId}
  `) as RepositoryWithContext[];
  return rows[0] ?? null;
}

async function loadUser(userId: string): Promise<UserRow | null> {
  const rows = (await sql()`select * from users where id = ${userId}`) as UserRow[];
  return rows[0] ?? null;
}

export interface GithubFacts {
  permission: GithubPermission;
  repoIdMatches: boolean;
  member: boolean | "unknown";
}

/** Reads the person's permission and the repository id from GitHub, then the membership. Throws GitHub errors. */
export async function githubFactsFor(
  gh: Octokit,
  user: Pick<UserRow, "login" | "github_user_id">,
  repo: Pick<RepositoryWithContext, "owner_login" | "name" | "github_repo_id" | "account_type" | "github_account_id">,
): Promise<GithubFacts> {
  let permission: GithubPermission = "none";
  let repoIdMatches = true;
  let ownerId: number | null = null;
  try {
    const { data } = await gh.repos.get({ owner: repo.owner_login, repo: repo.name });
    permission = permissionFromRepo(data.permissions);
    repoIdMatches = String(data.id) === String(repo.github_repo_id);
    ownerId = data.owner?.id ?? null;
  } catch (err) {
    if ((err as { status?: number })?.status === 404) return { permission: "none", repoIdMatches: true, member: false };
    throw err;
  }
  const writes = permission === "push" || permission === "maintain" || permission === "admin";
  if (!writes) return { permission, repoIdMatches, member: "unknown" };

  let member: boolean | "unknown";
  if (repo.account_type !== "Organization") {
    member = String(ownerId ?? repo.github_account_id) === String(user.github_user_id);
  } else {
    try {
      // 204 member; 404 not a member (or the caller cannot see members); 302 when the caller is not a member.
      const res = await gh.orgs.checkMembershipForUser({ org: repo.owner_login, username: user.login });
      member = (res.status as number) === 204;
    } catch (err) {
      const status = (err as { status?: number })?.status;
      if (status === 404 || status === 302) member = false;
      else if (status === 403) member = "unknown"; // The app has no Members read, or SSO. Fail closed.
      else throw err;
    }
  }
  return { permission, repoIdMatches, member };
}

const cache = new Map<string, { at: number; value: AccessResult }>();
/** How long a resolved access is reused for reads. Writes and launches pass fresh: true. */
export const ACCESS_CACHE_MS = 60_000;

export interface ResolveOptions {
  /** Skip the cache and ask GitHub now. The launch, the Computer starts and every GitHub write use this. */
  fresh?: boolean;
  /** For tests: the Octokit to use instead of the person's. */
  octokit?: Octokit;
  nowMs?: number;
}

/** Clears cached results for one user, one repository, or everything. Lifecycle webhooks call it. */
export function invalidateAccessCache(filter?: { userId?: string; repositoryId?: string }): void {
  if (!filter) {
    cache.clear();
    return;
  }
  for (const key of cache.keys()) {
    const [u, r] = key.split(":");
    if ((filter.userId && u === filter.userId) || (filter.repositoryId && r === filter.repositoryId)) cache.delete(key);
  }
}

/**
 * The person's access to a connected repository. Never throws for a GitHub problem: it answers a
 * state (sso_required, rate_limited, reauthorize, unknown) with level "none", which every caller
 * treats as denied.
 */
export async function resolveRepositoryAccess(userId: string, repositoryId: string, opts: ResolveOptions = {}): Promise<AccessResult> {
  const now = opts.nowMs ?? Date.now();
  const key = `${userId}:${repositoryId}`;
  if (!opts.fresh) {
    const hit = cache.get(key);
    if (hit && now - hit.at < ACCESS_CACHE_MS) return hit.value;
  }
  const value = await resolveUncached(userId, repositoryId, opts);
  // Only a settled answer is worth caching. A transient state is asked again next time.
  if (value.state !== "unknown" && value.state !== "rate_limited") cache.set(key, { at: now, value });
  return value;
}

async function resolveUncached(userId: string, repositoryId: string, opts: ResolveOptions): Promise<AccessResult> {
  const [repo, user] = await Promise.all([loadRepositoryWithContext(repositoryId), loadUser(userId)]);
  if (!repo || !user) return NONE;
  if (!repo.selected || repo.installation_status !== "active") {
    return accessFromFacts({
      repoSelected: repo.selected,
      installationStatus: repo.installation_status,
      permission: "none",
      member: false,
      accountType: repo.account_type,
      repoIdMatches: true,
    });
  }
  let gh: Octokit;
  try {
    gh = opts.octokit ?? (await octokitForUser(userId));
  } catch (err) {
    if (err instanceof ReauthorizeError) return result("none", "reauthorize", "Sign in with GitHub again to continue.");
    throw err;
  }
  let facts: GithubFacts;
  try {
    facts = await githubFactsFor(gh, user, repo);
  } catch (err) {
    if (isSsoRequired(err)) return result("none", "sso_required", "Your organization requires SAML single sign-on. Authorize PinePoint for it on GitHub.");
    if (isRateLimited(err)) return result("none", "rate_limited", "GitHub rate limited the access check. Try again in a minute.");
    if (isBadCredentials(err)) return result("none", "reauthorize", "Sign in with GitHub again to continue.");
    console.warn(`[access] check failed for user ${userId} on repository ${repositoryId}: ${(err as Error).message}`);
    return result("none", "unknown", "PinePoint could not check your access on GitHub. Try again.");
  }
  return accessFromFacts({
    repoSelected: repo.selected,
    installationStatus: repo.installation_status,
    permission: facts.permission,
    member: facts.member,
    accountType: repo.account_type,
    repoIdMatches: facts.repoIdMatches,
  });
}
