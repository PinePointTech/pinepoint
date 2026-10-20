// POST /api/repositories/[id]/preflight with { prNumber }: everything the Run QA button needs to
// know before a launch (VI-34, VI-35, docs/github-access-contract.md sections 5 and 6), in one
// call with the person's own token:
//
//   access    write on the repository and organization membership, asked of GitHub now
//   pr        the head SHA to pin the launch to, open or closed, draft, fork
//   preview   ready, building, failed, missing, protected, unreachable or unsafe
//   qaFile    whether the QA file exists at the configured path (read at the base for a fork PR)
//   quota     how many slots are free in each scope right now (informational; the launch is the gate)
//
// `canRun` is true only when every blocking check passes. The launch repeats the access and head
// checks itself: this answer is a preview of them, not a ticket.

import { LIMITS, sql } from "@pinepoint/core";
import { loadRepositoryWithContext } from "@pinepoint/github/access";
import { getPrHead, type PrHead } from "@pinepoint/github/context";
import { checkPreview, type PreviewCheck } from "@pinepoint/github/preview";
import { repoQaConfigFor } from "@pinepoint/github/settings";
import { octokitForUser, ReauthorizeError } from "@pinepoint/github/user-tokens";
import type { Octokit } from "@pinepoint/github";
import { admissionKeys } from "@pinepoint/runner";
import { authorizeRepository, notFound } from "@/lib/access";
import { rejectCrossSite } from "@/lib/auth/csrf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_STORE = { "cache-control": "private, no-store" };

async function qaFileExists(gh: Octokit, owner: string, repo: string, path: string, ref: string): Promise<boolean> {
  try {
    const { data } = await gh.repos.getContent({ owner, repo, path, ref });
    return !Array.isArray(data) && data.type === "file";
  } catch (err) {
    if ((err as { status?: number }).status === 404) return false;
    throw err;
  }
}

/** Free slots per scope right now. One count per scope; the launch takes the slots atomically. */
async function quotaNow(scope: { userId: string; repositoryId: string; workspaceId: string }) {
  const result: Array<{ scope: string; limit: number; used: number }> = [];
  for (const k of admissionKeys(scope)) {
    const rows = (await sql()`select count(*)::int as n from run_admissions where scope_key = ${k.key}`) as Array<{ n: number }>;
    result.push({ scope: k.name, limit: k.limit, used: rows[0]?.n ?? 0 });
  }
  return result;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return notFound("No repository with this id.");
  const refused = rejectCrossSite(request);
  if (refused) return refused;
  const body = (await request.json().catch(() => null)) as { prNumber?: unknown } | null;
  const prNumber = Number(body?.prNumber);
  if (!Number.isInteger(prNumber) || prNumber <= 0) return Response.json({ ok: false, error: "Send { prNumber }." }, { status: 400, headers: NO_STORE });

  // "view" here: a person who may see the repository gets the full picture, including that they cannot launch.
  const guarded = await authorizeRepository(request, id, "view", { fresh: true });
  if (!guarded.ok) return guarded.response;
  const repository = await loadRepositoryWithContext(id);
  if (!repository) return notFound("No repository with this id.");
  const { access, session } = guarded.value;

  try {
    const gh = await octokitForUser(session.user.id);
    const config = await repoQaConfigFor(id);
    const ref = { owner: repository.owner_login, repo: repository.name, number: prNumber };
    let pr: PrHead;
    try {
      pr = await getPrHead(gh, ref);
    } catch (err) {
      if ((err as { status?: number }).status === 404) return Response.json({ ok: false, error: "No open pull request with this number." }, { status: 404, headers: NO_STORE });
      throw err;
    }
    const [preview, qaFile, quota] = await Promise.all([
      checkPreview(gh, ref, pr.headSha, config.previewProjectName) as Promise<PreviewCheck>,
      qaFileExists(gh, ref.owner, ref.repo, config.qaMdPath, pr.isFork ? pr.baseSha : pr.headSha),
      quotaNow({ userId: session.user.id, repositoryId: id, workspaceId: repository.workspace_id }),
    ]);

    const blockers: string[] = [];
    if (!access.canLaunch) blockers.push(access.reason || "You cannot launch QA on this repository.");
    if (pr.state !== "open") blockers.push("The pull request is closed.");
    if (preview.state !== "ready") blockers.push(preview.note);
    const full = quota.find((q) => q.used >= q.limit);
    if (full) blockers.push(`The ${full.scope.replace("_", " ")} limit (${full.limit}) is reached.`);

    return Response.json(
      {
        ok: true,
        canRun: blockers.length === 0,
        blockers,
        access: { level: access.level, state: access.state, reason: access.reason, canLaunch: access.canLaunch, canConfigure: access.canConfigure },
        pr: { number: pr.number, title: pr.title, url: pr.url, state: pr.state, draft: pr.draft, isFork: pr.isFork, headSha: pr.headSha, headRef: pr.headRef, author: pr.author },
        preview,
        qaFile: { path: config.qaMdPath, exists: qaFile, note: qaFile ? "" : `No ${config.qaMdPath} at this commit. The run uses the diff alone.` },
        quota,
        limits: LIMITS,
      },
      { headers: NO_STORE },
    );
  } catch (err) {
    if (err instanceof ReauthorizeError) return Response.json({ ok: false, error: err.message, state: "reauthorize" }, { status: 403, headers: NO_STORE });
    console.error("[preflight] failed", { repositoryId: id, prNumber, status: (err as { status?: number })?.status });
    return Response.json({ ok: false, error: "Could not read the pull request." }, { status: 502, headers: NO_STORE });
  }
}
