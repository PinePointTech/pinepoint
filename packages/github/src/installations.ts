// Workspaces, installations and repository grants (docs/github-access-contract.md section 3; VI-31).
//
// Two sources write these rows, both verified:
//   - the install callback: the person returns from GitHub with ?installation_id=. The app JWT reads
//     GET /app/installations/{id} (the account the installation belongs to), and the person's own
//     GET /user/installations must list the same id. Only then is the connection stored, under the
//     workspace of the account GitHub named. A forged id cannot attach another account's installation.
//   - signed lifecycle webhooks: installation, installation_repositories, github_app_authorization.
//     Idempotent by X-GitHub-Delivery (webhook_deliveries).
// Server code only.

import { Octokit } from "@octokit/rest";
import { sql, type AccountType, type InstallationRow, type InstallationStatus, type RepositoryRow, type WorkspaceRow } from "@pinepoint/core";
import { invalidateAccessCache } from "./access";
import { appJwt, githubAppConfig } from "./app";
import { markCredentialRevokedByGithubId } from "./user-tokens";

export interface InstallationFacts {
  installationId: number;
  account: { id: number; login: string; type: AccountType };
  repositorySelection: "selected" | "all";
  permissions: Record<string, string>;
  suspended: boolean;
  installedByGithubUserId: number | null;
}

export interface RepositoryFacts {
  id: number;
  fullName: string;
  name: string;
  ownerLogin: string;
  private: boolean;
  defaultBranch: string | null;
}

/** An Octokit that authenticates as the app (JWT). Read-only use. */
export function appOctokit(): Octokit {
  const config = githubAppConfig();
  return new Octokit({ auth: appJwt(config), userAgent: "pinepoint" });
}

function accountType(type: string | undefined): AccountType {
  return type === "Organization" ? "Organization" : "User";
}

/** GET /app/installations/{id} as the app. Null for 404. */
export async function readInstallation(installationId: number, app: Octokit = appOctokit()): Promise<InstallationFacts | null> {
  try {
    const { data } = await app.apps.getInstallation({ installation_id: installationId });
    const account = data.account as { id: number; login?: string; slug?: string; type?: string } | null;
    if (!account) return null;
    return {
      installationId: data.id,
      account: { id: account.id, login: account.login ?? account.slug ?? String(account.id), type: accountType(account.type) },
      repositorySelection: data.repository_selection === "all" ? "all" : "selected",
      permissions: (data.permissions ?? {}) as Record<string, string>,
      suspended: data.suspended_at !== null && data.suspended_at !== undefined,
      installedByGithubUserId: null,
    };
  } catch (err) {
    if ((err as { status?: number })?.status === 404) return null;
    throw err;
  }
}

/** The installations the person can see, from GET /user/installations with their token. */
export async function listUserInstallationIds(gh: Octokit): Promise<Set<number>> {
  const ids = new Set<number>();
  const pages = await gh.paginate(gh.apps.listInstallationsForAuthenticatedUser, { per_page: 100 });
  for (const inst of pages) ids.add(inst.id);
  return ids;
}

export type VerifyOutcome =
  | { ok: true; facts: InstallationFacts }
  | { ok: false; reason: "not_found" | "not_visible_to_user" };

/**
 * Verifies that an installation id from the callback exists on the app and is one the person can
 * see. Pure apart from the two reads, which the tests replace.
 */
export async function verifyInstallationForUser(
  installationId: number,
  deps: { readInstallation: (id: number) => Promise<InstallationFacts | null>; userInstallationIds: () => Promise<Set<number>> },
): Promise<VerifyOutcome> {
  const [facts, visible] = await Promise.all([deps.readInstallation(installationId), deps.userInstallationIds()]);
  if (!facts) return { ok: false, reason: "not_found" };
  if (!visible.has(installationId)) return { ok: false, reason: "not_visible_to_user" };
  return { ok: true, facts };
}

// ---------- writes ----------

/** Finds or makes the workspace of an account. The account id is the key; login and type refresh. */
export async function upsertWorkspace(account: InstallationFacts["account"]): Promise<WorkspaceRow> {
  const rows = (await sql()`
    insert into workspaces (github_account_id, account_login, account_type)
    values (${account.id}, ${account.login}, ${account.type})
    on conflict (github_account_id) do update set account_login = excluded.account_login, account_type = excluded.account_type, updated_at = now()
    returning *
  `) as WorkspaceRow[];
  return rows[0]!;
}

