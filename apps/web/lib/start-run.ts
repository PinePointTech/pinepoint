// Starts a run for a PR in two steps. POST /api/runs and the GitHub webhook both use them. Server code only.
//
// prepareRun is fast (a few seconds): read the PR, skip a duplicate, handle a PR with no preview,
// and insert the run with status `planning`. The caller answers right after it. The duplicate
// guard is the live claim (lib/webhook-claims.ts): of two callers for one PR head, only one inserts
// a run, and the other answers with that run.
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
  expireStalePlanning,
  failRun,
  runErrorText,
  startRun,
  type RunTarget,
} from "@pinepoint/runner";
import { driveRun } from "./drive";
import { attachLiveRun, claimLiveHead, releaseLiveClaim } from "./webhook-claims";

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
  /** Start a run also when one for the same PR head is still planning, running or reporting. */
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

/** What prepareRun reads and writes. The tests replace these. */
export interface PrepareDeps {
  getPrContext: (prUrl: string) => Promise<PrContext>;
  activeRunFor: typeof activeRunFor;
  expireStalePlanning: typeof expireStalePlanning;
  createNoPreviewRun: typeof createNoPreviewRun;
  createPlanningRun: typeof createPlanningRun;
  postNoPreviewComment: typeof postNoPreviewComment;
  claimLiveHead: typeof claimLiveHead;
  attachLiveRun: typeof attachLiveRun;
  releaseLiveClaim: typeof releaseLiveClaim;
  sleep: (ms: number) => Promise<void>;
}

export const prepareDeps: PrepareDeps = {
  getPrContext,
  activeRunFor,
  expireStalePlanning,
  createNoPreviewRun,
  createPlanningRun,
  postNoPreviewComment,
  claimLiveHead,
  attachLiveRun,
  releaseLiveClaim,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
};

/** How long a caller that lost the live claim waits for the winner's run row, and how often it looks. */
export const LIVE_RUN_WAIT_MS = 4_000;
export const LIVE_RUN_POLL_MS = 500;

/** The error when a caller lost the live claim and the winner's run did not come in LIVE_RUN_WAIT_MS. */
export const CLAIM_BUSY_ERROR = "Another request is starting a run for this commit. Try again in a minute.";

/** The live run of this head, looking again every LIVE_RUN_POLL_MS for up to LIVE_RUN_WAIT_MS. */
async function waitForLiveRun(t: RunTarget, deps: PrepareDeps) {
  for (let waited = 0; ; waited += LIVE_RUN_POLL_MS) {
    const run = await deps.activeRunFor(t, LIVE_RUN_STATUSES);
    if (run || waited >= LIVE_RUN_WAIT_MS) return run;
    await deps.sleep(LIVE_RUN_POLL_MS);
  }
}

/** The fast step: everything before the planner. The run row, when there is one, is the last thing it writes. */
export async function prepareRun(input: StartRunInput, deps: PrepareDeps = prepareDeps): Promise<PrepareOutcome> {
  let context: PrContext;
  try {
    context = await deps.getPrContext(input.prUrl);
  } catch (err) {
    throw new PrReadError(err);
  }
  if (input.expectHeadSha && context.headSha !== input.expectHeadSha) {
    return { status: "head_moved", headSha: context.headSha };
  }
  const target: RunTarget = { owner: context.owner, repo: context.repo, number: context.number, headSha: context.headSha };

  // A run of this head that stayed in planning past the timeout belongs to a background step
  // that died. Fail it, so it does not show as planning forever. activeRunFor skips it anyway.
  try {
    await deps.expireStalePlanning(target);
  } catch (err) {
    console.warn(`[runs] could not expire stale planning runs: ${(err as Error).message}`);
  }

  if (!input.force) {
    const existing = await deps.activeRunFor(target, LIVE_RUN_STATUSES);
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
    const runId = await deps.createNoPreviewRun(base);
    try {
      await deps.postNoPreviewComment({ owner: context.owner, repo: context.repo, number: context.number });
    } catch (err) {
      console.warn(`[runs] no-preview comment failed: ${(err as Error).message}`);
    }
    return { status: "no_preview", runId };
  }

  // The check above and the insert below are two statements, and the PR read took seconds. The
  // live claim is one statement, so of two callers for this head only one gets past it.
  let claimed = false;
  if (!input.force) {
    let won: boolean | null;
    try {
      won = await deps.claimLiveHead(target);
    } catch (err) {
      // The claims table cannot be read or made. Go on with the check above alone, as before
      // the claim existed: a run start must not depend on it.
      console.warn(`[runs] could not take the live claim: ${(err as Error).message}`);
      won = null;
    }
    if (won === false) {
      const existing = await waitForLiveRun(target, deps);
      if (existing) return { status: "existing", runId: existing.id, runStatus: existing.status };
      throw new Error(CLAIM_BUSY_ERROR);
    }
    claimed = won === true;
  }

  let runId: string;
  try {
    runId = await deps.createPlanningRun(base);
  } catch (err) {
    if (claimed) {
      await deps.releaseLiveClaim(target).catch((e: Error) => console.warn(`[runs] could not release the live claim: ${e.message}`));
    }
    throw err;
  }
  if (claimed) {
    // A failed attach only leaves the claim without its run id. It goes stale in 2 minutes, and
    // the claim check also looks at the runs table, so no second run starts meanwhile.
    await deps.attachLiveRun(target, runId).catch((e: Error) =>
      console.warn(`[runs] could not attach run ${runId} to the live claim: ${e.message}`),
    );
  }
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
