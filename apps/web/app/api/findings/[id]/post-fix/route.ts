// POST /api/findings/{id}/post-fix (plan 4.5, 7, 9.4, VI-16).
// Posts the stored fix as a GitHub suggestion on the fix range, then replies in the finding thread
// with a link to it. Posts one time: the lock on findings.fix_comment_id makes a double click post once.
// The suggestion is posted under the acting person's token for a private run, so GitHub attributes
// it to them (docs/github-access-contract.md decision 3); a legacy finding uses the shared token.
import { readStoredFix } from "@pinepoint/ai";
import { sql } from "@pinepoint/core";
import type { Octokit, PrRef } from "@pinepoint/github";
import { postFixSuggestion } from "@pinepoint/github/fix";
import { authorizeFinding, githubForActor, recordAction, ReauthorizeError } from "@/lib/access";
import { rejectCrossSite } from "@/lib/auth/csrf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The value the lock writes while the post runs. GitHub ids start at 1. */
const POSTING = 0;

async function existingComment(gh: Octokit, ref: PrRef, commentId: number) {
  const { data } = await gh.pulls.getReviewComment({ owner: ref.owner, repo: ref.repo, comment_id: commentId });
  return { commentId: data.id, url: data.html_url };
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!UUID.test(id)) {
    return Response.json({ ok: false, error: "Finding not found." }, { status: 404 });
  }
  const refused = rejectCrossSite(req);
  if (refused) return refused;
  const guarded = await authorizeFinding(req, id, "act");
  if (!guarded.ok) return guarded.response;
  const finding = guarded.value.finding;
  let gh: Octokit;
  try {
    gh = await githubForActor(guarded.value);
  } catch (err) {
    if (err instanceof ReauthorizeError) return Response.json({ ok: false, error: err.message, state: "reauthorize" }, { status: 403 });
    throw err;
  }
  const stored = readStoredFix(finding.fix);
  if (!stored?.fix) {
    return Response.json({ ok: false, error: "This finding has no fix to post." }, { status: 409 });
  }
  if (!finding.head_sha) {
    return Response.json({ ok: false, error: "The run has no head SHA." }, { status: 409 });
  }
  const ref: PrRef = { owner: finding.owner, repo: finding.repo, number: finding.pr_number };

  if (finding.fix_comment_id !== null && Number(finding.fix_comment_id) !== POSTING) {
    const existing = await existingComment(gh, ref, Number(finding.fix_comment_id));
    return Response.json({ ok: true, posted: false, ...existing, replyUrl: null });
  }

  const db = sql();
  const locked = (await db`
    update findings set fix_comment_id = ${POSTING}
    where id = ${id} and fix_comment_id is null
    returning id
  `) as { id: string }[];
  if (locked.length === 0) {
    // Another request posts now, or posted already. Report what it stored.
    const again = (await db`select fix_comment_id from findings where id = ${id}`) as { fix_comment_id: number | string | null }[];
    const storedId = again[0]?.fix_comment_id ?? null;
    if (storedId !== null && Number(storedId) !== POSTING) {
      const existing = await existingComment(gh, ref, Number(storedId));
      return Response.json({ ok: true, posted: false, ...existing, replyUrl: null });
    }
    return Response.json({ ok: false, error: "The post is running. Wait a moment." }, { status: 409 });
  }

  try {
    const result = await postFixSuggestion(gh, ref, finding.head_sha, stored.fix, finding.comment_id === null ? null : Number(finding.comment_id), finding.title ?? "Finding");
    await db`update findings set fix_comment_id = ${result.commentId} where id = ${id}`;
    void recordAction({ action: "fix_post", runId: guarded.value.run.id, findingId: id, userId: guarded.value.session?.user.id ?? null, detail: { commentId: result.commentId } });
    return Response.json({ ok: true, posted: true, ...result });
  } catch (err) {
    // Clear the lock so that a retry can post.
    await db`update findings set fix_comment_id = null where id = ${id} and fix_comment_id = ${POSTING}`;
    console.error("post fix failed", { findingId: id, status: (err as { status?: number }).status });
    return Response.json({ ok: false, error: "GitHub post failed." }, { status: 502 });
  }
}
