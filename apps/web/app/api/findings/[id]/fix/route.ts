// POST /api/findings/{id}/fix with an optional { force?: boolean } (plan 4.5, 8.3, VI-16).
// Runs the fix agent for a finding that the developer marked as Bug and stores the fix in findings.fix.
// A second call returns the stored fix. The model call can take a minute, so maxDuration is 300.
import { FixError, fixFinding, loadFindingWithRun, readStoredFix } from "@pinepoint/ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!UUID.test(id)) {
    return Response.json({ ok: false, error: "Finding not found." }, { status: 404 });
  }
  const body = (await req.json().catch(() => null)) as { force?: unknown } | null;
  const force = body?.force === true;

  const finding = await loadFindingWithRun(id);
  if (!finding) {
    return Response.json({ ok: false, error: "Finding not found." }, { status: 404 });
  }
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
    const result = await fixFinding(id, { force });
    return Response.json({ ok: true, fix: result.stored, reused: result.reused });
  } catch (err) {
    if (err instanceof FixError) {
      console.error("fix agent gave no valid fix", { findingId: id, attempts: err.attempts });
      return Response.json({ ok: false, error: "The fix agent gave no valid fix." }, { status: 502 });
    }
    console.error("fix failed", { findingId: id, status: (err as { status?: number }).status });
    return Response.json({ ok: false, error: "The fix did not run." }, { status: 502 });
  }
}
