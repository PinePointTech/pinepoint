// POST /api/runs: read the PR, plan 10 missions, save them, start the first Computers (plan section 4.5).
// GET /api/runs: the last 10 runs for the history list.
//
// The POST returns as soon as the first Computers start. GET /api/runs/[id]/status drives the rest.
// The work itself is startRunForPr in lib/start-run.ts, which the GitHub webhook also calls.

import { z } from "zod";
import { listRecentRuns } from "@pinepoint/runner";
import { PrReadError, startRunForPr } from "@/lib/start-run";

export const dynamic = "force-dynamic";
/** The planner and the first Computer starts take time. The Hobby plan allows 300 seconds at most (plan 4.2). */
export const maxDuration = 300;

const BodySchema = z.object({
  prUrl: z.string().url(),
  /** Optional. Replaces the preview URL that GitHub reports. For tests and for a PR with no Vercel deployment. */
  previewUrl: z.string().url().optional(),
});

export async function GET() {
  const runs = await listRecentRuns(10);
  return Response.json({ runs });
}

export async function POST(request: Request) {
  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await request.json());
  } catch (err) {
    return Response.json({ error: "Send { prUrl } as JSON.", detail: (err as Error).message }, { status: 400 });
  }

  let outcome;
  try {
    outcome = await startRunForPr({ prUrl: body.prUrl, previewUrl: body.previewUrl, noPreview: "record" });
  } catch (err) {
    if (err instanceof PrReadError) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }

  switch (outcome.status) {
    case "no_preview":
      return Response.json({ runId: outcome.runId, status: "no_preview" });
    case "running":
      return Response.json({ runId: outcome.runId, status: "running", missions: outcome.missions, started: outcome.started });
    default:
      // Only the webhook asks for these outcomes.
      throw new Error(`Unexpected start outcome: ${outcome.status}`);
  }
}
