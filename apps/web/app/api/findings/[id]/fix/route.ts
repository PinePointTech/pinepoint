// POST /api/findings/{id}/fix with an optional { force?: boolean } (plan 4.5, 8.3, VI-16).
// Runs the fix agent for a finding that the developer marked as Bug and stores the fix in findings.fix.
// A second call returns the stored fix. The model call can take a minute, so maxDuration is 300.
// The fix agent reads the repository with the acting person's token for a private run
// (docs/github-access-contract.md section 4); a legacy finding uses the shared token as before.
import { FixError, fixFinding, readStoredFix } from "@pinepoint/ai";
import { authorizeFinding, githubForActor, recordAction, ReauthorizeError } from "@/lib/access";
import { rejectCrossSite } from "@/lib/auth/csrf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!UUID.test(id)) {
    return Response.json({ ok: false, error: "Finding not found." }, { status: 404 });
  }
  const refused = rejectCrossSite(req);
  if (refused) return refused;
  const body = (await req.json().catch(() => null)) as { force?: unknown } | null;
  const force = body?.force === true;

  const guarded = await authorizeFinding(req, id, "act");
  if (!guarded.ok) return guarded.response;
  const finding = guarded.value.finding;
  if (finding.level === "old_bug") {
    return Response.json({ ok: false, error: "Old bug. Production has it too. No fix." }, { status: 409 });
  }
  if (finding.level !== "bug") {
    return Response.json({ ok: false, error: "Only a Bug gets a fix." }, { status: 409 });
  }
  if (finding.decision !== "bug") {
    return Response.json({ ok: false, error: "Decide Bug first." }, { status: 409 });
  }
  if (!finding.head_sha) {
    return Response.json({ ok: false, error: "The run has no head SHA." }, { status: 409 });
  }

  // A stored fix comes back at once, with no model call.
  const existing = readStoredFix(finding.fix);
  if (existing && !force) {
    return Response.json({ ok: true, fix: existing, reused: true });
  }

  try {
    const gh = await githubForActor(guarded.value);
    void recordAction({ action: "fix_request", runId: guarded.value.run.id, findingId: id, userId: guarded.value.session?.user.id ?? null, detail: { force } });
    const result = await fixFinding(id, { force, gh });
    return Response.json({ ok: true, fix: result.stored, reused: result.reused });
  } catch (err) {
    if (err instanceof ReauthorizeError) {
      return Response.json({ ok: false, error: err.message, state: "reauthorize" }, { status: 403 });
    }
    if (err instanceof FixError) {
      console.error("fix agent gave no valid fix", { findingId: id, attempts: err.attempts });
      return Response.json({ ok: false, error: "The fix agent gave no valid fix." }, { status: 502 });
    }
    console.error("fix failed", { findingId: id, status: (err as { status?: number }).status });
    return Response.json({ ok: false, error: "The fix did not run." }, { status: 502 });
  }
}