/** Stores the installation under its workspace. A reinstall with a new id makes a new row; the workspace is the same. */
export async function upsertInstallation(facts: InstallationFacts, workspaceId: string): Promise<InstallationRow> {
  const status: InstallationStatus = facts.suspended ? "suspended" : "active";
  const rows = (await sql()`
    insert into installations (github_installation_id, workspace_id, status, repository_selection, permissions, installed_by_github_user_id, suspended_at)
    values (${facts.installationId}, ${workspaceId}, ${status}, ${facts.repositorySelection}, ${JSON.stringify(facts.permissions)}::jsonb,
            ${facts.installedByGithubUserId}, ${facts.suspended ? new Date().toISOString() : null})
    on conflict (github_installation_id) do update set
      workspace_id = excluded.workspace_id, status = excluded.status, repository_selection = excluded.repository_selection,
      permissions = excluded.permissions, updated_at = now(), deleted_at = null,
      suspended_at = case when excluded.status = 'suspended' then coalesce(installations.suspended_at, now()) else null end
    returning *
  `) as InstallationRow[];
  return rows[0]!;
}

/** Stores one repository grant. A repository that moved to another account gets a new row (the id is the key, the workspace changes). */
async function upsertRepository(repo: RepositoryFacts, workspaceId: string, installationId: string): Promise<void> {
  await sql()`
    insert into repositories (github_repo_id, workspace_id, installation_id, full_name, name, owner_login, private, default_branch, selected)
    values (${repo.id}, ${workspaceId}, ${installationId}, ${repo.fullName}, ${repo.name}, ${repo.ownerLogin}, ${repo.private}, ${repo.defaultBranch}, true)
    on conflict (github_repo_id) do update set
      workspace_id = excluded.workspace_id, installation_id = excluded.installation_id, full_name = excluded.full_name,
      name = excluded.name, owner_login = excluded.owner_login, private = excluded.private,
      default_branch = coalesce(excluded.default_branch, repositories.default_branch),
      selected = true, deselected_at = null, updated_at = now()
  `;
}

/** Marks the given GitHub repository ids as removed from the installation. Their runs stay, inaccessible. */
async function deselectRepositories(githubRepoIds: number[], installationId?: string): Promise<number> {
  if (githubRepoIds.length === 0) return 0;
  const rows = await sql().query(
    `update repositories set selected = false, deselected_at = now(), updated_at = now()
     where github_repo_id = any($1::bigint[]) and selected
       and ($2::uuid is null or installation_id = $2::uuid)
     returning id`,
    [githubRepoIds, installationId ?? null],
  );
  for (const r of rows as Array<{ id: string }>) invalidateAccessCache({ repositoryId: r.id });
  return rows.length;
}

function repoFacts(r: { id: number; full_name: string; name: string; owner?: { login?: string } | null; private: boolean; default_branch?: string | null }): RepositoryFacts {
  return {
    id: r.id,
    fullName: r.full_name,
    name: r.name,
    ownerLogin: r.owner?.login ?? r.full_name.split("/")[0]!,
    private: r.private,
    defaultBranch: r.default_branch ?? null,
  };
}

/**
 * Replaces the installation's repository grants with what GitHub lists for the person:
 * GET /user/installations/{id}/repositories. Repositories not in the list are deselected.
 * Returns how many are selected now.
 */
export async function syncInstallationRepositories(gh: Octokit, installation: InstallationRow): Promise<number> {
  const listed = await gh.paginate(gh.apps.listInstallationReposForAuthenticatedUser, {
    installation_id: Number(installation.github_installation_id),
    per_page: 100,
  });
  const facts = listed.map((r) => repoFacts(r));
  for (const f of facts) await upsertRepository(f, installation.workspace_id, installation.id);
  const keep = new Set(facts.map((f) => f.id));
  const current = (await sql()`
    select id, github_repo_id from repositories where installation_id = ${installation.id} and selected
  `) as Array<{ id: string; github_repo_id: number | string }>;
  const gone = current.filter((r) => !keep.has(Number(r.github_repo_id))).map((r) => Number(r.github_repo_id));
  await deselectRepositories(gone, installation.id);
  invalidateAccessCache();
  return facts.length;
}

