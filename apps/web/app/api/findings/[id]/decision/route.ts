// POST /api/findings/{id}/decision with { decision: "bug" | "not_bug" } (plan 4.5, 9.4).
// Stores the decision once, replies in the finding's review thread, and stores a lesson for not_bug.
// Only the request that wins the update posts on GitHub, so a double click posts once.
import { sql } from "@pinepoint/core";
import { octokit, type PrRef } from "@pinepoint/github";
import { decisionReply, replyInThread, type Decision } from "@pinepoint/github/thread";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type FindingRow = {
  id: string;
  title: string | null;
  saw: string | null;
  comment_id: string | number | null;
  decision: Decision | null;
  decided_at: string | Date | null;
  owner: string;
  repo: string;
  pr_number: number;
};

function iso(value: string | Date | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!UUID.test(id)) {
    return Response.json({ ok: false, error: "Finding not found." }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "Body must be JSON." }, { status: 400 });
  }
  const decision = (body as { decision?: unknown } | null)?.decision;
  if (decision !== "bug" && decision !== "not_bug") {
    return Response.json(
      { ok: false, error: 'decision must be "bug" or "not_bug".' },
      { status: 400 },
    );
  }

  const db = sql();
  const found = (await db`
    select f.id, f.title, f.saw, f.comment_id, f.decision, f.decided_at,
           r.owner, r.repo, r.pr_number
    from findings f join runs r on r.id = f.run_id
    where f.id = ${id}
  `) as FindingRow[];
  const finding = found[0];
  if (!finding) {
    return Response.json({ ok: false, error: "Finding not found." }, { status: 404 });
  }
  if (finding.decision) {
    return Response.json({
      ok: true,
      decision: finding.decision,
      decidedAt: iso(finding.decided_at),
      replyUrl: null,
    });
  }

  const updated = (await db`
    update findings set decision = ${decision}, decided_at = now()
    where id = ${id} and decision is null
    returning decision, decided_at
  `) as { decision: Decision; decided_at: string | Date }[];
  const won = updated[0];
  if (!won) {
    // Another request stored a decision first. It posts the reply.
    const again = (await db`
      select decision, decided_at from findings where id = ${id}
    `) as { decision: Decision; decided_at: string | Date | null }[];
    return Response.json({
      ok: true,
      decision: again[0]?.decision ?? decision,
      decidedAt: iso(again[0]?.decided_at ?? null),
      replyUrl: null,
    });
  }

  const title = finding.title ?? "Finding";
  if (decision === "not_bug") {
    await db`
      insert into lessons (repo, finding_id, note)
      values (${`${finding.owner}/${finding.repo}`}, ${id}, ${`${title} Saw: ${finding.saw ?? ""}`})
    `;
  }

  const decidedAt = new Date(won.decided_at);
  const ref: PrRef = { owner: finding.owner, repo: finding.repo, number: finding.pr_number };
  const reply = decisionReply(decision, decidedAt);
  let replyUrl: string | null = null;
  try {
    if (finding.comment_id !== null) {
      replyUrl = (await replyInThread(ref, Number(finding.comment_id), reply)).url;
    } else {
      const { data } = await octokit().issues.createComment({
        owner: ref.owner,
        repo: ref.repo,
        issue_number: ref.number,
        body: `${title}\n\n${reply}`,
      });
      replyUrl = data.html_url;
    }
  } catch (err) {
    // The decision is stored. Report the GitHub failure without details from the request.
    console.error("decision reply failed", { findingId: id, status: (err as { status?: number }).status });
    return Response.json({
      ok: true,
      decision,
      decidedAt: decidedAt.toISOString(),
      replyUrl: null,
      replyError: "GitHub reply failed.",
    });
  }

  return Response.json({ ok: true, decision, decidedAt: decidedAt.toISOString(), replyUrl });
}
