// Starts a run for a PR in two steps. POST /api/runs and the GitHub webhook both use them. Server code only.
//
// prepareRun is fast (a few seconds): read the PR, skip a duplicate, handle a PR with no preview,
// and insert the run with status `planning`. The caller answers right after it.
// planAndDrive runs in next/server after(): plan the missions, save them (the run moves to
// `running`), start the first Computers, then drive the run (lib/drive.ts). A planner error moves
// the run to `failed` with runs.error. A call that dies mid-plan leaves the run in `planning`, and
// advanceRun fails it after 6 minutes.

import { planMissions, type ChangedFile } from "@pinepoint/ai";
import type { Mission, RunStatus } from "@pinepoint/core";
import { getPrContext, type PrContext } from "@pinepoint/github/context";
import { postNoPreviewComment } from "@pinepoint/github/no-preview";
import {
  LIVE_RUN_STATUSES,
  activeRunFor,
  addMissions,
  createNoPreviewRun,
  createPlanningRun,
  failRun,
  runErrorText,
  startRun,
} from "@pinepoint/runner";
import { driveRun } from "./drive";

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
  /**
   * Start a run also when one for the same PR head is still planning, running or reporting.
   * The webhook sets it: its claim already makes sure that only one delivery starts a run.
   */
  force?: boolean;
}

/** A run in `planning` and what the planner reads for it. */
export interface PlanningRun {
  runId: string;
  diff: string;
  qaMd: string;
  changedFiles: ChangedFile[];
}

export type PrepareOutcome =
  | { status: "planning"; run: PlanningRun }
  | { status: "existing"; runId: string; runStatus: RunStatus }
  | { status: "no_preview"; runId: string }
  | { status: "no_preview_skipped"; headSha: string }
  | { status: "head_moved"; headSha: string };

/** The fast step: everything before the planner. The run row, when there is one, is the last thing it writes. */
export async function prepareRun(input: StartRunInput): Promise<PrepareOutcome> {
  let context: PrContext;
  try {
    context = await getPrContext(input.prUrl);
  } catch (err) {
    throw new PrReadError(err);
  }
  if (input.expectHeadSha && context.headSha !== input.expectHeadSha) {
    return { status: "head_moved", headSha: context.headSha };
  }

  if (!input.force) {
    const existing = await activeRunFor(
      { owner: context.owner, repo: context.repo, number: context.number, headSha: context.headSha },
      LIVE_RUN_STATUSES,
    );
    if (existing) return { status: "existing", runId: existing.id, runStatus: existing.status };
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
    productionUrl: context.productionUrl || process.env.DEMO_PRODUCTION_URL || null,
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

  const runId = await createPlanningRun(base);
  return {
    status: "planning",
    run: {
      runId,
      diff: context.diff,
      qaMd: base.qaMd,
      changedFiles: context.changedFiles.map((f) => (f.content === undefined ? { path: f.path } : { path: f.path, content: f.content })),
    },
  };
}

/** Moves a planning run to failed. Logs when even that fails: advanceRun then fails it after 6 minutes. */
async function failPlanning(runId: string, error: string): Promise<void> {
  console.error(`[runs] run ${runId}: ${error}`);
  try {
    await failRun(runId, error, "planning");
  } catch (err) {
    console.error(`[runs] could not mark run ${runId} as failed: ${(err as Error).message}`);
  }
}

/**
 * Plans the missions, saves them and starts the first Computers. Returns the counts, or null when
 * the run did not reach `running` (the planner failed, or the run left planning on the way).
 */
export async function planAndStart(run: PlanningRun): Promise<{ missions: number; started: number } | null> {
  let missions: Mission[];
  try {
    const plan = await planMissions({ diff: run.diff, qaMd: run.qaMd, changedFiles: run.changedFiles });
    missions = plan.missions;
  } catch (err) {
    await failPlanning(run.runId, runErrorText("Planning failed", err));
    return null;
  }

  try {
    if (!(await addMissions(run.runId, missions))) {
      console.warn(`[runs] run ${run.runId} left planning before its missions were saved`);
      return null;
    }
  } catch (err) {
    await failPlanning(run.runId, runErrorText("Could not save the missions", err));
    return null;
  }

  let started = 0;
  try {
    started = await startRun(run.runId);
  } catch (err) {
    // The drive loop and the status route start the queued missions on their next step.
    console.warn(`[runs] first Computer starts failed for run ${run.runId}: ${(err as Error).message}`);
  }
  return { missions: missions.length, started };
}

/** The background step: planAndStart, then the first drive slice until `sliceEndsAt`. Never throws. */
export async function planAndDrive(run: PlanningRun, sliceEndsAt: number, tag = "runs"): Promise<void> {
  try {
    const result = await planAndStart(run);
    if (!result) return;
    console.log(`[${tag}] run ${run.runId}: ${result.missions} missions, ${result.started} started`);
    const end = await driveRun(run.runId, sliceEndsAt);
    console.log(`[${tag}] first drive slice for run ${run.runId} ended: ${end}`);
  } catch (err) {
    console.error(`[${tag}] background step failed for run ${run.runId}: ${(err as Error).message}`);
  }
}
