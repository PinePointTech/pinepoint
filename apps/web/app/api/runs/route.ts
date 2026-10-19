// POST /api/runs: start a run for a PR (plan section 4.5). GET /api/runs: the last 10 runs for the history list.
//
// The POST answers within a few seconds. It reads the PR and saves the run with status `planning`
// (prepareRun in lib/start-run.ts). The planner, the mission rows, the Computer starts and the
// first drive slice run in after() (planAndDrive). The run then moves planning -> running ->
// reporting -> done, or to failed with runs.error. The GitHub webhook uses the same two steps.
//
//   400  { error }                          the body is bad, or the PR cannot be read
//   200  { runId, status, existing: true }  a run for this PR head is still planning, running or reporting
//   200  { runId, status: "no_preview" }    the PR has no preview
//   202  { runId, status: "planning" }      the run exists; planning goes on in the background
//   500  { error }                          an unexpected error. The run row is the last write, so none is left behind.

import { after } from "next/server";
import { z } from "zod";
import { listRecentRuns } from "@pinepoint/runner";
import { DRIVE_SLICE_MS } from "@/lib/drive";
import { PrReadError, planAndDrive, prepareRun, type PrepareOutcome } from "@/lib/start-run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** The planner, the first Computer starts and the first drive slice run in after(). The Hobby plan allows 300 seconds at most (plan 4.2). */
export const maxDuration = 300;

const BodySchema = z.object({
  prUrl: z.string().url(),
  /** Optional. Replaces the preview URL that GitHub reports. For tests and for a PR with no Vercel deployment. */
  previewUrl: z.string().url().optional(),
  /** Optional. Start a new run also when one for the same PR head is still at work. */
  force: z.boolean().optional(),
});

export async function GET() {
  const runs = await listRecentRuns(10);
  return Response.json({ runs });
}

export async function POST(request: Request) {
  const sliceEndsAt = Date.now() + DRIVE_SLICE_MS;
  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await request.json());
  } catch (err) {
    return Response.json({ error: "Send { prUrl } as JSON.", detail: (err as Error).message }, { status: 400 });
  }

  let outcome: PrepareOutcome;
  try {
    outcome = await prepareRun({ prUrl: body.prUrl, previewUrl: body.previewUrl, noPreview: "record", force: body.force });
  } catch (err) {
    if (err instanceof PrReadError) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    console.error(`[runs] could not start a run for ${body.prUrl}: ${(err as Error).message}`);
    return Response.json({ error: `Could not start the run: ${(err as Error).message}` }, { status: 500 });
  }

  switch (outcome.status) {
    case "existing":
      return Response.json({ runId: outcome.runId, status: outcome.runStatus, existing: true });
    case "no_preview":
      return Response.json({ runId: outcome.runId, status: "no_preview" });
    case "planning": {
      const run = outcome.run;
      after(() => planAndDrive(run, sliceEndsAt));
      return Response.json({ runId: run.runId, status: "planning" }, { status: 202 });
    }
    default:
      // Only the webhook asks for the other outcomes (noPreview "skip", expectHeadSha).
      return Response.json({ error: `Unexpected start outcome: ${outcome.status}` }, { status: 500 });
  }
}
