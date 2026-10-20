// Route guards (docs/github-access-contract.md sections 4, 5 and 7). Server code only.
//
// A legacy run (runs.workspace_id is null) keeps its public behavior: the guard lets it through with
// no session. A private run needs a session and the person's access to its repository. A private
// resource the caller may not see answers 404 with no details, the same as a missing id, so an
// attacker cannot tell the two apart. A signed-in person whose check could not settle (SSO, rate
// limit, reauthorize, unknown) gets 403 with the state, which the page turns into a next step.

import { sql, type MissionRow, type RunAction, type RunRow } from "@pinepoint/core";
import { loadFindingWithRun, type FindingWithRun } from "@pinepoint/ai";
import { octokit, type Octokit } from "@pinepoint/github";
import { resolveRepositoryAccess, type AccessResult } from "@pinepoint/github/access";
import { octokitForUser, ReauthorizeError } from "@pinepoint/github/user-tokens";
import { loadRun } from "@pinepoint/runner";
import { sessionOf, type SessionUser } from "./auth/session";

export type Guarded<T> = { ok: true; value: T } | { ok: false; response: Response };

const NO_STORE = { "cache-control": "private, no-store" };

export function notFound(what = "Not found."): Response {
  return Response.json({ ok: false, error: what }, { status: 404, headers: NO_STORE });
}

export function unauthorized(): Response {
  return Response.json({ ok: false, error: "Sign in with GitHub to continue.", state: "no_session" }, { status: 401, headers: NO_STORE });
}

export function forbidden(access: AccessResult): Response {
  return Response.json({ ok: false, error: access.reason || "You cannot do this.", state: access.state }, { status: 403, headers: NO_STORE });
}

/** The session, or a 401 response. */
export async function requireUser(request: Request): Promise<Guarded<SessionUser>> {
  const session = await sessionOf(request);
  return session ? { ok: true, value: session } : { ok: false, response: unauthorized() };
}

/** "view" reads; "act" launches, controls, decides, fixes or publishes. Both are "write" in v1. */
export type Need = "view" | "act" | "configure";

function allows(access: AccessResult, need: Need): boolean {
  return need === "view" ? access.canView : need === "act" ? access.canLaunch : access.canConfigure;
}

/** States where a signed-in person can do something about it, so 403 with the state is the right answer. */
const ACTIONABLE = new Set(["reauthorize", "sso_required", "rate_limited", "unknown", "read_only", "not_member"]);

export interface RunContext {
  run: RunRow;
  /** Null for a legacy run opened without a session. */
  session: SessionUser | null;
  /** Null for a legacy run. */
  access: AccessResult | null;
  isPrivate: boolean;
}

/**
 * Authorizes a run row that the caller loaded. `fresh` asks GitHub now instead of the 60-second
 * cache: every act passes it; reads may use the cache.
 */
export async function authorizeRunRow(request: Request, run: RunRow, need: Need, opts: { fresh?: boolean } = {}): Promise<Guarded<RunContext>> {
  if (!run.workspace_id || !run.repository_id) {
    return { ok: true, value: { run, session: await sessionOf(request), access: null, isPrivate: false } };
  }
  const session = await sessionOf(request);
  if (!session) return { ok: false, response: notFound() };
  const access = await resolveRepositoryAccess(session.user.id, run.repository_id, { fresh: opts.fresh ?? need !== "view" });
  if (!allows(access, need)) {
    return { ok: false, response: ACTIONABLE.has(access.state) ? forbidden(access) : notFound() };
  }
  return { ok: true, value: { run, session, access, isPrivate: true } };
}

export async function authorizeRun(request: Request, runId: string, need: Need, opts: { fresh?: boolean } = {}): Promise<Guarded<RunContext>> {
  const run = await loadRun(runId);
  if (!run) return { ok: false, response: notFound("No run with this id.") };
  return authorizeRunRow(request, run, need, opts);
}

export interface FindingContext extends RunContext {
  finding: FindingWithRun;
}

