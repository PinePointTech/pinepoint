// POST /api/runs/[id]/drive: one more slice of driving for a run that POST /api/runs or the GitHub webhook started.
// Only the server calls it (lib/drive.ts chains to it). The x-pinepoint-drive header must be the
// HMAC of the run id under GITHUB_WEBHOOK_SECRET. It answers at once and works in after().

import { after } from "next/server";
import { loadRun } from "@pinepoint/runner";
import { verifyDriveToken } from "@pinepoint/github/webhook";
import { DRIVE_HEADER, DRIVE_SLICE_MS, driveRun, pastCap } from "@/lib/drive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const sliceEndsAt = Date.now() + DRIVE_SLICE_MS;
  const { id } = await params;
  if (!UUID.test(id)) {
    return Response.json({ error: "The run id is not a UUID." }, { status: 400 });
  }
  if (!verifyDriveToken(process.env.GITHUB_WEBHOOK_SECRET, id, request.headers.get(DRIVE_HEADER))) {
    return Response.json({ error: "Bad drive token." }, { status: 401 });
  }

  const run = await loadRun(id);
  if (!run) return Response.json({ error: "No run with this id." }, { status: 404 });
  if (run.status !== "running") return Response.json({ runId: id, status: run.status, driving: false });
  if (pastCap(run.started_at)) return Response.json({ runId: id, status: run.status, driving: false, reason: "capped" });

  after(async () => {
    const end = await driveRun(id, sliceEndsAt);
    console.log(`[drive] slice for run ${id} ended: ${end}`);
  });
  return Response.json({ runId: id, status: run.status, driving: true }, { status: 202 });
}