/**
 * The install callback: verified facts in, a connected workspace out. Stores the workspace, the
 * installation and the repository grants the person can see.
 */
export async function connectInstallation(gh: Octokit, facts: InstallationFacts): Promise<{ workspace: WorkspaceRow; installation: InstallationRow; repositories: number }> {
  const workspace = await upsertWorkspace(facts.account);
  const installation = await upsertInstallation(facts, workspace.id);
  const repositories = installation.status === "active" ? await syncInstallationRepositories(gh, installation) : 0;
  return { workspace, installation, repositories };
}

// ---------- lifecycle webhooks ----------

export type LifecycleEvent =
  | { kind: "installation"; action: "created" | "deleted" | "suspend" | "unsuspend" | "new_permissions_accepted"; facts: InstallationFacts; repositories: RepositoryFacts[] }
  | { kind: "installation_repositories"; installationId: number; added: RepositoryFacts[]; removed: number[] }
  | { kind: "authorization_revoked"; githubUserId: number }
  | { kind: "ignored"; reason: string };

interface InstallationPayload {
  action?: string;
  installation?: {
    id?: number;
    account?: { id?: number; login?: string; type?: string } | null;
    repository_selection?: string;
    permissions?: Record<string, string>;
    suspended_at?: string | null;
  };
  sender?: { id?: number; login?: string };
  repositories?: Array<{ id: number; full_name: string; name: string; private: boolean }>;
  repositories_added?: Array<{ id: number; full_name: string; name: string; private: boolean }>;
  repositories_removed?: Array<{ id: number; full_name: string; name: string; private: boolean }>;
}

/** Maps a verified webhook body to a lifecycle event. Pure. Unknown shapes are "ignored". */
export function parseLifecycleEvent(event: string | null, payload: unknown): LifecycleEvent {
  const p = (payload ?? {}) as InstallationPayload;
  if (event === "github_app_authorization") {
    const id = p.sender?.id;
    return p.action === "revoked" && typeof id === "number"
      ? { kind: "authorization_revoked", githubUserId: id }
      : { kind: "ignored", reason: `github_app_authorization action "${p.action}"` };
  }
  const inst = p.installation;
  if (!inst?.id || !inst.account?.id) return { kind: "ignored", reason: `Event "${event}" has no installation.` };
  if (event === "installation") {
    const actions = ["created", "deleted", "suspend", "unsuspend", "new_permissions_accepted"] as const;
    const action = actions.find((a) => a === p.action);
    if (!action) return { kind: "ignored", reason: `installation action "${p.action}"` };
    return {
      kind: "installation",
      action,
      facts: {
        installationId: inst.id,
        account: { id: inst.account.id, login: inst.account.login ?? String(inst.account.id), type: accountType(inst.account.type) },
        repositorySelection: inst.repository_selection === "all" ? "all" : "selected",
        permissions: inst.permissions ?? {},
        suspended: action === "suspend" || (action !== "unsuspend" && Boolean(inst.suspended_at)),
        installedByGithubUserId: typeof p.sender?.id === "number" ? p.sender.id : null,
      },
      repositories: (p.repositories ?? []).map((r) => repoFacts({ ...r, owner: { login: r.full_name.split("/")[0] } })),
    };
  }
  if (event === "installation_repositories") {
    return {
      kind: "installation_repositories",
      installationId: inst.id,
      added: (p.repositories_added ?? []).map((r) => repoFacts({ ...r, owner: { login: r.full_name.split("/")[0] } })),
      removed: (p.repositories_removed ?? []).map((r) => r.id),
    };
  }
  return { kind: "ignored", reason: `Event "${event}" is not a lifecycle event.` };
}

/** Records a delivery id. False when it was seen before, so the caller skips a redelivery. */
export async function recordDelivery(deliveryId: string | null, event: string | null, action: string | null): Promise<boolean> {
  if (!deliveryId) return true; // No id to dedupe on. GitHub always sends one; a test client may not.
  const rows = await sql()`
    insert into webhook_deliveries (delivery_id, event, action) values (${deliveryId}, ${event ?? ""}, ${action})
    on conflict (delivery_id) do nothing returning delivery_id
  `;
  return rows.length > 0;
}

