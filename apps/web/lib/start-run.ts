// Starts a run for a PR: read the PR, plan the missions, save them, start the first Computers.
// POST /api/runs and the GitHub webhook both call startRunForPr. Server code only.

import { planMissions } from "@pinepoint/ai";
import { getPrContext, type PrContext } from "@pinepoint/github/context";
import { postNoPreviewComment } from "@pinepoint/github/no-preview";
import { createNoPreviewRun, createRun, startRun } from "@pinepoint/runner";

/** getPrContext failed. POST /api/runs answers 400 with this message. */
export class PrReadError extends Error {
  constructor(cause: unknown) {
    super(`Could not read the PR: ${(cause as Error)?.message ?? String(cause)}`);
    this.name = "PrReadError";
  }
}

export interface StartRunInput {
  prUrl: string;
  /** Replaces the preview URL that GitHub reports. */
  previewUrl?: string;
  /**
   * What to do when the PR has no preview URL. "record" (POST /api/runs) saves a no_preview run
   * and posts "No preview. No test." on the PR. "skip" (the webhook) does nothing: a later
   * deployment_status event comes when the preview is ready.
   */
  noPreview?: "record" | "skip";
  /** When set, stop without a run if the PR head is no longer this SHA. */
  expectHeadSha?: string;
}

export type StartRunOutcome =
  | { status: "running"; runId: string; missions: number; started: number }
  | { status: "no_preview"; runId: string }
  | { status: "no_preview_skipped"; headSha: string }
  | { status: "head_moved"; headSha: string };

export async function startRunForPr(input: StartRunInput): Promise<StartRunOutcome> {
  let context: PrContext;
  try {
    context = await getPrContext(input.prUrl);
  } catch (err) {
    throw new PrReadError(err);
  }
  if (input.expectHeadSha && context.headSha !== input.expectHeadSha) {
    return { status: "head_moved", headSha: context.headSha };
  }
  const previewUrl = input.previewUrl ?? context.previewUrl;

  const base = {
    prUrl: context.url,
    owner: context.owner,
    repo: context.repo,
    prNumber: context.number,
    headSha: context.headSha,
    author: context.author || null,
    previewUrl,
    productionUrl: context.productionUrl ?? process.env.DEMO_PRODUCTION_URL ?? null,
    qaMd: context.qaMd ?? "",
  };

  if (!previewUrl) {
    if (input.noPreview === "skip") {
      return { status: "no_preview_skipped", headSha: context.headSha };
    }
    const runId = await createNoPreviewRun(base);
    try {
      await postNoPreviewComment({ owner: context.owner, repo: context.repo, number: context.number });
    } catch (err) {
      console.warn(`[runs] no-preview comment failed: ${(err as Error).message}`);
    }
    return { status: "no_preview", runId };
  }

  const plan = await planMissions({
    diff: context.diff,
    qaMd: base.qaMd,
    changedFiles: context.changedFiles.map((f) => (f.content === undefined ? { path: f.path } : { path: f.path, content: f.content })),
  });
  const runId = await createRun(base, plan.missions);
  const started = await startRun(runId);
  return { status: "running", runId, missions: plan.missions.length, started };
}
