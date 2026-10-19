// POST /api/runs: start a run for a PR (plan section 4.5). GET /api/runs: the last 10 runs for the history list.
//
// Two ways in (docs/github-access-contract.md sections 4, 7 and 8):
//
//   Signed in, { repositoryId, prUrl | prNumber }: a private manual run on a connected repository.
//   Access is asked of GitHub now (write), the PR is read with the person's token, the head is
//   compared with `expectedHeadSha` when given, the quota slots are taken, and the run belongs to
//   the workspace, the repository and the person. GET with a session lists the runs of the
//   repositories the person may view.
//
//   No session, { prUrl }: the legacy public demo. Allowed only for the repositories in
//   PINEPOINT_DEMO_REPOS (default vihuynh72/pinepoint) and never for a connected repository. GET
//   without a session lists legacy runs only.
//
// The POST answers within a few seconds. It reads the PR and saves the run with status `planning`
// (prepareRun in lib/start-run.ts). The planner, the mission rows, the Computer starts and the
// first drive slice run in after() (planAndDrive).
//
//   400  { error }                          the body is bad, or the PR cannot be read
//   401  { error, state }                   a private start without a session
//   403  { error, state }                   cross-site, no write access, or the repository needs a step first
//   404  { error }                          the repository is not visible to this person
//   409  { error, headSha }                 the PR head moved since the preflight (expectedHeadSha)
//   429  { error, scope, limit }            a quota is full
//   200  { runId, status, existing: true }  a run for this PR head is still planning, running or reporting
//   200  { runId, status: "no_preview" }    the PR has no preview
//   202  { runId, status: "planning" }      the run exists; planning goes on in the background
//   500  { error }                          an unexpected error. The run row is the last write, so none is left behind.

import { after } from "next/server";
import { z } from "zod";
import { octokit, prUrl as buildPrUrl, type Octokit } from "@pinepoint/github";
import { loadRepositoryWithContext } from "@pinepoint/github/access";
import { repoQaConfigFor } from "@pinepoint/github/settings";
import { listRecentRuns } from "@pinepoint/runner";
import { octokitForUser, ReauthorizeError } from "@pinepoint/github/user-tokens";
import { authorizeRepository, forbidden, notFound, recordAction, unauthorized } from "@/lib/access";
import { rejectCrossSite } from "@/lib/auth/csrf";
import { sessionOf } from "@/lib/auth/session";
import { isDemoRepo, parsePrUrl } from "@/lib/demo-repos";
import { DRIVE_SLICE_MS } from "@/lib/drive";
import { CLAIM_BUSY_ERROR, PrReadError, planAndDrive, prepareRun, type PrepareOutcome, type StartRunInput } from "@/lib/start-run";
import { viewableRepositoryIds } from "@/lib/visible";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** The planner, the first Computer starts and the first drive slice run in after(). The Hobby plan allows 300 seconds at most (plan 4.2). */
export const maxDuration = 300;

const BodySchema = z.object({
  /** A PR URL. Required without repositoryId; with one, prNumber is the alternative. */
  prUrl: z.string().url().optional(),
  /** A connected repository (private manual run). */
  repositoryId: z.string().uuid().optional(),
  prNumber: z.number().int().positive().optional(),
  /** From the preflight: refuse when the head moved since. */
  expectedHeadSha: z.string().regex(/^[0-9a-f]{7,40}$/).optional(),
  /** Optional. Replaces the preview URL that GitHub reports. For tests and for a PR with no Vercel deployment. */
  previewUrl: z.string().url().optional(),
  /** Optional. Start a new run also when one for the same PR head is still at work. */
  force: z.boolean().optional(),
});

export async function GET(request: Request) {
  const session = await sessionOf(request);
  if (!session) {
    return Response.json({ runs: await listRecentRuns(10, { kind: "legacy" }) }, { headers: { "cache-control": "no-store" } });
  }
  const repositoryIds = await viewableRepositoryIds(session.user.id);
  const runs = await listRecentRuns(10, { kind: "repositories", repositoryIds });
  return Response.json({ runs }, { headers: { "cache-control": "private, no-store" } });
}