async function installationByGithubId(id: number): Promise<InstallationRow | null> {
  const rows = (await sql()`select * from installations where github_installation_id = ${id}`) as InstallationRow[];
  return rows[0] ?? null;
}

/** Applies a lifecycle event to the rows. Returns a short note for the log. Idempotent. */
export async function applyLifecycleEvent(e: LifecycleEvent): Promise<string> {
  switch (e.kind) {
    case "ignored":
      return `ignored: ${e.reason}`;
    case "authorization_revoked": {
      const n = await markCredentialRevokedByGithubId(e.githubUserId);
      invalidateAccessCache();
      return `authorization revoked for GitHub user ${e.githubUserId} (${n} credential(s))`;
    }
    case "installation": {
      const workspace = await upsertWorkspace(e.facts.account);
      if (e.action === "deleted") {
        await sql()`
          update installations set status = 'deleted', deleted_at = coalesce(deleted_at, now()), updated_at = now()
          where github_installation_id = ${e.facts.installationId}
        `;
        await sql()`
          update repositories r set selected = false, deselected_at = coalesce(r.deselected_at, now()), updated_at = now()
          from installations i where i.id = r.installation_id and i.github_installation_id = ${e.facts.installationId} and r.selected
        `;
        invalidateAccessCache();
        return `installation ${e.facts.installationId} deleted for ${workspace.account_login}`;
      }
      const installation = await upsertInstallation(e.facts, workspace.id);
      if (e.action === "created" && e.facts.repositorySelection === "selected") {
        for (const r of e.repositories) await upsertRepository(r, workspace.id, installation.id);
      }
      invalidateAccessCache();
      return `installation ${e.facts.installationId} ${e.action} for ${workspace.account_login} (${installation.status})`;
    }
    case "installation_repositories": {
      const installation = await installationByGithubId(e.installationId);
      if (!installation) return `installation ${e.installationId} is unknown; repositories event skipped`;
      for (const r of e.added) await upsertRepository(r, installation.workspace_id, installation.id);
      const removed = await deselectRepositories(e.removed, installation.id);
      invalidateAccessCache();
      return `installation ${e.installationId}: +${e.added.length} repositories, -${removed}`;
    }
  }
}

// ---------- reads for the UI ----------

export interface WorkspaceSummary extends WorkspaceRow {
  installation_status: InstallationStatus | null;
  github_installation_id: number | string | null;
  repository_count: number;
}

/**
 * The workspaces whose installation the person can see on GitHub right now, with our connection
 * state. The intersection: an installation we know but GitHub does not list for this person is not
 * shown, and one GitHub lists but we never connected shows as "not connected" with its account.
 */
export async function listWorkspacesForUser(gh: Octokit): Promise<{ connected: WorkspaceSummary[]; unconnected: Array<{ installationId: number; login: string; type: AccountType }> }> {
  const visible = await gh.paginate(gh.apps.listInstallationsForAuthenticatedUser, { per_page: 100 });
  const ids = visible.map((i) => i.id);
  const rows =
    ids.length === 0
      ? []
      : ((await sql().query(
          `select w.*, i.status as installation_status, i.github_installation_id,
                  (select count(*)::int from repositories r where r.installation_id = i.id and r.selected) as repository_count
           from installations i join workspaces w on w.id = i.workspace_id
           where i.github_installation_id = any($1::bigint[]) and i.status <> 'deleted'
           order by w.account_login`,
          [ids],
        )) as WorkspaceSummary[]);
  const known = new Set(rows.map((r) => Number(r.github_installation_id)));
  const unconnected = visible
    .filter((i) => !known.has(i.id))
    .map((i) => {
      const account = i.account as { login?: string; slug?: string; type?: string } | null;
      return { installationId: i.id, login: account?.login ?? account?.slug ?? String(i.id), type: accountType(account?.type) };
    });
  return { connected: rows, unconnected };
}

/** The selected repositories of a workspace. Access per repository is resolved separately. */
export async function listWorkspaceRepositories(workspaceId: string): Promise<RepositoryRow[]> {
  return (await sql()`
    select r.* from repositories r
    join installations i on i.id = r.installation_id
    where r.workspace_id = ${workspaceId} and r.selected and i.status = 'active'
    order by r.full_name
  `) as RepositoryRow[];
}