export async function authorizeFinding(request: Request, findingId: string, need: Need): Promise<Guarded<FindingContext>> {
  const finding = await loadFindingWithRun(findingId);
  if (!finding) return { ok: false, response: notFound("Finding not found.") };
  const run = await loadRun(finding.run_id);
  if (!run) return { ok: false, response: notFound("Finding not found.") };
  const guarded = await authorizeRunRow(request, run, need);
  if (!guarded.ok) return { ok: false, response: guarded.response.status === 404 ? notFound("Finding not found.") : guarded.response };
  return { ok: true, value: { ...guarded.value, finding } };
}

export interface MissionContext extends RunContext {
  mission: Pick<MissionRow, "id" | "run_id">;
}

export async function authorizeMission(request: Request, missionId: string, need: Need): Promise<Guarded<MissionContext>> {
  const rows = (await sql()`select id, run_id from missions where id = ${missionId}`) as Array<Pick<MissionRow, "id" | "run_id">>;
  const mission = rows[0];
  if (!mission) return { ok: false, response: notFound("This mission has no Pine Computer.") };
  const run = await loadRun(mission.run_id);
  if (!run) return { ok: false, response: notFound() };
  const guarded = await authorizeRunRow(request, run, need);
  if (!guarded.ok) return { ok: false, response: guarded.response.status === 404 ? notFound("This mission has no Pine Computer.") : guarded.response };
  return { ok: true, value: { ...guarded.value, mission } };
}

export interface RepositoryContext {
  session: SessionUser;
  access: AccessResult;
}

/** A connected repository is never legacy: a session is always required. */
export async function authorizeRepository(request: Request, repositoryId: string, need: Need, opts: { fresh?: boolean } = {}): Promise<Guarded<RepositoryContext>> {
  const user = await requireUser(request);
  if (!user.ok) return user;
  const access = await resolveRepositoryAccess(user.value.user.id, repositoryId, { fresh: opts.fresh ?? need !== "view" });
  if (!allows(access, need)) {
    return { ok: false, response: ACTIONABLE.has(access.state) ? forbidden(access) : notFound("No repository with this id.") };
  }
  return { ok: true, value: { session: user.value, access } };
}

// ---------- credentials for a run ----------

/**
 * The GitHub client for background work on a run: the initiator's token for a private run, the
 * shared token for a legacy one. Never the other way round (contract section 4). Throws
 * ReauthorizeError when the initiator must sign in again; the caller fails the step.
 */
export async function githubForRun(run: Pick<RunRow, "id" | "workspace_id" | "initiated_by_user_id">): Promise<Octokit> {
  if (!run.workspace_id) return octokit();
  if (!run.initiated_by_user_id) throw new Error(`Private run ${run.id} has no initiator.`);
  return octokitForUser(run.initiated_by_user_id);
}

/**
 * The GitHub client for a person's action on a run: their own token for a private run (the write
 * is attributed to them, decision 3), the shared token for a legacy run.
 */
export function githubForActor(ctx: RunContext): Promise<Octokit> {
  if (!ctx.isPrivate || !ctx.session) return Promise.resolve(octokit());
  return octokitForUser(ctx.session.user.id);
}

export { ReauthorizeError };

// ---------- audit ----------

/** Writes one run_actions row. Logs and never throws: an audit failure must not fail the action. */
export async function recordAction(input: {
  action: RunAction;
  runId?: string | null;
  findingId?: string | null;
  userId?: string | null;
  detail?: Record<string, unknown>;
}): Promise<void> {
  try {
    await sql()`
      insert into run_actions (run_id, finding_id, user_id, action, detail)
      values (${input.runId ?? null}, ${input.findingId ?? null}, ${input.userId ?? null}, ${input.action}, ${input.detail ? JSON.stringify(input.detail) : null}::jsonb)
    `;
  } catch (err) {
    console.warn(`[audit] could not record ${input.action}: ${(err as Error).message}`);
  }
}