export async function POST(request: Request) {
  const sliceEndsAt = Date.now() + DRIVE_SLICE_MS;
  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await request.json());
  } catch (err) {
    return Response.json({ error: "Send { prUrl } or { repositoryId, prNumber } as JSON.", detail: (err as Error).message }, { status: 400 });
  }
  if (!body.prUrl && !(body.repositoryId && body.prNumber)) {
    return Response.json({ error: "Send a prUrl, or a repositoryId with a prNumber." }, { status: 400 });
  }

  const refused = rejectCrossSite(request);
  if (refused) return refused;

  let input: StartRunInput;
  let audit: { userId: string | null; repositoryId: string | null };
  if (body.repositoryId) {
    const guarded = await authorizeRepository(request, body.repositoryId, "act", { fresh: true });
    if (!guarded.ok) return guarded.response;
    const repository = await loadRepositoryWithContext(body.repositoryId);
    if (!repository) return notFound("No repository with this id.");
    const url = body.prUrl ?? buildPrUrl({ owner: repository.owner_login, repo: repository.name, number: body.prNumber! });
    const parsed = parsePrUrl(url);
    if (!parsed || parsed.owner.toLowerCase() !== repository.owner_login.toLowerCase() || parsed.repo.toLowerCase() !== repository.name.toLowerCase()) {
      return Response.json({ error: "The PR URL is not in this repository." }, { status: 400 });
    }
    let gh: Octokit;
    try {
      gh = await octokitForUser(guarded.value.session.user.id);
    } catch (err) {
      if (err instanceof ReauthorizeError) return forbidden({ ...guarded.value.access, state: "reauthorize", reason: err.message });
      throw err;
    }
    const userId = guarded.value.session.user.id;
    input = {
      prUrl: url,
      gh,
      qaConfig: await repoQaConfigFor(repository.id),
      ownedBy: { workspaceId: repository.workspace_id, repositoryId: repository.id, initiatedByUserId: userId },
      admission: { userId, repositoryId: repository.id, workspaceId: repository.workspace_id },
      expectHeadSha: body.expectedHeadSha,
      noPreview: "record",
      force: body.force,
    };
    audit = { userId, repositoryId: repository.id };
  } else {
    // The legacy demo path. A session does not change it: a connected repository is never
    // started this way, and the shared token is used for the demo repositories only.
    const parsed = parsePrUrl(body.prUrl!);
    if (!parsed) return Response.json({ error: "Not a GitHub pull request URL." }, { status: 400 });
    if (!isDemoRepo(parsed.owner, parsed.repo)) {
      const session = await sessionOf(request);
      if (!session) return unauthorized();
      return Response.json(
        { error: "This repository is not the public demo. Connect it from Settings and pick the PR there.", state: "not_connected" },
        { status: 403, headers: { "cache-control": "private, no-store" } },
      );
    }
    input = { prUrl: body.prUrl!, gh: octokit(), previewUrl: body.previewUrl, noPreview: "record", force: body.force };
    audit = { userId: null, repositoryId: null };
  }

  let outcome: PrepareOutcome;
  try {
    outcome = await prepareRun(input);
  } catch (err) {
    if (err instanceof PrReadError) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    if (err instanceof ReauthorizeError) {
      return Response.json({ error: err.message, state: "reauthorize" }, { status: 403 });
    }
    console.error(`[runs] could not start a run for ${input.prUrl}: ${(err as Error).message}`);
    // The detail stays in the log: a database error can name the schema or even the connection string.
    // Only the busy message is meant for the person.
    const busy = (err as Error).message === CLAIM_BUSY_ERROR;
    return Response.json({ error: `Could not start the run: ${busy ? CLAIM_BUSY_ERROR : "a server error. Try again."}` }, { status: 500 });
  }

  switch (outcome.status) {
    case "existing":
      return Response.json({ runId: outcome.runId, status: outcome.runStatus, existing: true });
    case "no_preview":
      return Response.json({ runId: outcome.runId, status: "no_preview" });
    case "head_moved":
      return Response.json({ error: "The PR head moved since the preflight. Look again and start when ready.", headSha: outcome.headSha }, { status: 409 });
    case "quota":
      return Response.json({ error: outcome.message, scope: outcome.denied.scope, limit: outcome.denied.limit }, { status: 429 });
    case "planning": {
      const run = outcome.run;
      if (audit.userId) {
        void recordAction({ action: "launch", runId: run.runId, userId: audit.userId, detail: { repositoryId: audit.repositoryId, prUrl: input.prUrl } });
      }
      after(() => planAndDrive(run, sliceEndsAt));
      return Response.json({ runId: run.runId, status: "planning" }, { status: 202 });
    }
    default:
      // Only the webhook asks for noPreview "skip".
      return Response.json({ error: `Unexpected start outcome: ${outcome.status}` }, { status: 500 });
  }
}
