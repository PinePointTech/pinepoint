// POST /api/runs: read the PR, plan 10 missions, save them, start the first Computers (plan section 4.5).
// GET /api/runs: the last 10 runs for the history list.
//
// The POST returns as soon as the first Computers start. GET /api/runs/[id]/status drives the rest.

import { z } from "zod";
import { planMissions } from "@pinepoint/ai";
import { getPrContext } from "@pinepoint/github/context";
import { createNoPreviewRun, createRun, listRecentRuns, startRun } from "@pinepoint/runner";

export const dynamic = "force-dynamic";
/** The planner and the first Computer starts take time. The Hobby plan allows 300 seconds at most (plan 4.2). */
export const maxDuration = 300;

const BodySchema = z.object({
  prUrl: z.string().url(),
  /** Temporary until VI-11 reads the preview from the GitHub deployments. */
  previewUrl: z.string().url().nullable().optional(),
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

  let context;
  try {
    context = await getPrContext(body.prUrl, body.previewUrl !== undefined ? { previewUrl: body.previewUrl } : {});
  } catch (err) {
    return Response.json({ error: `Could not read the PR: ${(err as Error).message}` }, { status: 400 });
  }

  const base = {
    prUrl: context.prUrl,
    owner: context.owner,
    repo: context.repo,
    prNumber: context.number,
    headSha: context.headSha,
    author: context.author,
    previewUrl: context.previewUrl,
    productionUrl: process.env.DEMO_PRODUCTION_URL ?? null,
    qaMd: context.qaMd,
  };

  if (!context.previewUrl) {
    // "No preview. No test." The PR comment belongs to VI-11 and VI-13.
    const runId = await createNoPreviewRun(base);
    return Response.json({ runId, status: "no_preview" });
  }

  const plan = await planMissions({ diff: context.diff, qaMd: context.qaMd, changedFiles: context.changedFiles });
  const runId = await createRun(base, plan.missions);
  const started = await startRun(runId);
  return Response.json({ runId, status: "running", missions: plan.missions.length, started });
}
